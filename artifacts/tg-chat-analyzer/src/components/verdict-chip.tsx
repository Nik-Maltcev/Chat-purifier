import { ChatResultVerdict } from "@workspace/api-client-react/src/generated/api.schemas";

const LABELS: Record<string, string> = {
  keep: "ОСТАВИТЬ",
  filter: "УБРАТЬ",
  pending: "ОЖИДАНИЕ",
  error: "ОШИБКА",
};

export function VerdictChip({ verdict }: { verdict: ChatResultVerdict }) {
  if (!verdict) return <span className="text-xs text-muted-foreground font-mono">--</span>;

  let colorClass = "";

  switch (verdict) {
    case "keep":
      colorClass = "bg-green-100 text-green-800 border border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800/50";
      break;
    case "filter":
      colorClass = "bg-red-100 text-red-800 border border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800/50";
      break;
    case "pending":
      colorClass = "bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700";
      break;
    case "error":
      colorClass = "bg-orange-100 text-orange-800 border border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800/50";
      break;
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-mono font-medium ${colorClass}`}>
      {LABELS[verdict] ?? verdict.toUpperCase()}
    </span>
  );
}
