// Rellena assets.tradingviewSymbol + assets.logoUrl una única vez (idempotente:
// no machaca valores ya presentes salvo --force). Equities/ETFs vía TradingView;
// cripto toma el logo del thumb de CoinGecko. Uso:
//   pnpm backfill:tv [--force]
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { assets } from "../src/db/schema";
import { searchCoins } from "../src/lib/pricing";
import * as tradingview from "../src/lib/pricing/tradingview";
import { resolveTvListing } from "../src/lib/tradingview-backfill";

const force = process.argv.includes("--force");

async function main() {
  const rows = await db.select().from(assets).all();
  for (const asset of rows) {
    const done = asset.tradingviewSymbol != null && asset.logoUrl != null;
    if (done && !force) {
      console.log(`= ${asset.name}: ya resuelto`);
      continue;
    }
    let tradingviewSymbol = asset.tradingviewSymbol;
    let logoUrl = asset.logoUrl;
    if (asset.assetType === "crypto") {
      // CoinGecko: providerSymbol es el coin id ("ethereum"); el thumb sirve de logo.
      const idOrName = asset.providerSymbol ?? asset.symbol ?? asset.name;
      const coins = await searchCoins(idOrName);
      const coin = coins.find((c) => c.id === asset.providerSymbol) ?? coins[0];
      if ((force || logoUrl == null) && coin?.thumb) logoUrl = coin.thumb;
    } else {
      const res = await resolveTvListing(asset, {
        searchSymbols: tradingview.searchSymbols,
        fetchQuotes: tradingview.fetchQuotes,
      });
      if (force || tradingviewSymbol == null) tradingviewSymbol = res.tradingviewSymbol;
      if (force || logoUrl == null) logoUrl = res.logoUrl;
    }
    await db
      .update(assets)
      .set({ tradingviewSymbol, logoUrl, updatedAt: Date.now() })
      .where(eq(assets.id, asset.id))
      .run();
    console.log(`✓ ${asset.name}: tv=${tradingviewSymbol ?? "—"} logo=${logoUrl ? "sí" : "—"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
