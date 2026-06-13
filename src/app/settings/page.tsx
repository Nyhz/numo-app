import { resolve } from "node:path";
import { Card } from "@/src/components/ui/Card";
import { WipeAppCard } from "@/src/components/features/settings/WipeAppCard";
import { ProfileEditor } from "@/src/components/features/advisor/ProfileEditor";
import { readProfile } from "@/src/lib/advisor/memory";

export const dynamic = "force-dynamic";

function fullDbPath(p: string | undefined): string {
  if (!p) return "(sin definir)";
  return resolve(process.cwd(), p);
}

export default function SettingsPage() {
  const rows: { label: string; value: string }[] = [
    { label: "Nombre de la aplicación", value: "Finances Panel" },
    { label: "Moneda base", value: "EUR" },
    { label: "DB_PATH", value: fullDbPath(process.env.DB_PATH) },
    { label: "Versión de Node", value: process.version },
  ];

  return (
    <div className="flex flex-col gap-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
        <p className="text-sm text-muted-foreground">
          Configuración de ejecución (solo lectura).
        </p>
      </header>

      <Card title="Entorno de ejecución">
        <dl className="divide-y divide-border">
          {rows.map((r) => (
            <div
              key={r.label}
              className="grid grid-cols-[10rem_1fr] gap-4 py-3 text-sm"
            >
              <dt className="font-medium text-muted-foreground">{r.label}</dt>
              <dd className="font-mono tabular-nums break-all">{r.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <ProfileEditor initialContent={readProfile()} defaultOpen />

      <WipeAppCard />
    </div>
  );
}
