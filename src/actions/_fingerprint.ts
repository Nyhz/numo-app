import { createHash } from "node:crypto";

export function transactionFingerprint(parts: {
  accountId: string;
  assetId: string;
  tradeDate: string;
  side: "buy" | "sell";
  quantity: number;
  priceNative: number;
}): string {
  const key = [
    "manual",
    parts.accountId,
    parts.assetId,
    parts.tradeDate,
    parts.side,
    parts.quantity.toFixed(8),
    parts.priceNative.toFixed(8),
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

export function dividendFingerprint(parts: {
  accountId: string;
  assetId: string;
  tradeDate: string;
  grossNative: number;
  currency: string;
}): string {
  const key = [
    "manual-dividend",
    parts.accountId,
    parts.assetId,
    parts.tradeDate,
    parts.grossNative.toFixed(8),
    parts.currency,
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

export function swapFingerprint(parts: {
  accountId: string;
  outgoingAssetId: string;
  incomingAssetId: string;
  tradeDate: string;
  outgoingQuantity: number;
  incomingQuantity: number;
  valueEur: number;
  /** Each inserted leg needs its own fingerprint (unique index); the leg
   *  role salts the key so the two rows of one swap never collide. */
  leg: "sell" | "buy";
}): string {
  const key = [
    "manual-swap",
    parts.leg,
    parts.accountId,
    parts.outgoingAssetId,
    parts.incomingAssetId,
    parts.tradeDate,
    parts.outgoingQuantity.toFixed(8),
    parts.incomingQuantity.toFixed(8),
    parts.valueEur.toFixed(8),
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

export function assetWithdrawalFingerprint(parts: {
  accountId: string;
  assetId: string;
  tradeDate: string;
  quantity: number;
  valueEur: number;
}): string {
  const key = [
    "manual-asset-withdrawal",
    parts.accountId,
    parts.assetId,
    parts.tradeDate,
    parts.quantity.toFixed(8),
    parts.valueEur.toFixed(8),
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

export function cashMovementFingerprint(parts: {
  accountId: string;
  kind: string;
  occurredAt: string;
  amountNative: number;
  currency: string;
}): string {
  const key = [
    "manual",
    parts.accountId,
    parts.kind,
    parts.occurredAt,
    parts.amountNative.toFixed(8),
    parts.currency,
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}
