import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, Plus, Trash2, RefreshCw, Loader2, Eye, EyeOff, ShieldAlert, CheckCircle2, Clock, Ban } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface TelegramAccount {
  id: number;
  label: string;
  apiId: string;
  apiHash: string;
  session: string;
  status: "active" | "flood_wait" | "banned" | "disabled";
  floodWaitUntil: string | null;
  priority: number;
  proxyHost: string | null;
  proxyPort: number | null;
  proxyUsername: string | null;
  proxyPassword: string | null;
  updatedAt: string;
}

const STATUS_CONFIG = {
  active: { label: "Активен", color: "bg-green-100 text-green-800 border-green-200", icon: CheckCircle2 },
  flood_wait: { label: "FloodWait", color: "bg-amber-100 text-amber-800 border-amber-200", icon: Clock },
  banned: { label: "Заблокирован", color: "bg-red-100 text-red-800 border-red-200", icon: Ban },
  disabled: { label: "Отключён", color: "bg-gray-100 text-gray-600 border-gray-200", icon: ShieldAlert },
};

const EMPTY_FORM = {
  label: "",
  apiId: "",
  apiHash: "",
  session: "",
  priority: "0",
  proxyHost: "",
  proxyPort: "",
  proxyUsername: "",
  proxyPassword: "",
};

