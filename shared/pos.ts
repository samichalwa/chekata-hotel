// Sales value of a bar/restaurant order for reports: paid orders and orders charged to a room count
// in full; a bill closed without full payment counts only what was actually paid (net of credits).
export function orderRevenue(o: { status: string; totalAmount: number; creditedAmount?: number | null; amountPaid?: number | null }): number {
  const credited = o.creditedAmount ?? 0;
  if (o.status === "paid" || o.status === "room_posted") return o.totalAmount - credited;
  if (o.status === "closed_unpaid") return Math.max(0, (o.amountPaid ?? 0) - credited);
  return 0;
}
export const isSoldOrder = (o: { status: string }) => o.status === "paid" || o.status === "room_posted" || o.status === "closed_unpaid";
