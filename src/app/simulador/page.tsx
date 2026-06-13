export const dynamic = "force-dynamic";

import { SimulatorPanel } from "@/src/components/features/simulator/SimulatorPanel";
import { getOverviewKpis } from "@/src/server/overview";

export default async function SimuladorPage() {
  const kpis = await getOverviewKpis({ range: "ALL", accountIds: [] });
  const baseYear = new Date().getFullYear();

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Simulador</h1>
        <p className="text-sm text-muted-foreground">
          Proyecta el crecimiento de tu cartera con interés compuesto. Prerellenado con tu
          patrimonio actual — ajústalo a tus hipótesis.
        </p>
      </header>

      <SimulatorPanel
        initialCapitalEur={kpis.totalNetWorthEur}
        baseYear={baseYear}
      />
    </div>
  );
}
