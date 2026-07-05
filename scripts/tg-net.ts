// Snapshot financiero para el comando /net del bot de Telegram.
// Solo lectura: imprime los KPIs de la home (patrimonio neto, liquidez,
// inversión a coste y a mercado, P&L latente y XIRR) en texto plano listo
// para reenviar al chat. No muta nada, así que es seguro junto al servicio
// en marcha (better-sqlite3 en WAL admite lectores concurrentes).
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local opcional — si no está, se usan los valores por defecto del entorno.
}

import { getOverviewKpis } from "../src/server/overview";
import { formatEur, formatPercent } from "../src/lib/format";

function signedPct(ratio: number | null): string {
  if (ratio == null) return "—";
  return `${ratio >= 0 ? "+" : ""}${formatPercent(ratio)}`;
}

async function main() {
  const k = await getOverviewKpis();
  const lines = [
    "📊 *Estado financiero*",
    "",
    `Patrimonio neto: *${formatEur(k.totalNetWorthEur)}*`,
    `Liquidez: ${formatEur(k.cashEur)}`,
    `Inversión (coste): ${formatEur(k.investedEur)}`,
    `Inversión (mercado): ${formatEur(k.investedMarketValueEur)}`,
    ...(k.realEstateEquityEur > 0
      ? [`Inmobiliario (equity): ${formatEur(k.realEstateEquityEur)}`]
      : []),
    `P&L latente: ${k.unrealizedPnlEur >= 0 ? "+" : ""}${formatEur(k.unrealizedPnlEur)} (${signedPct(k.unrealizedPnlPct)})`,
    `XIRR: ${signedPct(k.xirrPct)}`,
  ];
  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