export function Accounts() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<TelegramAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [showSession, setShowSession] = useState(false);
  const [showHash, setShowHash] = useState(false);
  const [resettingId, setResettingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/accounts")
      .then((r) => r.json())
      .then(setAccounts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 15s to update flood_wait timers
  useEffect(() => {
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const openAdd = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setShowSession(false);
    setShowHash(false);
    setShowDialog(true);
  };

  const openEdit = (acc: TelegramAccount) => {
    setEditId(acc.id);
    setForm({
      label: acc.label,
      apiId: acc.apiId,
      apiHash: "",
      session: "",
      priority: String(acc.priority),
      proxyHost: acc.proxyHost || "",
      proxyPort: acc.proxyPort ? String(acc.proxyPort) : "",
      proxyUsername: acc.proxyUsername || "",
      proxyPassword: "",
    });
    setShowSession(false);
    setShowHash(false);
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!form.apiId && !editId) {
      toast({ title: "Ошибка", description: "App ID обязателен", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const url = editId ? `/api/accounts/${editId}` : "/api/accounts";
      const method = editId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Ошибка сохранения");
      setShowDialog(false);
      load();
      toast({ title: editId ? "Аккаунт обновлён" : "Аккаунт добавлен" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Ошибка", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, label: string) => {
    if (!confirm(`Удалить аккаунт «${label}»?`)) return;
    await fetch(`/api/accounts/${id}`, { method: "DELETE" });
    load();
    toast({ title: "Аккаунт удалён" });
  };

  const handleResetBan = async (id: number) => {
    setResettingId(id);
    try {
      await fetch(`/api/accounts/${id}/reset-ban`, { method: "POST" });
      load();
      toast({ title: "Статус сброшен", description: "Аккаунт переведён в активный" });
    } finally {
      setResettingId(null);
    }
  };

  const handleToggleDisable = async (id: number, status: "active" | "disabled") => {
    await fetch(`/api/accounts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
    toast({ title: status === "disabled" ? "Аккаунт отключён" : "Аккаунт включён" });
  };

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/settings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Аккаунты Telegram</h1>
            <p className="text-sm text-muted-foreground">Управление аккаунтами с автопереключением</p>
          </div>
        </div>
        <Button onClick={openAdd} className="gap-2">
          <Plus className="w-4 h-4" />
          Добавить аккаунт
        </Button>
      </div>

      {/* How it works */}
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
        <CardContent className="pt-4 text-sm text-blue-800 dark:text-blue-200 space-y-1">
          <p className="font-semibold">Как работает автопереключение:</p>
          <p>• При FloodWait на одном аккаунте — процессор немедленно переключается на другой</p>
          <p>• Если оба в FloodWait — ждёт до восстановления того, кто освободится быстрее</p>
          <p>• При бане аккаунта — он помечается как «Заблокирован», можно сбросить вручную</p>
          <p>• Приоритет: аккаунт с бо́льшим числом используется в первую очередь</p>
        </CardContent>
      </Card>

      {/* Account list */}
      {loading ? (
        <div className="text-center py-10 text-muted-foreground">Загрузка...</div>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground space-y-3">
            <ShieldAlert className="w-10 h-10 mx-auto opacity-40" />
            <p>Нет аккаунтов. Добавьте хотя бы один для начала работы.</p>
            <Button onClick={openAdd} variant="outline" className="gap-2">
              <Plus className="w-4 h-4" />
              Добавить первый аккаунт
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {accounts.map((acc) => {
            const cfg = STATUS_CONFIG[acc.status];
            const Icon = cfg.icon;
            return (
              <Card key={acc.id} className="relative">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{acc.label}</span>
                        <Badge variant="outline" className={`text-xs ${cfg.color}`}>
                          <Icon className="w-3 h-3 mr-1" />
                          {cfg.label}
                          {acc.status === "flood_wait" && acc.floodWaitUntil && (
                            <span className="ml-1">
                              до {format(new Date(acc.floodWaitUntil), "HH:mm", { locale: ru })}
                            </span>
                          )}
                        </Badge>
                        {acc.priority > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            Приоритет {acc.priority}
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground font-mono">
                        App ID: {acc.apiId} · Hash: {acc.apiHash} · Сессия: {acc.session}
                        {acc.proxyHost && (
                          <span className="ml-2 text-blue-600">· Прокси: {acc.proxyHost}:{acc.proxyPort}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Обновлён: {format(new Date(acc.updatedAt), "d MMM HH:mm", { locale: ru })}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {(acc.status === "flood_wait" || acc.status === "banned" || acc.status === "disabled") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 text-xs"
                          onClick={() => handleResetBan(acc.id)}
                          disabled={resettingId === acc.id}
                        >
                          {resettingId === acc.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                          {acc.status === "disabled" ? "Включить" : "Сбросить"}
                        </Button>
                      )}
                      {acc.status === "active" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 text-xs text-muted-foreground"
                          onClick={() => handleToggleDisable(acc.id, "disabled")}
                        >
                          Отключить
                        </Button>
                      )}
                      {acc.status === "disabled" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 text-xs"
                          onClick={() => handleToggleDisable(acc.id, "active")}
                        >
                          Включить
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => openEdit(acc)}>
                        Изменить
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(acc.id, acc.label)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Редактировать аккаунт" : "Добавить аккаунт Telegram"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Название</label>
              <Input placeholder="Аккаунт 1" value={form.label} onChange={set("label")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">App ID</label>
                <Input
                  placeholder="12345678"
                  value={form.apiId}
                  onChange={set("apiId")}
                  className="font-mono"
                  disabled={!!editId}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Приоритет</label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="0"
                  value={form.priority}
                  onChange={set("priority")}
                  className="font-mono"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">App Hash</label>
                <Button type="button" variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setShowHash((v) => !v)}>
                  {showHash ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {showHash ? "Скрыть" : "Показать"}
                </Button>
              </div>
              <Input
                placeholder={editId ? "Оставьте пустым, чтобы не менять" : "abcdef1234..."}
                value={form.apiHash}
                onChange={set("apiHash")}
                type={showHash ? "text" : "password"}
                className="font-mono"
              />
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
                placeholder={editId ? "Оставьте пустым, чтобы не менять" : "Вставьте строку сессии gramjs/telethon..."}
                value={form.session}
                onChange={set("session")}
                className={`font-mono text-xs min-h-[70px] ${!showSession && form.session ? "blur-sm" : ""}`}
                onFocus={() => setShowSession(true)}
              />
            </div>

            {/* SOCKS5 Proxy Settings */}
            <div className="border-t pt-4 mt-4">
              <p className="text-sm font-medium mb-3">SOCKS5 Прокси (опционально)</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Хост</label>
                  <Input
                    placeholder="proxy.example.com"
                    value={form.proxyHost}
                    onChange={set("proxyHost")}
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Порт</label>
                  <Input
                    placeholder="1080"
                    value={form.proxyPort}
                    onChange={set("proxyPort")}
                    className="font-mono text-sm"
                    type="number"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Логин (если есть)</label>
                  <Input
                    placeholder="username"
                    value={form.proxyUsername}
                    onChange={set("proxyUsername")}
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Пароль (если есть)</label>
                  <Input
                    placeholder={editId ? "Оставьте пустым" : "password"}
                    value={form.proxyPassword}
                    onChange={set("proxyPassword")}
                    className="font-mono text-sm"
                    type="password"
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Отмена</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {editId ? "Сохранить" : "Добавить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
