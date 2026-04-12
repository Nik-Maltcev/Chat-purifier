import { useState } from "react";
import { useParams } from "wouter";
import { 
  useGetSession, 
  useGetSessionChats, 
  useGetSessionSummary,
  useStartSession,
  useStopSession,
  useExportSession
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { SessionStatusBadge } from "@/components/session-status-badge";
import { VerdictChip } from "@/components/verdict-chip";
import { ScorePill } from "@/components/score-pill";
import { Play, Square, Download, ArrowLeft, Info, RotateCcw } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const VERDICT_LABELS: Record<string, string> = {
  all: "Все",
  keep: "Оставить",
  filter: "Отфильтровать",
  error: "Ошибка",
  pending: "Ожидание",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "ожидание",
  fetching: "загрузка",
  analyzing: "анализ",
  done: "готово",
  error: "ошибка",
  skipped: "пропущен",
};

export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const sessionId = parseInt(id, 10);
  const { toast } = useToast();
  
  const [verdictFilter, setVerdictFilter] = useState<string | undefined>();
  const [exportVerdict, setExportVerdict] = useState<"keep" | "all">("keep");
  const [retrying, setRetrying] = useState(false);

  const shouldPoll = (s?: { status: string; autoRestart?: boolean }) =>
    s?.status === "running" || (s?.status === "paused" && s?.autoRestart);

  const { data: session, refetch: refetchSession } = useGetSession(sessionId, {
    query: {
      refetchInterval: (query) => shouldPoll(query.state.data) ? 5000 : false
    }
  });

  const { data: summary } = useGetSessionSummary(sessionId, {
    query: {
      refetchInterval: () => shouldPoll(session) ? 5000 : false
    }
  });

  const { data: chats } = useGetSessionChats(sessionId, 
    { verdict: verdictFilter as any },
    {
      query: {
        refetchInterval: () => shouldPoll(session) ? 5000 : false
      }
    }
  );

  const startMutation = useStartSession();
  const stopMutation = useStopSession();
  
  const { refetch: triggerExport, isFetching: isExporting } = useExportSession(
    sessionId,
    { verdict: exportVerdict as any },
    {
      query: {
        enabled: false,
      }
    }
  );
  
  const handleStart = () => {
    startMutation.mutate({ sessionId }, {
      onSuccess: () => {
        toast({ title: "Сессия запущена" });
        refetchSession();
      }
    });
  };

  const handleStop = () => {
    stopMutation.mutate({ sessionId }, {
      onSuccess: () => {
        toast({ title: "Сессия остановлена" });
        refetchSession();
      }
    });
  };

  const handleExport = async (verdict: "keep" | "all") => {
    setExportVerdict(verdict);
    try {
      setTimeout(async () => {
        const { data } = await triggerExport();
        if (data) {
          const blob = new Blob([data], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `session-${sessionId}-${verdict}.csv`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      }, 0);
    } catch (err) {
      toast({ title: "Ошибка экспорта", variant: "destructive" });
    }
  };

  const handleRetryErrors = async () => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/retry-errors`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        toast({ title: `Сброшено ${data.resetCount} ошибочных чатов`, description: "Они будут обработаны заново" });
        refetchSession();
      }
    } catch (err) {
      toast({ title: "Ошибка", variant: "destructive" });
    } finally {
      setRetrying(false);
    }
  };

  if (!session) return <div className="p-8 text-center text-muted-foreground">Загрузка...</div>;

  const progressPercent = session.totalChats > 0 ? (session.processedChats / session.totalChats) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{session.name}</h1>
              <SessionStatusBadge status={session.status} autoRestart={session.autoRestart} />
            </div>
            <p className="text-sm text-muted-foreground mt-1 font-mono">
              ID: {session.id} | Задержка: {session.delaySeconds}с | Контекст: {session.messagesCount} сообщ.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {session.status === "running" ? (
            <Button variant="destructive" size="sm" onClick={handleStop} disabled={stopMutation.isPending}>
              <Square className="w-4 h-4 mr-2" />
              Остановить
            </Button>
          ) : session.status === "paused" && session.autoRestart ? (
            <>
              <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                ⏳ Возобновится автоматически
              </span>
              <Button variant="outline" size="sm" onClick={handleStop} disabled={stopMutation.isPending} className="text-muted-foreground">
                <Square className="w-4 h-4 mr-2" />
                Остановить совсем
              </Button>
            </>
          ) : session.status !== "completed" ? (
            <Button variant="default" size="sm" onClick={handleStart} disabled={startMutation.isPending || session.processedChats >= session.totalChats}>
              <Play className="w-4 h-4 mr-2" />
              Запустить
            </Button>
          ) : null}

          {(summary?.errors || 0) > 0 && (
            <Button variant="outline" size="sm" onClick={handleRetryErrors} disabled={retrying}>
              <RotateCcw className={`w-4 h-4 mr-2 ${retrying ? 'animate-spin' : ''}`} />
              Повторить ошибки ({summary?.errors})
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="w-4 h-4 mr-2" />
                Экспорт
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport("keep")}>Только «Оставить»</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("all")}>Все чаты</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="col-span-1 md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Прогресс</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-end mb-2">
              <span className="text-2xl font-bold font-mono">{session.processedChats} <span className="text-muted-foreground text-sm">/ {session.totalChats}</span></span>
              <span className="text-sm font-medium">{Math.round(progressPercent)}%</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Вердикты</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-4">
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground">Оставить</span>
              <span className="text-xl font-bold text-green-600 font-mono">{summary?.keep || 0}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground">Убрать</span>
              <span className="text-xl font-bold text-red-600 font-mono">{summary?.filter || 0}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground">Ошибки</span>
              <span className="text-xl font-bold text-orange-600 font-mono">{summary?.errors || 0}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Средние баллы</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-4">
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground">Качество</span>
              <span className="text-xl font-bold font-mono">{summary?.avgScore ? summary.avgScore.toFixed(1) : '-'}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground">Спам</span>
              <span className="text-xl font-bold font-mono">{summary?.avgSpamScore ? summary.avgSpamScore.toFixed(1) : '-'}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Результаты по чатам</h3>
          <div className="flex gap-2">
            {(["all", "keep", "filter", "error", "pending"] as const).map(v => (
              <Button 
                key={v}
                variant={verdictFilter === v || (v === "all" && !verdictFilter) ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setVerdictFilter(v === "all" ? undefined : v)}
                className="h-7 text-xs px-2.5"
              >
                {VERDICT_LABELS[v]}
              </Button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-[180px]">Чат</TableHead>
                <TableHead>Страна</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Вердикт</TableHead>
                <TableHead className="text-center">Баллы (К/С/А/Т)</TableHead>
                <TableHead>Участников</TableHead>
                <TableHead className="max-w-[300px]">Вывод ИИ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chats?.map((chat) => (
                <TableRow key={chat.id}>
                  <TableCell className="font-mono text-xs font-medium truncate max-w-[180px]">
                    {chat.chatIdentifier}
                    {chat.chatTitle && <div className="text-muted-foreground truncate">{chat.chatTitle}</div>}
                  </TableCell>
                  <TableCell>
                    {chat.country ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 whitespace-nowrap">
                        {chat.country}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/30 text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-[10px] tracking-wider uppercase bg-transparent">
                      {STATUS_LABELS[chat.status] || chat.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <VerdictChip verdict={chat.verdict} />
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <ScorePill score={chat.score} />
                      <ScorePill score={chat.spamScore} />
                      <ScorePill score={chat.activityScore} />
                      <ScorePill score={chat.topicScore} />
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {chat.membersCount?.toLocaleString("ru-RU") || '-'}
                  </TableCell>
                  <TableCell className="text-sm max-w-[300px]">
                    {chat.aiSummary ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="truncate cursor-help text-muted-foreground flex items-center gap-1">
                            <Info className="w-3 h-3 flex-shrink-0" />
                            {chat.aiSummary}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs font-mono text-xs">
                          {chat.aiSummary}
                        </TooltipContent>
                      </Tooltip>
                    ) : chat.errorMessage ? (
                      <span className="text-destructive text-xs truncate block max-w-[300px]" title={chat.errorMessage}>
                        {chat.errorMessage}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/30">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {chats?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Нет чатов по выбранному фильтру.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

    </div>
  );
}
