import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCreateSession } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Play, FolderSearch, Plus, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const formSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(100),
  chatList: z.string().refine((val) => {
    const lines = val.split("\n").filter(line => line.trim() !== "");
    return lines.length > 0;
  }, "Укажите хотя бы один чат для анализа"),
  delaySeconds: z.coerce.number().min(1).max(300).default(30),
  messagesCount: z.coerce.number().min(1).max(1000).default(50),
});

type FormValues = z.infer<typeof formSchema>;

interface FolderResult {
  folderLink: string;
  folderTitle: string | null;
  chats: { identifier: string; title: string | null; username: string | null }[];
  error: string | null;
}

interface ExtractResponse {
  results: FolderResult[];
  allChats: string[];
  totalUnique: number;
}

export function NewSession() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [folderLinks, setFolderLinks] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractResult, setExtractResult] = useState<ExtractResponse | null>(null);

  const createSessionMutation = useCreateSession();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: `Анализ - ${new Date().toISOString().split("T")[0]}`,
      chatList: "",
      delaySeconds: 30,
      messagesCount: 50,
    },
  });

  useEffect(() => {
    fetch("/api/settings/raw")
      .then((r) => r.json())
      .then((data: { default_delay_seconds?: string; default_messages_count?: string }) => {
        if (data.default_delay_seconds) {
          form.setValue("delaySeconds", parseInt(data.default_delay_seconds, 10));
        }
        if (data.default_messages_count) {
          form.setValue("messagesCount", parseInt(data.default_messages_count, 10));
        }
      })
      .catch(() => {});
  }, []);

  const handleExtractFolders = async () => {
    const links = folderLinks
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (links.length === 0) {
      toast({ title: "Нет ссылок на папки", description: "Вставьте хотя бы одну ссылку t.me/addlist/...", variant: "destructive" });
      return;
    }

    setExtracting(true);
    setExtractResult(null);

    try {
      const res = await fetch("/api/folders/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderLinks: links }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Ошибка сервера: ${errText}`);
      }

      const data = (await res.json()) as ExtractResponse;
      setExtractResult(data);

      toast({
        title: `Найдено ${data.totalUnique} уникальных чатов`,
        description: `Из ${links.length} папки(ок)`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Ошибка извлечения", description: msg, variant: "destructive" });
    } finally {
      setExtracting(false);
    }
  };

  const handleAddToList = () => {
    if (!extractResult) return;
    const current = form.getValues("chatList");
    const existing = new Set(
      current
        .split("\n")
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean)
    );

    const newChats = extractResult.allChats.filter(
      (c) => !existing.has(c.toLowerCase())
    );

    const combined = [current, ...newChats].filter(Boolean).join("\n").trim();
    form.setValue("chatList", combined, { shouldValidate: true });

    toast({
      title: `Добавлено ${newChats.length} чатов в список`,
      description: newChats.length === 0 ? "Все чаты уже в списке" : undefined,
    });
  };

  const onSubmit = (data: FormValues) => {
    createSessionMutation.mutate(
      { data },
      {
        onSuccess: (session) => {
          toast({
            title: "Сессия создана",
            description: "Сессия успешно создана.",
          });
          setLocation(`/sessions/${session.id}`);
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Неожиданная ошибка";
          toast({
            title: "Ошибка создания сессии",
            description: msg,
            variant: "destructive",
          });
        },
      }
    );
  };

  const chatCount = form.watch("chatList")
    .split("\n")
    .filter((l) => l.trim().length > 0).length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Новая сессия анализа</h1>
          <p className="text-sm text-muted-foreground">Настройте новый пакетный запуск анализа Telegram-чатов.</p>
        </div>
      </div>

      {/* Извлечение из папок */}
      <Card data-testid="card-folder-extraction">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderSearch className="w-5 h-5" />
            Извлечь чаты из Telegram-папок
          </CardTitle>
          <CardDescription>
            Вставьте ссылки t.me/addlist/... — приложение автоматически достанет все чаты из этих папок.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Ссылки на папки</label>
            <Textarea
              data-testid="textarea-folder-links"
              placeholder={"https://t.me/addlist/AbCdEfGhIjKl\nhttps://t.me/addlist/XyZ123..."}
              className="min-h-[100px] font-mono text-sm"
              value={folderLinks}
              onChange={(e) => setFolderLinks(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">По одной ссылке на строку. Формат: t.me/addlist/SLUG</p>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleExtractFolders}
            disabled={extracting}
            data-testid="button-extract-folders"
            className="gap-2"
          >
            {extracting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FolderSearch className="w-4 h-4" />
            )}
            {extracting ? "Извлекаем..." : "Извлечь чаты из папок"}
          </Button>

          {extractResult && (
            <div className="space-y-3 pt-2" data-testid="section-extract-results">
              <Separator />
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  Найдено <span className="font-bold">{extractResult.totalUnique}</span> уникальных чатов
                </p>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleAddToList}
                  data-testid="button-add-to-list"
                  className="gap-2"
                >
                  <Plus className="w-3 h-3" />
                  Добавить в список
                </Button>
              </div>

              <div className="space-y-2">
                {extractResult.results.map((result, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 p-3 rounded-md border bg-muted/30 text-sm"
                    data-testid={`result-folder-${i}`}
                  >
                    {result.error ? (
                      <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                    ) : (
                      <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-muted-foreground truncate">{result.folderLink}</span>
                        {result.folderTitle && (
                          <Badge variant="secondary" className="text-xs">{result.folderTitle}</Badge>
                        )}
                      </div>
                      {result.error ? (
                        <p className="text-destructive text-xs mt-1">{result.error}</p>
                      ) : (
                        <p className="text-muted-foreground text-xs mt-1">{result.chats.length} чатов найдено</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Конфигурация сессии */}
      <Card>
        <CardHeader>
          <CardTitle>Конфигурация сессии</CardTitle>
          <CardDescription>Вставьте список чатов и задайте параметры анализа.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Название сессии</FormLabel>
                    <FormControl>
                      <Input data-testid="input-session-name" placeholder="Например: Эмиграция IT-групп ч.1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="chatList"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Целевые чаты</FormLabel>
                      {chatCount > 0 && (
                        <Badge variant="secondary" data-testid="badge-chat-count">{chatCount} чатов</Badge>
                      )}
                    </div>
                    <FormControl>
                      <Textarea
                        data-testid="textarea-chat-list"
                        placeholder="Вставьте @username или ссылки t.me/, по одному на строку..."
                        className="min-h-[200px] font-mono text-sm"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Ссылки t.me или @username. Один чат на строку.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="delaySeconds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Задержка между запросами (сек)</FormLabel>
                      <FormControl>
                        <Input data-testid="input-delay" type="number" {...field} />
                      </FormControl>
                      <FormDescription>
                        Защита от бана. Рекомендуется ≥30с.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="messagesCount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Сообщений для анализа</FormLabel>
                      <FormControl>
                        <Input data-testid="input-messages-count" type="number" {...field} />
                      </FormControl>
                      <FormDescription>
                        Последних сообщений на чат. По умолчанию 50.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end pt-4">
                <Button
                  type="submit"
                  data-testid="button-create-session"
                  disabled={createSessionMutation.isPending}
                  className="gap-2"
                >
                  {createSessionMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  Создать и запустить
                </Button>
              </div>

            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
