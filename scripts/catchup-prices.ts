// Catch-up de precios tras una caída del host (SPEC §6). Lo lanza
// finances-service.sh en segundo plano en cada arranque del servicio:
//
//   1. Gate de frescura: si max(price_history.pricedDateUtc) >= ayer (Madrid),
//      el último cron de las 23:00 corrió — no-op sin salir a red (un restart
//      de deploy normal termina aquí).
//   2. Si es viejo, PRIMERO gap-fill por activo con el orquestador canónico de
//      reactivación (histórico de proveedores + FX + rebuild de valoraciones y
//      serie diaria). El orden importa: disparar el sync antes escribiría las
//      filas de hoy y cerraría en falso la ventana de detección del hueco
//      (max(fecha)+1) — lección de la caída del 20/21-08-2026.
//   3. Después, con el server ya sano, dispara el route del sync diario para
//      capturar la cotización viva de hoy + FX + composiciones.
//
// `--force` salta el gate (ambas fases son idempotentes). Nunca sale con
// código != 0: un fallo aquí se loguea, jamás desestabiliza el arranque.
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import { eq, max } from "drizzle-orm";
import { db } from "../src/db/client";
import { assets, priceHistory } from "../src/db/schema";
import { isPriceHistoryStale } from "../src/lib/price-staleness";
import { runReactivationBackfill } from "../src/server/reactivation";

const BASE_URL = "http://localhost:3200";
const HEALTH_DEADLINE_MS = 180_000;
const HEALTH_POLL_MS = 5_000;
const SYNC_TIMEOUT_MS = 300_000;

function log(msg: string): void {
  console.log(`[catchup ${new Date().toISOString()}] ${msg}`);
}

async function waitForServer(deadlineMs: number): Promise<boolean> {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(4_000) });
      if (res.status < 500) return true;
    } catch {
      // aún arrancando
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  return false;
}

async function main() {
  const force = process.argv.includes("--force");
  const row = await db
    .select({ last: max(priceHistory.pricedDateUtc) })
    .from(priceHistory)
    .get();
  const last = row?.last ?? null;

  if (!force && !isPriceHistoryStale(last, Date.now())) {
    log(`fresco (último cierre ${last ?? "—"}) — nada que hacer`);
    return;
  }
  log(
    force
      ? `--force (último cierre ${last ?? "—"})`
      : `viejo (último cierre ${last ?? "—"}) — recuperando`,
  );

  const active = await db
    .select({ id: assets.id, symbol: assets.symbol, name: assets.name })
    .from(assets)
    .where(eq(assets.isActive, true))
    .all();
  for (const a of active) {
    const label = a.symbol ?? a.name;
    try {
      const r = await runReactivationBackfill(
        a.id,
        undefined,
        undefined,
        "downtime_catchup",
      );
      log(
        r.gap.skipped
          ? `${label}: skip (${r.gap.skipped})`
          : `${label}: ${r.gap.fromIso ?? "al día"} → ${r.gap.toIso}, +${r.gap.priceRowsInserted} precios, +${r.gap.fxRowsInserted} fx`,
      );
    } catch (err) {
      log(`${label}: ERROR ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log("sin CRON_SECRET — gap-fill hecho, sync del día omitido");
    return;
  }
  if (!(await waitForServer(HEALTH_DEADLINE_MS))) {
    log("el server no responde — gap-fill hecho; el cron de las 23:00 completará el día");
    return;
  }
  const res = await fetch(`${BASE_URL}/api/cron/sync-prices`, {
    headers: { "x-cron-secret": secret },
    signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
  });
  const body = (await res.text()).slice(0, 600);
  log(`sync-prices → ${res.status} ${body}`);
}

main()
  .catch((err) => {
    log(`fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  })
  .finally(() => process.exit(0));
