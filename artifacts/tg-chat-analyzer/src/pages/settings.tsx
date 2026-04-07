import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Save, Loader2, CheckCircle, Eye, EyeOff, ShieldCheck, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface SettingsData {
  telegram_api_id: string;
  telegram_api_hash: string;
  telegram_session: string;
  deepseek_api_key: string;
  default_delay_seconds: string;
  default_messages_count: string;
  daily_quota: string;
}

interface QuotaData {
  quota: number;
  todayCount: number;
  remaining: number;
  resetAt: string;
}

export function Settings() {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [showSession, setShowSession] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [quota, setQuota] = useState<QuotaData | null>(null);

  const [form, setForm] = useState<SettingsData>({
    telegram_api_id: "",
    telegram_api_hash: "",
    telegram_session: "",
    deepseek_api_key: "",
    default_delay_seconds: "45",
    default_messages_count: "30",
    daily_quota: "150",
  });

  useEffect(() => {
    Promise.all([
      fetch("/api/settings/raw").then((r) => r.json()),
      fetch("/api/quota").then((r) => r.json()),
    ])
      .then(([data, q]: [SettingsData, QuotaData]) => {
        setForm({
          telegram_api_id: data.telegram_api_id || "",
          telegram_api_hash: data.telegram_api_hash || "",
          telegram_session: data.telegram_session || "",
          deepseek_api_key: data.deepseek_api_key || "",
          default_delay_seconds: data.default_delay_seconds || "45",
          default_messages_count: data.default_messages_count || "30",
          daily_quota: data.daily_quota || "150",
        });
        setQuota(q);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Ошибка сохранения");

      // Refresh quota
      const q: QuotaData = await fetch("/api/quota").then((r) => r.json());
      setQuota(q);

      setSaved(true);
      toast({ title: "Настройки сохранены", description: "Изменения применены немедленно." });
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Ошибка", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const set = (key: keyof SettingsData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
  };

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Загрузка настроек...</div>;
  }

  const quotaPct = quota ? Math.min(100, (quota.todayCount / quota.quota) * 100) : 0;
  const quotaWarning = quotaPct >= 80;
  const quotaExceeded = quota ? quota.todayCount >= quota.quota : false;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Настройки</h1>
          <p className="text-sm text-muted-foreground">Учётные данные Telegram и ИИ-провайдера</p>
        </div>
      </div>

      {/* Дневная квота — статус */}
      {quota && (
        <Card className={quotaExceeded ? "border-red-300 bg-red-50 dark:bg-red-950/20" : quotaWarning ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20" : "border-green-300 bg-green-50 dark:bg-green-950/20"}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              {quotaExceeded ? (
                <AlertTriangle className="w-4 h-4 text-red-500" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-green-600" />
              )}
              Дневная квота Telegram
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-end">
              <span className="text-2xl font-bold font-mono">
                {quota.todayCount}
                <span className="text-muted-foreground text-base font-normal"> / {quota.quota} чатов сегодня</span>
              </span>
              <span className="text-sm text-muted-foreground">
                Осталось: <span className="font-semibold">{quota.remaining}</span>
              </span>
            </div>
            <Progress
              value={quotaPct}
              className={`h-2 ${quotaExceeded ? "[&>div]:bg-red-500" : quotaWarning ? "[&>div]:bg-amber-500" : "[&>div]:bg-green-500"}`}
            />
            <p className="text-xs text-muted-foreground">
              {quotaExceeded
                ? `Квота исчерпана. Обработка автоматически продолжится в ${format(new Date(quota.resetAt), "HH:mm", { locale: ru })} (UTC полночь)`
                : `Счётчик сбрасывается в ${format(new Date(quota.resetAt), "HH:mm d MMM", { locale: ru })} UTC`}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Telegram */}
      <Card>
        <CardHeader>
          <CardTitle>Telegram API</CardTitle>
          <CardDescription>
            Получите App ID и App Hash на{" "}
            <a href="https://my.telegram.org/apps" target="_blank" rel="noopener noreferrer" className="underline text-primary">
              my.telegram.org/apps
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">App ID</label>
              <Input
                placeholder="12345678"
                value={form.telegram_api_id}
                onChange={set("telegram_api_id")}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">App Hash</label>
              <Input
                placeholder="abcdef1234..."
                value={form.telegram_api_hash}
                onChange={set("telegram_api_hash")}
                className="font-mono"
                type="password"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Session строка</label>
              <Button type="button" variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setShowSession((v) => !v)}>
                {showSession ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {showSession ? "Скрыть" : "Показать"}
              </Button>
            </div>
            <Textarea
              placeholder="Вставьте строку сессии gramjs/telethon..."
              value={form.telegram_session}
              onChange={set("telegram_session")}
              className={`font-mono text-xs min-h-[80px] ${!showSession ? "blur-sm select-none" : ""}`}
              onFocus={() => setShowSession(true)}
            />
            <p className="text-xs text-muted-foreground">
              Строку сессии можно получить с помощью скрипта авторизации gramjs/telethon.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* DeepSeek */}
      <Card>
        <CardHeader>
          <CardTitle>ИИ-анализ: DeepSeek V3</CardTitle>
          <CardDescription>
            API ключ для анализа чатов. Получить на{" "}
            <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer" className="underline text-primary">
              platform.deepseek.com
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">API ключ DeepSeek</label>
              <Button type="button" variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setShowApiKey((v) => !v)}>
                {showApiKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {showApiKey ? "Скрыть" : "Показать"}
              </Button>
            </div>
            <Input
              placeholder="sk-..."
              value={form.deepseek_api_key}
              onChange={set("deepseek_api_key")}
              type={showApiKey ? "text" : "password"}
              className="font-mono"
            />
          </div>
        </CardContent>
      </Card>

      {/* Параметры и квота */}
      <Card>
        <CardHeader>
          <CardTitle>Параметры и антибан</CardTitle>
          <CardDescription>Защита от блокировки Telegram</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Задержка (сек)</label>
              <Input type="number" min={10} max={300} value={form.default_delay_seconds} onChange={set("default_delay_seconds")} className="font-mono" />
              <p className="text-xs text-muted-foreground">Рекомендуется ≥45с</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Сообщений на чат</label>
              <Input type="number" min={10} max={500} value={form.default_messages_count} onChange={set("default_messages_count")} className="font-mono" />
              <p className="text-xs text-muted-foreground">Рекомендуется 30</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Дневная квота</label>
              <Input type="number" min={10} max={500} value={form.daily_quota} onChange={set("daily_quota")} className="font-mono" />
              <p className="text-xs text-muted-foreground">Макс. чатов/день</p>
            </div>
          </div>
          <div className="rounded-md bg-muted/50 border p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Рекомендованные настройки для безопасной работы:</p>
            <p>• Задержка: <strong>45–60 секунд</strong> (с автоматическим джиттером ±30%)</p>
            <p>• Сообщений: <strong>30</strong> (меньше запросов к Telegram)</p>
            <p>• Дневная квота: <strong>100–150 чатов</strong> в день</p>
            <p>• При 1000 чатах и квоте 150 — всё пройдёт за ~7 дней без риска бана</p>
          </div>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : saved ? (
            <CheckCircle className="w-4 h-4 text-green-500" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saving ? "Сохраняем..." : saved ? "Сохранено!" : "Сохранить настройки"}
        </Button>
      </div>
    </div>
  );
}
