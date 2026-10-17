// Metered water billing — shared by the server (bills) and the readings screen (live preview).
// Meters read in cubic metres (m³). Tariff prices are tax-inclusive, like every other price.
export interface WaterBand { upTo: number | null; rate: number } // upTo = cumulative m³ ceiling for this band; null = everything above
export interface WaterTariffLike { name: string; bands: WaterBand[]; serviceCharge: number; minimumCharge: number }
export interface WaterChargeLine { label: string; units: number; rate: number; amount: number }
export interface WaterCharge { consumption: number; lines: WaterChargeLine[]; consumptionAmount: number; serviceCharge: number; minimumTopUp: number; total: number }

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function normalizeBands(bands: WaterBand[]): WaterBand[] {
  const clean = (bands || []).map((b) => ({ upTo: b.upTo === null || b.upTo === undefined || (b.upTo as any) === "" ? null : Number(b.upTo), rate: Number(b.rate) || 0 }));
  const capped = clean.filter((b) => b.upTo !== null).sort((a, b) => (a.upTo as number) - (b.upTo as number));
  const open = clean.find((b) => b.upTo === null);
  return open ? [...capped, open] : capped;
}

export function validateTariff(t: { name?: string; bands?: WaterBand[]; serviceCharge?: number; minimumCharge?: number }): string | null {
  if (!t.name || !t.name.trim()) return "Give the tariff a name.";
  const raw = t.bands || [];
  if (raw.filter((b) => b.upTo === null || b.upTo === undefined || (b.upTo as any) === "").length > 1) return "Only the last band can be open-ended — fill in \"up to\" on the others.";
  const bands = normalizeBands(raw);
  if (!bands.length) return "Add at least one price band.";
  if (bands[bands.length - 1].upTo !== null) return "The last band must cover everything above (leave \"up to\" blank).";
  let prev = 0;
  for (const b of bands) {
    if (!(b.rate >= 0)) return "Band prices can't be negative.";
    if (b.upTo !== null) { if (!(b.upTo > prev)) return "Each band's \"up to\" must be higher than the one before."; prev = b.upTo; }
  }
  if ((t.serviceCharge ?? 0) < 0 || (t.minimumCharge ?? 0) < 0) return "Charges can't be negative.";
  return null;
}

export function calcWaterCharge(consumption: number, tariff: WaterTariffLike): WaterCharge {
  const used = Math.max(0, r3(consumption));
  const bands = normalizeBands(tariff.bands);
  const lines: WaterChargeLine[] = [];
  let from = 0;
  for (const b of bands) {
    if (used <= from) break;
    const to = b.upTo === null ? used : Math.min(used, b.upTo);
    const units = r3(to - from);
    if (units > 0) {
      const label = b.upTo === null ? (from === 0 ? "All units" : `Above ${from} m³`) : (from === 0 ? `First ${b.upTo} m³` : `${from}–${b.upTo} m³`);
      lines.push({ label, units, rate: b.rate, amount: r2(units * b.rate) });
    }
    from = b.upTo === null ? used : b.upTo;
  }
  const consumptionAmount = r2(lines.reduce((t, l) => t + l.amount, 0));
  const serviceCharge = r2(Number(tariff.serviceCharge) || 0);
  const subtotal = r2(consumptionAmount + serviceCharge);
  const minimumTopUp = r2(Math.max(0, (Number(tariff.minimumCharge) || 0) - subtotal));
  return { consumption: used, lines, consumptionAmount, serviceCharge, minimumTopUp, total: r2(subtotal + minimumTopUp) };
}

/** Units used. On a meter replacement: old meter's final reading − previous, plus new meter's reading − its start. */
export function consumptionOf(previous: number, current: number, replaced?: { oldFinal: number; newStart: number } | null): number {
  if (replaced) return r3(Math.max(0, replaced.oldFinal - previous) + Math.max(0, current - replaced.newStart));
  return r3(current - previous);
}

export const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, (mo || 1) - 1, 15)).toLocaleDateString("en-KE", { month: "long", year: "numeric", timeZone: "UTC" });
};

/** One more bill in a month that already has bills. The price steps continue from the units already billed this
 *  month (`prevUsed`), the service charge is only on the month's first bill, and the minimum applies once a month:
 *  this bill = month's charge for (prevUsed + used) − what the month's earlier bills already charged (`prevCharged`). */
export function calcWaterChargeStep(prevUsed: number, prevCharged: number, used: number, tariff: WaterTariffLike, firstOfMonth: boolean): WaterCharge & { monthUsedBefore: number; monthChargedBefore: number } {
  const u0 = Math.max(0, r3(prevUsed)); const u = Math.max(0, r3(used));
  if (firstOfMonth && u0 === 0) return { ...calcWaterCharge(u, tariff), monthUsedBefore: 0, monthChargedBefore: 0 };
  const whole = calcWaterCharge(u0 + u, tariff);
  const bands = normalizeBands(tariff.bands);
  const lines: WaterChargeLine[] = [];
  let from = 0;
  for (const b of bands) {
    const to = b.upTo === null ? Infinity : b.upTo;
    const lo = Math.max(from, u0), hi = Math.min(to, u0 + u);
    const units = r3(hi - lo);
    if (units > 0) {
      const label = b.upTo === null ? (from === 0 ? "All units" : `Above ${from} m³`) : (from === 0 ? `First ${b.upTo} m³` : `${from}–${b.upTo} m³`);
      lines.push({ label, units, rate: b.rate, amount: r2(units * b.rate) });
    }
    if (b.upTo === null) break;
    from = b.upTo;
  }
  const consumptionAmount = r2(lines.reduce((t, l) => t + l.amount, 0));
  const serviceCharge = firstOfMonth ? r2(Number(tariff.serviceCharge) || 0) : 0;
  const total = r2(Math.max(0, whole.total - (Number(prevCharged) || 0)));
  const minimumTopUp = r2(total - consumptionAmount - serviceCharge);
  return { consumption: u, lines, consumptionAmount, serviceCharge, minimumTopUp, total, monthUsedBefore: u0, monthChargedBefore: r2(Number(prevCharged) || 0) };
}
