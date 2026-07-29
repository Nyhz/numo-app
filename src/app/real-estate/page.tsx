export const dynamic = "force-dynamic";

import { RealEstateDashboard } from "@/src/components/features/real-estate/RealEstateDashboard";
import { getRealEstateOverview, stripSchedules } from "@/src/server/realEstate";

export default async function RealEstatePage() {
  const overview = stripSchedules(await getRealEstateOverview());
  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Inmuebles</h1>
        <p className="text-sm text-muted-foreground">
          Patrimonio inmobiliario: valor, hipoteca y equity. Sin vínculo con la caja de tus
          cuentas — todo entra de cero.
        </p>
      </header>
      <RealEstateDashboard overview={overview} />
    </div>
  );
}
