import { roundEur } from "../../lib/money";
import { marketEur } from "../../lib/money-types";
import type { YearEndBalance } from "./report";
import type { YearEndCashBalance } from "./yearEnd";
import type { Model720Block } from "./m720";

/** Sentinel country for balances whose account has no countryCode. They must
 *  not silently escape the 50k/20k checks — they land in a tainted block the
 *  seal gate refuses without explicit acknowledgement. */
export const UNKNOWN_COUNTRY = "??";

export function aggregateBlocksFromBalances(
  balances: YearEndBalance[],
  cashBalances: YearEndCashBalance[] = [],
): Model720Block[] {
  const map = new Map<string, Model720Block>();
  for (const b of balances) {
    const country = b.accountCountry ?? UNKNOWN_COUNTRY;
    const type: Model720Block["type"] =
      b.assetClassTax === "crypto"
        ? "crypto"
        : b.accountType === "bank" || b.accountType === "savings"
          ? "bank-accounts"
          : "broker-securities";
    const key = `${country}::${type}`;
    const cur =
      map.get(key) ??
      {
        country,
        type,
        valueEur: marketEur(0),
        hasUnvalued: false,
        hasStale: false,
        hasUnknownCountry: country === UNKNOWN_COUNTRY,
      };
    // Unvalued positions contribute nothing to the sum but taint the block —
    // a silent zero here is exactly what audit T4 forbids.
    cur.valueEur = marketEur(roundEur(cur.valueEur + (b.valueEur ?? 0)));
    cur.hasUnvalued = cur.hasUnvalued || b.unvalued;
    cur.hasStale = cur.hasStale || b.staleValuation;
    map.set(key, cur);
  }

  // Efectivo a 31-dic (field-check P1 #3): siempre bloque `bank-accounts` —
  // el art. 42 bis declara "cuentas en entidades financieras", y el cash de un
  // broker extranjero es una cuenta a estos efectos. Valor de ledger: nunca
  // taints unvalued/stale.
  for (const c of cashBalances) {
    const country = c.accountCountry ?? UNKNOWN_COUNTRY;
    const key = `${country}::bank-accounts`;
    const cur =
      map.get(key) ??
      {
        country,
        type: "bank-accounts" as const,
        valueEur: marketEur(0),
        hasUnvalued: false,
        hasStale: false,
        hasUnknownCountry: country === UNKNOWN_COUNTRY,
      };
    cur.valueEur = marketEur(roundEur(cur.valueEur + c.balanceEur));
    map.set(key, cur);
  }

  return [...map.values()];
}
