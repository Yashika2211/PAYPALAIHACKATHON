/**
 * Deterministic bundle solver. The LLM only explains the choice afterwards.
 * Picks the cheapest set of final offers that covers every required category
 * within budget, preferring fewer merchants on ties. n is small (≤ 10 merchants),
 * so exhaustive search is exact and fast.
 */

export interface CandidateOffer {
  offerId: string;
  merchantId: string;
  totalCents: number;
  firstQuoteCents: number;
  categories: readonly string[];
}

export interface Bundle {
  offers: CandidateOffer[];
  totalCents: number;
  firstQuoteTotalCents: number;
  savingsCents: number;
}

export type SolveResult =
  | { ok: true; bundle: Bundle }
  | { ok: false; reason: "no_offers" | "cannot_cover" | "over_budget"; cheapestCents?: number };

export function solveBundle(
  candidates: readonly CandidateOffer[],
  requiredCategories: readonly string[],
  budgetCents: number,
): SolveResult {
  if (candidates.length === 0) return { ok: false, reason: "no_offers" };
  if (candidates.length > 16) throw new Error("too many candidates for exhaustive search");

  let best: CandidateOffer[] | null = null;
  let bestTotal = Infinity;
  let cheapestCovering = Infinity;

  for (let mask = 1; mask < 1 << candidates.length; mask++) {
    const picked = candidates.filter((_, i) => mask & (1 << i));
    // One offer per merchant.
    if (new Set(picked.map((o) => o.merchantId)).size !== picked.length) continue;
    const covered = new Set(picked.flatMap((o) => o.categories));
    if (!requiredCategories.every((c) => covered.has(c))) continue;

    const total = picked.reduce((s, o) => s + o.totalCents, 0);
    cheapestCovering = Math.min(cheapestCovering, total);
    if (total > budgetCents) continue;
    if (total < bestTotal || (total === bestTotal && best && picked.length < best.length)) {
      best = picked;
      bestTotal = total;
    }
  }

  if (!best) {
    return cheapestCovering === Infinity
      ? { ok: false, reason: "cannot_cover" }
      : { ok: false, reason: "over_budget", cheapestCents: cheapestCovering };
  }
  const firstQuoteTotalCents = best.reduce((s, o) => s + o.firstQuoteCents, 0);
  return {
    ok: true,
    bundle: {
      offers: best,
      totalCents: bestTotal,
      firstQuoteTotalCents,
      savingsCents: firstQuoteTotalCents - bestTotal,
    },
  };
}
