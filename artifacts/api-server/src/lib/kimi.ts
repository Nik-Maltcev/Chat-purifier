import { logger } from "./logger.js";

interface KimiAnalysisResult {
  verdict: "keep" | "filter";
  score: number;
  spamScore: number;
  activityScore: number;
  topicScore: number;
  summary: string;
}

const KIMI_API_URL = "https://api.moonshot.cn/v1/chat/completions";

export async function analyzeChat(
  chatTitle: string | null,
  messages: string[]
): Promise<KimiAnalysisResult> {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing KIMI_API_KEY environment variable");
  }

  const messagesText = messages.slice(0, 50).join("\n---\n");
  const chatName = chatTitle || "Unknown chat";

  const prompt = `Ты аналитик качества Telegram-чатов об эмиграции и путешествиях.

Проанализируй следующие сообщения из чата "${chatName}" и дай оценку.

Сообщения:
${messagesText}

Оцени чат по следующим критериям (каждый от 1 до 10):
- spamScore: уровень спама (1 = минимальный спам, 10 = полностью спам/реклама)
- activityScore: активность и вовлечённость (1 = мёртвый, 10 = очень активный)
- topicScore: релевантность теме эмиграции/путешествий/помощи (1 = не по теме, 10 = строго по теме)
- score: общая полезность чата (1 = бесполезный, 10 = очень полезный)

Вердикт:
- "keep" — если чат активный, по делу, люди реально помогают друг другу с эмиграцией/переездом/документами/жильём/работой за рубежом
- "filter" — если чат завален спамом, рекламой, оффтопом, неактивен, или не связан с темой

Ответь ТОЛЬКО в формате JSON без лишних слов:
{
  "verdict": "keep" or "filter",
  "score": число 1-10,
  "spamScore": число 1-10,
  "activityScore": число 1-10,
  "topicScore": число 1-10,
  "summary": "краткий вывод на русском до 150 символов"
}`;

  const response = await fetch(KIMI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "moonshot-v1-8k",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.1,
      max_tokens: 300,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Kimi API error ${response.status}: ${errText}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices[0]?.message?.content?.trim() || "";
  logger.info({ content }, "Kimi raw response");

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Could not parse JSON from Kimi response: ${content}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as KimiAnalysisResult;

  return {
    verdict: parsed.verdict === "keep" ? "keep" : "filter",
    score: Math.min(10, Math.max(1, parsed.score || 5)),
    spamScore: Math.min(10, Math.max(1, parsed.spamScore || 5)),
    activityScore: Math.min(10, Math.max(1, parsed.activityScore || 5)),
    topicScore: Math.min(10, Math.max(1, parsed.topicScore || 5)),
    summary: parsed.summary || "",
  };
}
