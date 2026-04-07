import { useListSessions } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Plus, Clock, FileText, BarChart2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SessionStatusBadge } from "@/components/session-status-badge";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Skeleton } from "@/components/ui/skeleton";

export function Dashboard() {
  const { data: sessions, isLoading, isError } = useListSessions({
    query: {
      refetchInterval: (query) => {
        const isAnyRunning = query.state.data?.some(s => s.status === "running");
        return isAnyRunning ? 5000 : false;
      }
    }
  });

  const runningCount = sessions?.filter(s => s.status === "running").length || 0;
  const totalChatsAnalyzed = sessions?.reduce((acc, s) => acc + s.processedChats, 0) || 0;
  const totalSessions = sessions?.length || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Дашборд</h1>
          <p className="text-muted-foreground">Обзор сессий анализа Telegram-групп.</p>
        </div>
        <Link href="/sessions/new">
          <Button className="gap-2">
            <Plus className="w-4 h-4" />
            Создать сессию
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Всего сессий</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{isLoading ? <Skeleton className="h-8 w-16" /> : totalSessions}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Активных</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{isLoading ? <Skeleton className="h-8 w-16" /> : runningCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Чатов проверено</CardTitle>
            <BarChart2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{isLoading ? <Skeleton className="h-8 w-16" /> : totalChatsAnalyzed}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Последние сессии</CardTitle>
          <CardDescription>Просматривайте и управляйте запусками анализа.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : isError ? (
            <div className="text-sm text-destructive py-4 text-center">Ошибка загрузки сессий</div>
          ) : !sessions || sessions.length === 0 ? (
            <div className="text-center py-10 border border-dashed rounded-lg">
              <p className="text-muted-foreground mb-4">Сессий пока нет.</p>
              <Link href="/sessions/new">
                <Button variant="outline" size="sm">Создать первую сессию</Button>
              </Link>
            </div>
          ) : (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Название</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Прогресс</TableHead>
                    <TableHead className="text-right">Создана</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell className="font-medium">
                        <Link href={`/sessions/${session.id}`} className="hover:underline hover:text-primary">
                          {session.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <SessionStatusBadge status={session.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono w-16 text-right">
                            {session.processedChats}/{session.totalChats}
                          </span>
                          <div className="w-24 h-2 bg-secondary rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-primary transition-all duration-500 ease-in-out" 
                              style={{ width: `${session.totalChats > 0 ? (session.processedChats / session.totalChats) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        {format(new Date(session.createdAt), "d MMM, HH:mm", { locale: ru })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
