import { eq, sql } from "drizzle-orm";
import { db, getDbPath } from "@/src/db/client";
import { accounts, priceHistory } from "@/src/db/schema";

export async function GET() {
  const version = process.env.npm_package_version ?? "dev";
  try {
    db.select({ n: sql<number>`count(*)` }).from(accounts).get();
    // max() en vez de ORDER BY+LIMIT: no hay índice por source y el sort
    // completo era gratuito solo mientras la tabla fuese pequeña.
    const lastYahoo = db
      .select({ pricedAt: sql<number | null>`max(${priceHistory.pricedAt})` })
      .from(priceHistory)
      .where(eq(priceHistory.source, "yahoo"))
      .get();
    const lastSync = lastYahoo?.pricedAt
      ? new Date(lastYahoo.pricedAt).toISOString()
      : null;
    return Response.json({
      status: "ok",
      version,
      dbPath: getDbPath(),
      prices: { lastSync },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { status: "error", version, dbPath: getDbPath(), error: message },
      { status: 500 },
    );
  }
}
