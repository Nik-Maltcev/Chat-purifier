import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Save, Loader2, CheckCircle, Eye, EyeOff, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";

interface SettingsData {
  telegram_api_id: string;
  telegram_api_hash: string;
  telegram_session: string;
  deepseek_api_key: string;
  default_delay_seconds: string;
  default_messages_count: string;
}

export function Settings() {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [showSession, setShowSession] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const [form, setForm] = useState<SettingsData>({
    telegram_api_id: "",
    telegram_api_hash: "",
    telegram_session: "",
    deepseek_api_key: "",
    default_delay_seconds: "30",
    default_messages_count: "50",
  });

  useEffect(() => {
    fetch("/api/settings/raw")
      .then((r) => r.json())
      .then((data: SettingsData) => {
        setForm({
          telegram_api_id: data.telegram_api_id || "",
          telegram_api_hash: data.telegram_api_hash || "",
          telegram_session: data.telegram_session || "",
          deepseek_api_key: data.deepseek_api_key || "",
          default_delay_seconds: data.default_delay_seconds || "30",
          default_messages_count: data.default_messages_count || "50",
        });
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

      {/* Telegram */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>Telegram API</span>
          </CardTitle>
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
                placeholder="abcdef1234567890..."
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1"
                onClick={() => setShowSession((v) => !v)}
              >
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
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">API ключ DeepSeek</label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1"
                onClick={() => setShowApiKey((v) => !v)}
              >
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

      {/* Defaults */}
      <Card>
        <CardHeader>
          <CardTitle>Параметры по умолчанию</CardTitle>
          <CardDescription>Используются при создании новой сессии</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Задержка между чатами (сек)</label>
              <Input
                type="number"
                min={5}
                max={120}
                value={form.default_delay_seconds}
                onChange={set("default_delay_seconds")}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Минимум 30с чтобы не получить бан</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Сообщений для анализа</label>
              <Input
                type="number"
                min={10}
                max={1000}
                value={form.default_messages_count}
                onChange={set("default_messages_count")}
                className="font-mono"
              />
            </div>
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
