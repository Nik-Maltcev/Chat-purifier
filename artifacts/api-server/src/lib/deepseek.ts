import { logger } from "./logger.js";
import { getSettingValue } from "./settings-store.js";

const CATEGORIES = [
  "18+", "AI", "Apple", "ChatGPT", "IT", "SEO", "Telegram",
  "Бизнес", "Будущее", "Видео", "Вопросы", "Деньги", "Дизайн",
  "Еда", "Животные", "Здоровье", "Игры", "Инвестиции", "Истории",
  "История", "Карьера", "Кино и сериалы", "Книги", "Крипто",
  "Кулинария", "Личный опыт", "Маркетинг", "Маркетплейсы", "Медиа",
  "Менеджмент", "Мнения", "Наука", "Образование", "Общение",
  "Отношения", "Офис", "Офлайн", "Политика", "Право", "Приложения",
  "Природа", "Путешествия", "Рабочие будни", "Разработка", "Релокация",
  "Ритейл", "Рост", "Сервис", "Сервисы", "Соцсети", "Спорт",
  "Технологии", "Топ-менеджмент", "Транспорт", "Трибуна", "Флуд",
  "Хобби", "Экономика", "Юмор", "Юриспруденция", "Другое",
];

const LANG_CONFIG: Record<string, { name: string; promptLang: string; code: string }> = {
  ru: { name: "Русский", promptLang: "на русском", code: "ru" },
  en: { name: "English", promptLang: "in English", code: "en" },
  de: { name: "Deutsch", promptLang: "auf Deutsch", code: "de" },
  es: { name: "Español", promptLang: "en español", code: "es" },
  it: { name: "Italiano", promptLang: "in italiano", code: "it" },
  fr: { name: "Français", promptLang: "en français", code: "fr" },
  pt: { name: "Português", promptLang: "em português", code: "pt" },
};

interface TitleLanguageResult {
  isTargetLanguage: boolean;
  detectedLanguage: string;
  confidence: number;
}

/**
 * Check if chat title is in the target language.
 * Used to filter out chats in other languages before full analysis.
 */
export async function checkTitleLanguage(
  chatTitle: string,
  targetLanguage: string,
): Promise<TitleLanguageResult> {
  const apiKey = await getSettingValue("deepseek_api_key") || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("API ключ не настроен. Зайдите в Настройки и укажите ключ.");
  }

  const lang = LANG_CONFIG[targetLanguage] || LANG_CONFIG.ru;

  const prompt = `Analyze the language of this chat/channel title: "${chatTitle}"

Determine what language the title is written in. Consider:
- The script used (Latin, Cyrillic, Arabic, Chinese, etc.)
- Common words and patterns
- Mixed language titles should be classified by the dominant language

Reply ONLY in JSON format:
{
  "isTargetLanguage": true/false (is it in ${lang.name}?),
  "detectedLanguage": "language code (en, ru, de, es, fr, it, pt, ar, zh, ja, ko, etc.)",
  "confidence": number 0-100 (how confident you are)
}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${errText}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices[0]?.message?.content?.trim() || "";
  logger.info({ content, chatTitle, targetLanguage }, "Title language check response");

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Default to allowing the chat if we can't parse
    return { isTargetLanguage: true, detectedLanguage: "unknown", confidence: 0 };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      isTargetLanguage: Boolean(parsed.isTargetLanguage),
      detectedLanguage: String(parsed.detectedLanguage || "unknown"),
      confidence: Number(parsed.confidence) || 0,
    };
  } catch {
    return { isTargetLanguage: true, detectedLanguage: "unknown", confidence: 0 };
  }
}

interface AnalysisResult {
  verdict: "keep" | "filter";
  score: number;
  spamScore: number;
  activityScore: number;
  topicScore: number;
  summary: string;
  category: string | null;
  country: string | null;
}

export async function analyzeChat(
  chatTitle: string | null,
  messages: string[],
  language: string = "ru",
): Promise<AnalysisResult> {
  const apiKey = await getSettingValue("deepseek_api_key") || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("API ключ не настроен. Зайдите в Настройки и укажите ключ.");
  }

  const messagesText = messages.slice(0, 50).join("\n---\n");
  const chatName = chatTitle || "Unknown";
  const lang = LANG_CONFIG[language] || LANG_CONFIG.ru;
  const categoriesList = CATEGORIES.join(", ");

  const prompt = `You are a Telegram chat quality analyst.

Analyze the following messages from chat "${chatName}" and evaluate it.

Messages:
${messagesText}

Rate the chat on these criteria (each 1-10):
- spamScore: spam level (1 = minimal spam, 10 = pure spam/ads)
- activityScore: activity and engagement (1 = dead, 10 = very active)
- topicScore: relevance and usefulness (1 = off-topic/useless, 10 = highly relevant/useful)
- score: overall quality (1 = useless, 10 = very useful)

Verdict:
- "keep" — if the chat is active, useful, people help each other, has real discussions
- "filter" — if the chat is full of spam, ads, off-topic, inactive, or useless

Category — pick ONE from this list: ${categoriesList}
Choose the most fitting category based on chat name and messages.

Country — determine which country the chat is about (Germany, USA, Canada, etc.). Look at the chat name first, then messages. If unclear — return null.

Reply ONLY in JSON format, summary in Russian:
{
  "verdict": "keep" or "filter",
  "score": number 1-10,
  "spamScore": number 1-10,
  "activityScore": number 1-10,
  "topicScore": number 1-10,
  "summary": "краткий вывод на русском, до 150 символов",
  "category": "one category from the list",
  "country": "country name in Russian or null"
}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  let response: Response;
  try {
    response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 800,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${errText}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices[0]?.message?.content?.trim() || "";
  logger.info({ content }, "DeepSeek V4 raw response");

  // Try to extract JSON — handle markdown blocks, truncated responses
  let jsonStr = "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  } else {
    // Try to fix truncated JSON — find opening { and add closing }
    const braceIdx = content.indexOf("{");
    if (braceIdx >= 0) {
      jsonStr = content.slice(braceIdx);
      // Count braces and close if needed
      let depth = 0;
      for (const ch of jsonStr) {
        if (ch === "{") depth++;
        if (ch === "}") depth--;
      }
      while (depth > 0) { jsonStr += "}"; depth--; }
      // Try to fix trailing comma before }
      jsonStr = jsonStr.replace(/,\s*}/g, "}");
    }
  }

  if (!jsonStr) {
    throw new Error(`Не удалось разобрать JSON из ответа GPT: ${content.slice(0, 200)}`);
  }

  let parsed: AnalysisResult & { country?: unknown; category?: unknown };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Не удалось разобрать JSON из ответа GPT: ${content.slice(0, 200)}`);
  }

  const rawCountry = parsed.country;
  const country =
    typeof rawCountry === "string" && rawCountry.toLowerCase() !== "null" && rawCountry.trim()
      ? rawCountry.trim()
      : null;

  const rawCategory = parsed.category;
  const category =
    typeof rawCategory === "string" && rawCategory.trim()
      ? rawCategory.trim()
      : null;

  return {
    verdict: parsed.verdict === "keep" ? "keep" : "filter",
    score: Math.min(10, Math.max(1, parsed.score || 5)),
    spamScore: Math.min(10, Math.max(1, parsed.spamScore || 5)),
    activityScore: Math.min(10, Math.max(1, parsed.activityScore || 5)),
    topicScore: Math.min(10, Math.max(1, parsed.topicScore || 5)),
    summary: parsed.summary || "",
    category,
    country,
  };
}
