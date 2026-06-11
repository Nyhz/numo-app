import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";

// Mirrors the KPI summary pattern: one Card with two divided cells
// (label / big value / caption), not the old row of standalone cards.
export function KpiRowSkeleton() {
  return (
    <Card className="p-0">
      <div className="grid divide-y divide-border/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5 p-5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-9 w-44" />
            <Skeleton className="h-3 w-56" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ChartCardSkeleton({
  title,
  heightClass = "h-80",
}: {
  title: string;
  heightClass?: string;
}) {
  return (
    <Card title={title}>
      <Skeleton className={`${heightClass} w-full`} />
    </Card>
  );
}

export function TableCardSkeleton({ title, rows = 6 }: { title: string; rows?: number }) {
  return (
    <Card title={title}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <Skeleton className="h-3 flex-1 opacity-70" />
          <Skeleton className="h-3 w-16 opacity-70" />
          <Skeleton className="h-3 w-20 opacity-70" />
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </Card>
  );
}
