import { SessionStatus } from "@workspace/api-client-react/src/generated/api.schemas";
import { Badge } from "@/components/ui/badge";

interface SessionStatusBadgeProps {
  status: SessionStatus;
  autoRestart?: boolean;
}

export function SessionStatusBadge({ status, autoRestart }: SessionStatusBadgeProps) {
  switch (status) {
    case "idle":
      return <Badge variant="secondary" className="text-muted-foreground bg-muted font-mono text-xs">ОЖИДАНИЕ</Badge>;
    case "running":
      return <Badge variant="default" className="bg-blue-600 hover:bg-blue-600 font-mono text-xs animate-pulse">РАБОТАЕТ</Badge>;
    case "paused":
      if (autoRestart) {
        return <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200 font-mono text-xs">АВТО-ПАУЗА</Badge>;
      }
      return <Badge variant="secondary" className="bg-gray-100 text-gray-600 hover:bg-gray-100 border-gray-200 font-mono text-xs">ОСТАНОВЛЕНО</Badge>;
    case "completed":
      return <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200 font-mono text-xs">ЗАВЕРШЕНО</Badge>;
    case "error":
      return <Badge variant="destructive" className="font-mono text-xs">ОШИБКА</Badge>;
    default:
      return <Badge variant="outline" className="font-mono text-xs">{status}</Badge>;
  }
}
