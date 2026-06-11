import { Card } from "@/src/components/ui/Card";
import { Badge, type BadgeProps } from "@/src/components/ui/Badge";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import type { AnnotatedBlock, InformationalModelsStatus } from "@/src/server/tax/m720";
import type { TaxDeclaredBaseline } from "@/src/db/schema";
import { DeclaredBaselinesPanel } from "./DeclaredBaselinesPanel";

// Theme-token Badge variants only — the previous hardcoded ambers were
// unreadable in light mode and bypassed the theme system.
const STATUS_BADGE: Record<
  AnnotatedBlock["status"],
  { variant: BadgeProps["variant"]; label: string; hint: string }
> = {
  ok: {
    variant: "neutral",
    label: "sin obligación",
    hint: "Categoría conjunta por debajo de 50.000 € o sin variación >20.000 € desde la última declaración.",
  },
  new: {
    variant: "warning",
    label: "declarar (≥50k)",
    hint: "Bloque no declarado antes cuya categoría supera en conjunto los 50.000 € — toca presentar el modelo.",
  },
  delta_20k: {
    variant: "warning",
    label: "redeclarar (Δ>20k)",
    hint: "Variación de más de 20.000 € respecto a lo último declarado — toca volver a presentar.",
  },
  full_exit: {
    variant: "neutral",
    label: "extinción",
    hint: "Bloque declarado anteriormente que ya no existe — declarar la cancelación.",
  },
};

function BlockList({ title, blocks }: { title: string; blocks: AnnotatedBlock[] }) {
  if (blocks.length === 0) {
    return (
      <div className="rounded-md border border-border/40 p-4">
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-1 text-xs text-muted-foreground">Sin bloques extranjeros.</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border/40 p-4">
      <div className="text-sm font-medium">{title}</div>
      <ul className="mt-2 space-y-2">
        {blocks.map((b, i) => {
          const status = STATUS_BADGE[b.status];
          return (
            <li key={`${b.country}-${b.type}-${i}`} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">{b.country}</span>
                <span className="text-xs text-muted-foreground">{b.type}</span>
                <Badge variant={status.variant} title={status.hint}>
                  {status.label}
                </Badge>
                {b.hasUnknownCountry ? (
                  <Badge
                    variant="danger"
                    title="La cuenta de estos saldos no tiene país asignado — el bloque no se puede contrastar con ninguna geografía. Asigna el país en la página Accounts."
                  >
                    PAÍS DESCONOCIDO
                  </Badge>
                ) : null}
                {b.hasUnvalued ? (
                  <Badge
                    variant="danger"
                    title="Al menos una posición del bloque no tiene valoración a 31-dic — el valor declarado y los umbrales 50k/20k no son fiables."
                  >
                    SIN VALORAR
                  </Badge>
                ) : b.hasStale ? (
                  <Badge
                    variant="warning"
                    title="Al menos una posición se valoró con un precio de más de 10 días antes del cierre del año."
                  >
                    valor desfasado
                  </Badge>
                ) : null}
              </div>
              <div className="text-sm tabular-nums">
                <SensitiveValue>{formatEur(b.valueEur)}</SensitiveValue>
                {b.lastDeclaredEur != null ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    antes <SensitiveValue>{formatEur(b.lastDeclaredEur)}</SensitiveValue>
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function YearEndCard({
  year,
  models,
  baselines,
}: {
  year: number;
  models: InformationalModelsStatus;
  baselines: TaxDeclaredBaseline[];
}) {
  const hasUnvalued = [...models.m720.blocks, ...models.m721.blocks].some(
    (b) => b.hasUnvalued,
  );
  const hasUnknownCountry = [...models.m720.blocks, ...models.m721.blocks].some(
    (b) => b.hasUnknownCountry,
  );
  return (
    <Card title="Bienes en el extranjero a 31-dic (modelos 720 · 721)">
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        Declaraciones informativas: cuentas y valores en el extranjero (720) y cripto en
        el extranjero (721). Solo obligan a partir de 50.000 € conjuntos por categoría
        (todos los países a la vez), y se renuevan cuando la categoría varía más de
        20.000 € respecto a lo último declarado.
      </p>
      {hasUnvalued ? (
        <div
          role="alert"
          className="mx-4 mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Hay posiciones sin valoración a 31-dic — los valores de bloque las excluyen y
          los umbrales no son fiables. Pon un precio manual a los activos afectados
          (página Assets).
        </div>
      ) : null}
      {hasUnknownCountry ? (
        <div
          role="alert"
          className="mx-4 mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Hay saldos de cuentas sin país asignado (bloque «??») — no se pueden
          contrastar con los umbrales por geografía. Asigna el país a las cuentas
          afectadas (página Accounts).
        </div>
      ) : null}
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <BlockList title="Modelo 720 — cuentas y valores" blocks={models.m720.blocks} />
        <BlockList title="Modelo 721 — criptomonedas" blocks={models.m721.blocks} />
      </div>
      <DeclaredBaselinesPanel baselines={baselines} defaultYear={year - 1} />
    </Card>
  );
}
