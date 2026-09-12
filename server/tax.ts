import type { Tax, TaxCategory } from "@shared/schema";

export interface TaxLine {
  name: string;
  ratePercent: number;
  amount: number;
}

export interface TaxBreakdown {
  preTaxBase: number;
  totalTax: number;
  lines: TaxLine[];
}

const CATEGORY_FIELD: Record<TaxCategory, keyof Tax> = {
  accommodation: "appliesAccommodation",
  facilities: "appliesFacilities",
  bar: "appliesBar",
  restaurant: "appliesRestaurant",
};

/**
 * Prices are entered tax-inclusive. Given the final total charged and the set of
 * taxes that apply to this revenue category, back-calculate the pre-tax base and
 * each tax's portion. Taxes are flat, non-compounding percentages of the same
 * pre-tax base (e.g. 3 taxes of 5%, 2%, 1% on a total of 1,080 => base = 1,080 / 1.08 = 1,000).
 */
export function computeInclusiveTaxBreakdown(
  total: number,
  allTaxes: Tax[],
  category: TaxCategory
): TaxBreakdown {
  const field = CATEGORY_FIELD[category];
  const applicable = allTaxes.filter((t) => t.active && Number(t[field]) === 1);

  if (applicable.length === 0 || !total) {
    return { preTaxBase: total, totalTax: 0, lines: [] };
  }

  const rateSum = applicable.reduce((s, t) => s + t.ratePercent, 0);
  const preTaxBase = total / (1 + rateSum / 100);

  const lines: TaxLine[] = applicable.map((t) => ({
    name: t.name,
    ratePercent: t.ratePercent,
    amount: round2((preTaxBase * t.ratePercent) / 100),
  }));

  const totalTax = round2(lines.reduce((s, l) => s + l.amount, 0));

  return { preTaxBase: round2(preTaxBase), totalTax, lines };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
