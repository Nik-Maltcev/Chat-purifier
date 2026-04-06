import { SessionStatus } from "@workspace/api-client-react/src/generated/api.schemas";
import { Badge } from "@/components/ui/badge";

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  switch (status) {
    case "idle":
      return <Badge variant="secondary" className="text-muted-foreground bg-muted font-mono text-xs">IDLE</Badge>;
    case "running":
      return <Badge variant="default" className="bg-blue-600 hover:bg-blue-600 font-mono text-xs">RUNNING</Badge>;
    case "paused":
      return <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200 font-mono text-xs">PAUSED</Badge>;
    case "completed":
      return <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200 font-mono text-xs">COMPLETED</Badge>;
    case "error":
      return <Badge variant="destructive" className="font-mono text-xs">ERROR</Badge>;
    default:
      return <Badge variant="outline" className="font-mono text-xs">{status}</Badge>;
  }
}
