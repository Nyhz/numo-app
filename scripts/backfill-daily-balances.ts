import { db } from "../src/db/client";
import { rebuildDailyBalances } from "../src/server/dailyBalances";

async function main() {
  console.log("Rebuilding daily_balances (serie diaria materializada)…");
  const rows = rebuildDailyBalances(db);
  console.log(`Done: ${rows} filas escritas.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
