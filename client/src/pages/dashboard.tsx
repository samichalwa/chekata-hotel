import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { BedDouble, Wallet, TrendingUp, TrendingDown, PartyPopper, UtensilsCrossed, CalendarClock } from "lucide-react";
import { PageHeader, StatCard } from "@/components/stat-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { formatKES, formatDate, todayISO, titleCase } from "@/lib/format";
import type { Room, AccommodationBooking, Facility, FacilityBooking, Order, Staff, Expense } from "@shared/schema";

const CHART_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

function firstOfMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function lastOfMonthISO(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}

export default function Dashboard() {
  const { data: rooms = [] } = useQuery<Room[]>({ queryKey: ["/api/rooms"] });
  const { data: bookings = [] } = useQuery<AccommodationBooking[]>({ queryKey: ["/api/accommodation-bookings"] });
  const { data: facilities = [] } = useQuery<Facility[]>({ queryKey: ["/api/facilities"] });
  const { data: facilityBookings = [] } = useQuery<FacilityBooking[]>({ queryKey: ["/api/facility-bookings"] });
  const { data: orders = [] } = useQuery<Order[]>({ queryKey: ["/api/orders"] });
  const { data: staff = [] } = useQuery<Staff[]>({ queryKey: ["/api/staff"] });
  const { data: expenses = [] } = useQuery<Expense[]>({ queryKey: ["/api/expenses"] });

  const fromDate = firstOfMonthISO();
  const toDate = lastOfMonthISO();
  const inRange = (d: string) => d >= fromDate && d <= toDate;

  const facilityById = useMemo(() => new Map(facilities.map((f) => [f.id, f])), [facilities]);

  const accommodationRevenue = useMemo(
    () => bookings.filter((b) => b.status !== "cancelled" && inRange(b.checkIn)).reduce((s, b) => s + b.totalAmount, 0),
    [bookings, fromDate, toDate]
  );
  const facilityRevenue = useMemo(
    () => facilityBookings.filter((b) => b.status !== "cancelled" && inRange(b.eventDate)).reduce((s, b) => s + b.totalAmount, 0),
    [facilityBookings, fromDate, toDate]
  );
  const barRevenue = useMemo(
    () => orders.filter((o) => o.outlet === "bar" && o.status === "paid" && inRange(o.orderDate)).reduce((s, o) => s + o.totalAmount, 0),
    [orders, fromDate, toDate]
  );
  const restaurantRevenue = useMemo(
    () => orders.filter((o) => o.outlet === "restaurant" && o.status === "paid" && inRange(o.orderDate)).reduce((s, o) => s + o.totalAmount, 0),
    [orders, fromDate, toDate]
  );
  const totalRevenue = accommodationRevenue + facilityRevenue + barRevenue + restaurantRevenue;

  const monthlyPayroll = staff.filter((s) => s.status === "active").reduce((s, m) => s + m.salary, 0);
  const expensesThisMonth = useMemo(() => expenses.filter((e) => inRange(e.date)).reduce((s, e) => s + e.amount, 0), [expenses, fromDate, toDate]);
  const totalCosts = monthlyPayroll + expensesThisMonth;
  const netProfit = totalRevenue - totalCosts;

  const occupiedRooms = rooms.filter((r) => r.status === "occupied").length;
  const occupancyRate = rooms.length > 0 ? Math.round((occupiedRooms / rooms.length) * 100) : 0;

  const today = todayISO();
  const upcomingAccommodation = bookings
    .filter((b) => b.status === "confirmed" && b.checkIn >= today)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
    .slice(0, 5);
  const upcomingFacility = facilityBookings
    .filter((b) => b.status === "confirmed" && b.eventDate >= today)
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
    .slice(0, 5);

  const chartData = [
    { name: "Accommodation", revenue: accommodationRevenue },
    { name: "Conference & Movie", revenue: facilityRevenue },
    { name: "Bar", revenue: barRevenue },
    { name: "Restaurant", revenue: restaurantRevenue },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Dashboard" description="The Chekata — overview for the current month." />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Revenue (this month)" value={formatKES(totalRevenue)} icon={TrendingUp} accent="success" testId="stat-dashboard-revenue" />
        <StatCard label="Costs (this month)" value={formatKES(totalCosts)} icon={TrendingDown} accent="warning" testId="stat-dashboard-costs" />
        <StatCard label="Net profit" value={formatKES(netProfit)} icon={Wallet} accent={netProfit >= 0 ? "success" : "warning"} testId="stat-dashboard-profit" />
        <StatCard label="Room occupancy" value={`${occupancyRate}%`} icon={BedDouble} hint={`${occupiedRooms} of ${rooms.length} rooms occupied`} testId="stat-dashboard-occupancy" />
        <StatCard label="Upcoming bookings" value={String(upcomingAccommodation.length + upcomingFacility.length)} icon={CalendarClock} testId="stat-dashboard-upcoming" />
        <StatCard label="Monthly payroll" value={formatKES(monthlyPayroll)} icon={Wallet} accent="muted" testId="stat-dashboard-payroll" />
      </div>

      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-4">Revenue by source (this month)</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))} />
              <Tooltip formatter={(v: number) => formatKES(v)} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                {chartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div className="flex items-center justify-between p-4 border-b border-card-border">
            <h2 className="text-lg font-semibold flex items-center gap-2"><BedDouble className="h-4 w-4" /> Upcoming stays</h2>
            <Link href="/accommodation" className="text-xs text-primary hover:underline" data-testid="link-view-accommodation">View all</Link>
          </div>
          {upcomingAccommodation.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">No upcoming confirmed stays.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Guest</TableHead>
                    <TableHead>Check-in</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcomingAccommodation.map((b) => (
                    <TableRow key={b.id} data-testid={`row-dashboard-booking-${b.id}`}>
                      <TableCell className="font-medium">{b.guestName}</TableCell>
                      <TableCell>{formatDate(b.checkIn)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKES(b.totalAmount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between p-4 border-b border-card-border">
            <h2 className="text-lg font-semibold flex items-center gap-2"><PartyPopper className="h-4 w-4" /> Upcoming events</h2>
            <Link href="/facilities" className="text-xs text-primary hover:underline" data-testid="link-view-facilities">View all</Link>
          </div>
          {upcomingFacility.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">No upcoming confirmed events.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Facility</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcomingFacility.map((b) => (
                    <TableRow key={b.id} data-testid={`row-dashboard-facility-booking-${b.id}`}>
                      <TableCell className="font-medium">{b.clientName}</TableCell>
                      <TableCell>{facilityById.get(b.facilityId)?.name ?? "—"}</TableCell>
                      <TableCell>{formatDate(b.eventDate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
