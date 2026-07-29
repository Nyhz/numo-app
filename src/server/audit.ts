import { and, desc, eq, gte, lt, lte, or, type SQL } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { auditEvents, type AuditEvent } from "../db/schema";
import { decodeCursor, encodeCursor } from "../lib/pagination";

export type ListAuditEventsArgs = {
  cursor?: string;
  limit?: number;
  entityType?: string;
  entityId?: string;
  action?: string;
  source?: string;
  dateFrom?: number;
  dateTo?: number;
};

/** Fila del listado sin los blobs JSON (previous/next/context): el diff se
 *  carga bajo demanda al expandir — embarcar 50 blobs por página inflaba el
 *  payload RSC sin que la tabla los usara. */
export type AuditEventSummary = Omit<
  AuditEvent,
  "previousJson" | "nextJson" | "contextJson"
>;

export type ListAuditEventsResult = {
  items: AuditEventSummary[];
  nextCursor: string | null;
};

const DEFAULT_LIMIT = 50;

export async function listAuditEvents(
  args: ListAuditEventsArgs = {},
  db: DB = defaultDb,
): Promise<ListAuditEventsResult> {
  const limit = args.limit ?? DEFAULT_LIMIT;
  if (limit <= 0) throw new Error("listAuditEvents: limit must be > 0");

  const filters: SQL[] = [];
  if (args.entityType) filters.push(eq(auditEvents.entityType, args.entityType));
  if (args.entityId) filters.push(eq(auditEvents.entityId, args.entityId));
  if (args.action) filters.push(eq(auditEvents.action, args.action));
  if (args.source) filters.push(eq(auditEvents.source, args.source));
  if (typeof args.dateFrom === "number") filters.push(gte(auditEvents.createdAt, args.dateFrom));
  if (typeof args.dateTo === "number") filters.push(lte(auditEvents.createdAt, args.dateTo));

  if (args.cursor) {
    const cur = decodeCursor(args.cursor);
    const sortKey = typeof cur.sortKey === "number" ? cur.sortKey : Number(cur.sortKey);
    filters.push(
      or(
        lt(auditEvents.createdAt, sortKey),
        and(eq(auditEvents.createdAt, sortKey), lt(auditEvents.id, cur.id)),
      ) as SQL,
    );
  }

  const where = filters.length ? and(...filters) : undefined;
  const rows = await db
    .select({
      id: auditEvents.id,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      action: auditEvents.action,
      actorType: auditEvents.actorType,
      source: auditEvents.source,
      summary: auditEvents.summary,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ id: last.id, sortKey: last.createdAt }) : null;
  return { items, nextCursor };
}

export type AuditEventDiff = {
  previousJson: string | null;
  nextJson: string | null;
};

/** Blobs de un evento concreto, para el diff expandido de la tabla. */
export async function getAuditEventDiff(
  id: string,
  db: DB = defaultDb,
): Promise<AuditEventDiff | null> {
  const row = await db
    .select({
      previousJson: auditEvents.previousJson,
      nextJson: auditEvents.nextJson,
    })
    .from(auditEvents)
    .where(eq(auditEvents.id, id))
    .get();
  return row ?? null;
}
