export function ScorePill({ score }: { score?: number | null }) {
  if (score === undefined || score === null) {
    return <span className="text-muted-foreground/50 font-mono text-xs">-</span>;
  }

  let colorClass = "";
  
  if (score >= 8) {
    colorClass = "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800";
  } else if (score >= 5) {
    colorClass = "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800";
  } else {
    colorClass = "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800";
  }

  return (
    <div className={`inline-flex items-center justify-center w-6 h-6 rounded border font-mono text-xs font-semibold ${colorClass}`}>
      {score}
    </div>
  );
}
