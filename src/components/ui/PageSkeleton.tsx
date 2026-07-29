import { Card } from "./Card";
import { Skeleton } from "./Skeleton";

type Block = "table" | "chart" | "tall";

export type PageSkeletonProps = {
  /** Celdas de la fila de KPIs; 0 la omite. */
  kpiCells?: 0 | 2 | 3;
  /** Secciones bajo la cabecera, en orden de aparición. */
  blocks?: Block[];
};

function BlockSkeleton({ kind }: { kind: Block }) {
  if (kind === "chart") {
    return (
      <Card>
        <Skeleton className="mb-4 h-5 w-44" />
        <Skeleton className="h-64 w-full" />
      </Card>
    );
  }
  if (kind === "tall") {
    return (
      <Card>
        <Skeleton className="h-[28rem] w-full" />
      </Card>
    );
  }
  return (
    <Card>
      <Skeleton className="mb-4 h-5 w-44" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-5/6" />
        <Skeleton className="h-6 w-2/3" />
      </div>
    </Card>
  );
}

/** Esqueleto de ruta para `loading.tsx`: feedback instantáneo al navegar
 *  mientras el servidor resuelve las queries de la página. */
export function PageSkeleton({ kpiCells = 0, blocks = ["table"] }: PageSkeletonProps) {
  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      {kpiCells > 0 ? (
        <Card className="p-0">
          <div
            className={`grid divide-y divide-border/60 ${
              kpiCells === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"
            } sm:divide-x sm:divide-y-0`}
          >
            {Array.from({ length: kpiCells }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2 p-5">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-8 w-36" />
                <Skeleton className="h-3 w-40" />
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      {blocks.map((kind, i) => (
        <BlockSkeleton key={i} kind={kind} />
      ))}
    </div>
  );
}
