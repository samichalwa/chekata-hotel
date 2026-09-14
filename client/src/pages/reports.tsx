import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { TrendingUp, TrendingDown, Wallet, Filter, Download, FileSpreadsheet, Users2, Wrench, PiggyBank, Boxes } from "lucide-react";
import { PageHeader, StatCard } from "@/components/stat-card";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { formatKES, todayISO, titleCase, formatDate, nightsBetween } from "@/lib/format";
import type { AccommodationBooking, Facility, FacilityBooking, Order, Staff, Expense, Room, MovieShow, MovieSeatBooking, MaintenanceIssue, MaintenanceCategory, Asset, AssetCategory, AssetDepreciationSchedule } from "@shared/schema";
import { MAINTENANCE_CATEGORY_LABELS } from "@shared/schema";

function firstOfMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

const CHART_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

type ExportSheet = "all" | "overview" | "accommodation" | "facilities" | "bar-restaurant" | "staff" | "expenses" | "maintenance" | "budgeting" | "assets";

type BudgetVarianceRow = { month: string; incomeStreamCode: string; incomeStreamLabel: string; budgetedAmount: number; actualAmount: number; variance: number };

function exportUrl(sheet: ExportSheet, fromDate: string, toDate: string): string {
  const params = new URLSearchParams();
  if (fromDate) params.set("from", fromDate);
  if (toDate) params.set("to", toDate);
  params.set("sheet", sheet);
  return `/api/reports/export?${params.toString()}`;
}

function ExportButton({ sheet, fromDate, toDate, label, variant = "outline" }: { sheet: ExportSheet; fromDate: string; toDate: string; label: string; variant?: "default" | "outline" }) {
  return (
    <Button variant={variant} size="sm" asChild data-testid={`button-export-${sheet}`}>
      <a href={exportUrl(sheet, fromDate, toDate)}>
        <Download className="h-3.5 w-3.5 mr-1.5" />
        {label}
      </a>
    </Button>
  );
}

export default function Reports() {
  const [fromDate, setFromDate] = useState(firstOfMonthISO());
  const [toDate, setToDate] = useState(todayISO());

  const { data: bookings = [] } = useQuery<AccommodationBooking[]>({ queryKey: ["/api/accommodation-bookings"] });
  const { data: rooms = [] } = useQuery<Room[]>({ queryKey: ["/api/rooms"] });
  const { data: facilities = [] } = useQuery<Facility[]>({ queryKey: ["/api/facilities"] });
  const { data: facilityBookings = [] } = useQuery<FacilityBooking[]>({ queryKey: ["/api/facility-bookings"] });
  const { data: orders = [] } = useQuery<Order[]>({ queryKey: ["/api/orders"] });
  const { data: staff = [] } = useQuery<Staff[]>({ queryKey: ["/api/staff"] });
  const { data: expenses = [] } = useQuery<Expense[]>({ queryKey: ["/api/expenses"] });
  const { data: movieShows = [] } = useQuery<MovieShow[]>({ queryKey: ["/api/movie-shows"] });
  const { data: movieSeatBookings = [] } = useQuery<MovieSeatBooking[]>({ queryKey: ["/api/movie-seat-bookings"] });
  const { data: maintenanceIssues = [] } = useQuery<MaintenanceIssue[]>({ queryKey: ["/api/maintenance-issues"] });
  const { data: assetsList = [] } = useQuery<Asset[]>({ queryKey: ["/api/assets"] });
  const { data: assetCategories = [] } = useQuery<AssetCategory[]>({ queryKey: ["/api/asset-categories"] });
  const budgetFromMonth = (fromDate || firstOfMonthISO()).slice(0, 7);
  const budgetToMonth = (toDate || todayISO()).slice(0, 7);
  const { data: budgetVariance = [] } = useQuery<BudgetVarianceRow[]>({ queryKey: [`/api/budget-lines/variance?from=${budgetFromMonth}&to=${budgetToMonth}`] });

  const inRange = (d: string) => (!fromDate || d >= fromDate) && (!toDate || d <= toDate);

  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  const facilityById = useMemo(() => new Map(facilities.map((f) => [f.id, f])), [facilities]);

  const accommodationRevenue = useMemo(
    () => bookings.filter((b) => b.status !== "cancelled" && inRange(b.checkIn)).reduce((s, b) => s + b.totalAmount, 0),
    [bookings, fromDate, toDate]
  );

  const facilityRevenueByName = useMemo(() => {
    const map = new Map<string, number>();
    facilityBookings
      .filter((b) => b.status !== "cancelled" && inRange(b.eventDate))
      .forEach((b) => {
        const name = facilityById.get(b.facilityId)?.name ?? "Other facility";
        map.set(name, (map.get(name) ?? 0) + b.totalAmount);
      });
    return map;
  }, [facilityBookings, facilityById, fromDate, toDate]);

  const facilityRevenue = Array.from(facilityRevenueByName.values()).reduce((s, v) => s + v, 0);

  const barRevenue = useMemo(
    () => orders.filter((o) => o.outlet === "bar" && o.status === "paid" && inRange(o.orderDate)).reduce((s, o) => s + o.totalAmount, 0),
    [orders, fromDate, toDate]
  );
  const restaurantRevenue = useMemo(
    () => orders.filter((o) => o.outlet === "restaurant" && o.status === "paid" && inRange(o.orderDate)).reduce((s, o) => s + o.totalAmount, 0),
    [orders, fromDate, toDate]
  );

  const movieShowById = useMemo(() => new Map(movieShows.map((s) => [s.id, s])), [movieShows]);
  const movieRevenue = useMemo(
    () => movieSeatBookings.filter((b) => b.status !== "cancelled" && inRange(movieShowById.get(b.showId)?.showDate ?? "")).reduce((s, b) => s + b.amountPaid, 0),
    [movieSeatBookings, movieShowById, fromDate, toDate]
  );

  const totalRevenue = accommodationRevenue + facilityRevenue + barRevenue + restaurantRevenue + movieRevenue;

  const periodMonths = useMemo(() => {
    if (!fromDate || !toDate) return 1;
    const days = (new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000 + 1;
    return Math.max(1, Math.round(days / 30));
  }, [fromDate, toDate]);

  const activeStaff = useMemo(() => staff.filter((s) => s.status === "active"), [staff]);
  const monthlyPayroll = activeStaff.reduce((s, m) => s + m.salary, 0);
  const proratedPayroll = monthlyPayroll * periodMonths;

  const expensesInRange = useMemo(() => expenses.filter((e) => inRange(e.date)), [expenses, fromDate, toDate]);
  const expensesByCategory = useMemo(() => {
    const map = new Map<string, number>();
    expensesInRange.forEach((e) => map.set(e.category, (map.get(e.category) ?? 0) + e.amount));
    return map;
  }, [expensesInRange]);
  const otherExpensesTotal = Array.from(expensesByCategory.values()).reduce((s, v) => s + v, 0);
  const maintenanceTotal = expensesByCategory.get("maintenance") ?? 0;

  const totalCosts = proratedPayroll + otherExpensesTotal;
  const netProfit = totalRevenue - totalCosts;

  const revenueRows = [
    { label: "Accommodation", value: accommodationRevenue },
    ...Array.from(facilityRevenueByName.entries()).map(([label, value]) => ({ label, value })),
    { label: "Movie Room", value: movieRevenue },
    { label: "Bar", value: barRevenue },
    { label: "Restaurant", value: restaurantRevenue },
  ].filter((r) => r.value > 0 || r.label === "Accommodation" || r.label === "Bar" || r.label === "Restaurant");

  const chartData = revenueRows.map((r) => ({ name: r.label, revenue: r.value }));

  const costRows = [
    { label: "Staff payroll", value: proratedPayroll },
    ...Array.from(expensesByCategory.entries()).map(([cat, value]) => ({ label: titleCase(cat), value })),
  ];

  const bookingsInRange = useMemo(
    () => bookings.filter((b) => inRange(b.checkIn)).sort((a, b) => a.checkIn.localeCompare(b.checkIn)),
    [bookings, fromDate, toDate]
  );
  const facilityBookingsInRange = useMemo(
    () => facilityBookings.filter((b) => inRange(b.eventDate)).sort((a, b) => a.eventDate.localeCompare(b.eventDate)),
    [facilityBookings, fromDate, toDate]
  );
  const movieBookingsInRange = useMemo(
    () => movieSeatBookings
      .filter((b) => inRange(movieShowById.get(b.showId)?.showDate ?? ""))
      .sort((a, b) => (movieShowById.get(a.showId)?.showDate ?? "").localeCompare(movieShowById.get(b.showId)?.showDate ?? "")),
    [movieSeatBookings, movieShowById, fromDate, toDate]
  );
  const ordersInRange = useMemo(
    () => orders.filter((o) => inRange(o.orderDate)).sort((a, b) => a.orderDate.localeCompare(b.orderDate)),
    [orders, fromDate, toDate]
  );

  const maintenanceInRange = useMemo(
    () => maintenanceIssues.filter((i) => inRange(new Date(i.createdAt).toISOString().slice(0, 10))).sort((a, b) => b.createdAt - a.createdAt),
    [maintenanceIssues, fromDate, toDate]
  );
  const openMaintenanceCount = useMemo(() => maintenanceInRange.filter((i) => i.status === "open" || i.status === "in_progress").length, [maintenanceInRange]);

  const departmentSummary = useMemo(() => {
    const map = new Map<string, { count: number; payroll: number }>();
    activeStaff.forEach((s) => {
      const agg = map.get(s.department) ?? { count: 0, payroll: 0 };
      agg.count += 1; agg.payroll += s.salary;
      map.set(s.department, agg);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].payroll - a[1].payroll);
  }, [activeStaff]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Reports"
        description="Every revenue and cost center, with Excel export for personnel, maintenance, revenue and cost reporting."
        action={<ExportButton sheet="all" fromDate={fromDate} toDate={toDate} label="Export full report (.xlsx)" variant="default" />}
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Period</span>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" data-testid="input-report-from-date" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" data-testid="input-report-to-date" />
          <Button variant="ghost" size="sm" onClick={() => { setFromDate(firstOfMonthISO()); setToDate(todayISO()); }} data-testid="button-reset-report-period">
            This month
          </Button>
          <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1.5">
            <FileSpreadsheet className="h-3.5 w-3.5" /> Every tab below can be exported on its own too
          </span>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total revenue" value={formatKES(totalRevenue)} icon={TrendingUp} accent="success" testId="stat-total-revenue" />
        <StatCard label="Total costs" value={formatKES(totalCosts)} icon={TrendingDown} accent="warning" testId="stat-total-costs" />
        <StatCard label="Net profit" value={formatKES(netProfit)} icon={Wallet} accent={netProfit >= 0 ? "success" : "warning"} testId="stat-net-profit" />
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview" data-testid="tab-report-overview">Overview</TabsTrigger>
          <TabsTrigger value="accommodation" data-testid="tab-report-accommodation">Accommodation</TabsTrigger>
          <TabsTrigger value="facilities" data-testid="tab-report-facilities">Conference &amp; Movie Room</TabsTrigger>
          <TabsTrigger value="bar-restaurant" data-testid="tab-report-bar-restaurant">Bar &amp; Restaurant</TabsTrigger>
          <TabsTrigger value="staff" data-testid="tab-report-staff">Personnel &amp; Payroll</TabsTrigger>
          <TabsTrigger value="expenses" data-testid="tab-report-expenses">Expenses</TabsTrigger>
          <TabsTrigger value="maintenance" data-testid="tab-report-maintenance">Maintenance</TabsTrigger>
          <TabsTrigger value="budgeting" data-testid="tab-report-budgeting">Budgeting</TabsTrigger>
          <TabsTrigger value="assets" data-testid="tab-report-assets">Assets</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-6 mt-4">
          <div className="flex justify-end">
            <ExportButton sheet="overview" fromDate={fromDate} toDate={toDate} label="Export summary" />
          </div>
          <Card className="p-4">
            <h2 className="text-lg font-semibold mb-4">Revenue by source</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} interval={0} angle={-15} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))} />
                  <Tooltip formatter={(v: number) => formatKES(v)} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                    {chartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <div className="p-4 border-b border-card-border">
              <h2 className="text-lg font-semibold">Profit & loss summary</h2>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableBody>
                  <TableRow className="bg-muted/40">
                    <TableCell className="font-semibold" colSpan={2}>Revenue</TableCell>
                  </TableRow>
                  {revenueRows.map((r) => (
                    <TableRow key={r.label} data-testid={`row-report-revenue-${r.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      <TableCell className="pl-8">{r.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKES(r.value)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-medium pl-8">Total revenue</TableCell>
                    <TableCell className="text-right font-medium tabular-nums" data-testid="text-report-total-revenue">{formatKES(totalRevenue)}</TableCell>
                  </TableRow>

                  <TableRow className="bg-muted/40">
                    <TableCell className="font-semibold" colSpan={2}>Costs</TableCell>
                  </TableRow>
                  {costRows.map((r) => (
                    <TableRow key={r.label} data-testid={`row-report-cost-${r.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      <TableCell className="pl-8">{r.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKES(r.value)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-medium pl-8">Total costs</TableCell>
                    <TableCell className="text-right font-medium tabular-nums" data-testid="text-report-total-costs">{formatKES(totalCosts)}</TableCell>
                  </TableRow>

                  <TableRow className="border-t-2 border-border">
                    <TableCell className="font-semibold text-base">Net profit</TableCell>
                    <TableCell className={`text-right font-semibold text-base tabular-nums ${netProfit >= 0 ? "text-[hsl(var(--chart-3))]" : "text-destructive"}`} data-testid="text-report-net-profit">
                      {formatKES(netProfit)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground p-4 pt-0">
              Staff payroll is pro-rated across the selected period (~{periodMonths} month{periodMonths === 1 ? "" : "s"}) based on current active monthly salaries. All other figures reflect actual recorded transactions within the date range.
            </p>
          </Card>
        </TabsContent>

        {/* Accommodation */}
        <TabsContent value="accommodation" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <ExportButton sheet="accommodation" fromDate={fromDate} toDate={toDate} label="Export accommodation report" />
          </div>
          <Card>
            <div className="p-4 border-b border-card-border flex items-center justify-between">
              <h2 className="text-lg font-semibold">Accommodation bookings</h2>
              <span className="text-sm text-muted-foreground">{bookingsInRange.length} booking{bookingsInRange.length === 1 ? "" : "s"} · {formatKES(accommodationRevenue)}</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Guest</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead>Check-in</TableHead>
                    <TableHead>Check-out</TableHead>
                    <TableHead className="text-right">Nights</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookingsInRange.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No bookings in this period.</TableCell></TableRow>
                  )}
                  {bookingsInRange.map((b) => {
                    const room = roomById.get(b.roomId);
                    const balance = b.totalAmount - b.amountPaid;
                    return (
                      <TableRow key={b.id} data-testid={`row-report-booking-${b.id}`}>
                        <TableCell>{b.guestName}</TableCell>
                        <TableCell>{room?.name ?? "—"}</TableCell>
                        <TableCell>{formatDate(b.checkIn)}</TableCell>
                        <TableCell>{formatDate(b.checkOut)}</TableCell>
                        <TableCell className="text-right tabular-nums">{nightsBetween(b.checkIn, b.checkOut)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKES(b.totalAmount)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKES(balance)}</TableCell>
                        <TableCell><Badge variant="outline">{titleCase(b.status)}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* Facilities */}
        <TabsContent value="facilities" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <ExportButton sheet="facilities" fromDate={fromDate} toDate={toDate} label="Export facilities report" />
          </div>
          <Card>
            <div className="p-4 border-b border-card-border flex items-center justify-between">
              <h2 className="text-lg font-semibold">Conference hall bookings</h2>
              <span className="text-sm text-muted-foreground">{facilityBookingsInRange.length} booking{facilityBookingsInRange.length === 1 ? "" : "s"} · {formatKES(facilityRevenue)}</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Facility</TableHead>
                    <TableHead>Event date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {facilityBookingsInRange.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No facility bookings in this period.</TableCell></TableRow>
                  )}
                  {facilityBookingsInRange.map((b) => {
                    const facility = facilityById.get(b.facilityId);
                    const balance = b.totalAmount - b.amountPaid;
                    return (
                      <TableRow key={b.id} data-testid={`row-report-facility-booking-${b.id}`}>
                        <TableCell>{b.clientName}</TableCell>
                        <TableCell>{facility?.name ?? "—"}</TableCell>
                        <TableCell>{formatDate(b.eventDate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKES(b.totalAmount)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKES(balance)}</TableCell>
                        <TableCell><Badge variant="outline">{titleCase(b.status)}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>

          <Card>
            <div className="p-4 border-b border-card-border flex items-center justify-between">
              <h2 className="text-lg font-semibold">Movie room seat bookings</h2>
              <span className="text-sm text-muted-foreground">{movieBookingsInRange.length} seat{movieBookingsInRange.length === 1 ? "" : "s"} · {formatKES(movieRevenue)}</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Guest</TableHead>
                    <TableHead>Show</TableHead>
                    <TableHead>Show date</TableHead>
                    <TableHead>Seat</TableHead>
                    <TableHead className="text-right">Ticket price</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movieBookingsInRange.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No movie room bookings in this period.</TableCell></TableRow>
                  )}
                  {movieBookingsInRange.map((b) => {
                    const show = movieShowById.get(b.showId);
                    const balance = b.ticketPrice - b.amountPaid;
                    return (
                      <TableRow key={b.id} data-testid={`row-report-movie-booking-${b.id}`}>
                        <TableCell>{b.guestName}</TableCell>
                        <TableCell>{show?.name ?? "—"}</TableCell>
                        <TableCell>{show ? formatDate(show.showDate) : "—"}</TableCell>
                        <TableCell>{b.seatRow}{b.seatNumber}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKES(b.ticketPrice)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKES(balance)}</TableCell>
                        <TableCell><Badge variant="outline">{titleCase(b.status)}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* Bar & Restaurant */}
        <TabsContent value="bar-restaurant" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <ExportButton sheet="bar-restaurant" fromDate={fromDate} toDate={toDate} label="Export bar & restaurant report" />
          </div>
          <Card>
            <div className="p-4 border-b border-card-border flex items-center justify-between">
              <h2 className="text-lg font-semibold">Bar &amp; restaurant orders</h2>
              <span className="text-sm text-muted-foreground">{ordersInRange.length} order{ordersInRange.length === 1 ? "" : "s"} · {formatKES(barRevenue + restaurantRevenue)} paid</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Outlet</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordersInRange.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No orders in this period.</TableCell></TableRow>
                  )}
                  {ordersInRange.map((o) => (
                    <TableRow key={o.id} data-testid={`row-report-order-${o.id}`}>
                      <TableCell>{titleCase(o.outlet)}</TableCell>
                      <TableCell>{o.customerName || "—"}</TableCell>
                      <TableCell>{formatDate(o.orderDate)}</TableCell>
                      <TableCell>{o.paymentMethod ? titleCase(o.paymentMethod) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKES(o.totalAmount)}</TableCell>
                      <TableCell><Badge variant="outline">{titleCase(o.status)}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground p-4 pt-0">
              The Excel export includes a full item-level breakdown per order and a top-selling-items sheet for menu performance.
            </p>
          </Card>
        </TabsContent>

        {/* Staff & Payroll */}
        <TabsContent value="staff" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <ExportButton sheet="staff" fromDate={fromDate} toDate={toDate} label="Export personnel report" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Active staff" value={String(activeStaff.length)} icon={Users2} accent="primary" testId="stat-active-staff" />
            <StatCard label="Monthly payroll" value={formatKES(monthlyPayroll)} icon={Wallet} accent="warning" testId="stat-monthly-payroll" />
            <StatCard label="Payroll this period" value={formatKES(proratedPayroll)} icon={TrendingDown} accent="warning" testId="stat-prorated-payroll" />
          </div>
          <Card>
            <div className="p-4 border-b border-card-border">
              <h2 className="text-lg font-semibold">Staff roster</h2>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead className="text-right">Monthly salary</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staff.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No staff records yet.</TableCell></TableRow>
                  )}
                  {staff.map((s) => (
                    <TableRow key={s.id} data-testid={`row-report-staff-${s.id}`}>
                      <TableCell>{s.name}</TableCell>
                      <TableCell>{s.role}</TableCell>
                      <TableCell>{titleCase(s.department)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKES(s.salary)}</TableCell>
                      <TableCell><Badge variant={s.status === "active" ? "default" : "outline"}>{titleCase(s.status)}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
          <Card>
            <div className="p-4 border-b border-card-border">
              <h2 className="text-lg font-semibold">Payroll by department</h2>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Department</TableHead>
                    <TableHead className="text-right">Active headcount</TableHead>
                    <TableHead className="text-right">Monthly payroll</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {departmentSummary.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No active staff.</TableCell></TableRow>
                  )}
                  {departmentSummary.map(([dept, agg]) => (
                    <TableRow key={dept} data-testid={`row-report-department-${dept}`}>
                      <TableCell>{titleCase(dept)}</TableCell>
                      <TableCell className="text-right tabular-nums">{agg.count}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKES(agg.payroll)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* Expenses */}
        <TabsContent value="expenses" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <ExportButton sheet="expenses" fromDate={fromDate} toDate={toDate} label="Export expenses report" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Total expenses" value={formatKES(otherExpensesTotal)} icon={TrendingDown} accent="warning" testId="stat-total-expenses" />
            <StatCard label="Maintenance costs" value={formatKES(maintenanceTotal)} icon={Wrench} accent="warning" testId="stat-maintenance-costs" />
            <StatCard label="Records this period" value={String(expensesInRange.length)} icon={FileSpreadsheet} accent="muted" testId="stat-expense-count" />
          </div>
          <Card>
            <div className="p-4 border-b border-card-border">
              <h2 className="text-lg font-semibold">Expense log</h2>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Paid to</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expensesInRange.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No expenses in this period.</TableCell></TableRow>
                  )}
                  {expensesInRange.slice().sort((a, b) => a.date.localeCompare(b.date)).map((e) => (
                    <TableRow key={e.id} data-testid={`row-report-expense-${e.id}`} className={e.category === "maintenance" ? "bg-[hsl(var(--chart-2))]/10" : undefined}>
                      <TableCell>{formatDate(e.date)}</TableCell>
                      <TableCell><Badge variant={e.category === "maintenance" ? "secondary" : "outline"}>{titleCase(e.category)}</Badge></TableCell>
                      <TableCell>{e.description}</TableCell>
                      <TableCell>{e.paidTo || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKES(e.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
          <Card>
            <div className="p-4 border-b border-card-border">
              <h2 className="text-lg font-semibold">Costs by category</h2>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from(expensesByCategory.entries()).sort((a, b) => b[1] - a[1]).map(([cat, amount]) => (
                    <TableRow key={cat} data-testid={`row-report-expense-category-${cat}`}>
                      <TableCell>{titleCase(cat)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKES(amount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{otherExpensesTotal > 0 ? `${((amount / otherExpensesTotal) * 100).toFixed(1)}%` : "0%"}</TableCell>
                    </TableRow>
                  ))}
                  {expensesByCategory.size === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No expenses in this period.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* Maintenance */}
        <TabsContent value="maintenance" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <ExportButton sheet="maintenance" fromDate={fromDate} toDate={toDate} label="Export maintenance report" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StatCard label="Open / in progress" value={String(openMaintenanceCount)} icon={Wrench} accent="warning" testId="stat-report-maintenance-open" />
            <StatCard label="Issues logged this period" value={String(maintenanceInRange.length)} icon={FileSpreadsheet} accent="muted" testId="stat-report-maintenance-count" />
          </div>
          <Card>
            <div className="p-4 border-b border-card-border">
              <h2 className="text-lg font-semibold">Maintenance issue log</h2>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ref</TableHead>
                    <TableHead>Reported</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {maintenanceInRange.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No maintenance issues in this period.</TableCell></TableRow>
                  )}
                  {maintenanceInRange.map((i) => (
                    <TableRow key={i.id} data-testid={`row-report-maintenance-${i.id}`}>
                      <TableCell className="font-mono text-xs">#{i.id}</TableCell>
                      <TableCell>{formatDate(new Date(i.createdAt).toISOString().slice(0, 10))}</TableCell>
                      <TableCell><Badge variant="outline">{MAINTENANCE_CATEGORY_LABELS[i.category as MaintenanceCategory] ?? titleCase(i.category)}</Badge></TableCell>
                      <TableCell>{i.title}</TableCell>
                      <TableCell>{titleCase(i.priority)}</TableCell>
                      <TableCell><Badge variant={i.status === "open" ? "destructive" : i.status === "closed" ? "outline" : "secondary"}>{titleCase(i.status)}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* Budgeting */}
        <TabsContent value="budgeting" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <ExportButton sheet="budgeting" fromDate={fromDate} toDate={toDate} label="Export budgeting report" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Total budgeted (period)" value={formatKES(budgetVariance.reduce((s, r) => s + r.budgetedAmount, 0))} icon={PiggyBank} accent="muted" testId="stat-report-budget-total" />
            <StatCard label="Total actual (period)" value={formatKES(budgetVariance.reduce((s, r) => s + r.actualAmount, 0))} icon={Wallet} accent="success" testId="stat-report-budget-actual" />
            <StatCard
              label="Net variance"
              value={formatKES(budgetVariance.reduce((s, r) => s + r.variance, 0))}
              icon={budgetVariance.reduce((s, r) => s + r.variance, 0) >= 0 ? TrendingUp : TrendingDown}
              accent={budgetVariance.reduce((s, r) => s + r.variance, 0) >= 0 ? "success" : "warning"}
              testId="stat-report-budget-variance"
            />
          </div>
          <Card>
            <div className="p-4 border-b border-card-border">
              <h2 className="text-lg font-semibold">Budget vs actual by income stream ({budgetFromMonth} to {budgetToMonth})</h2>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Income Stream</TableHead>
                    <TableHead className="text-right">Budgeted</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {budgetVariance.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No budget lines entered for this period.</TableCell></TableRow>
                  )}
                  {budgetVariance.map((r) => (
                    <TableRow key={`${r.month}-${r.incomeStreamCode}`} data-testid={`row-report-budget-${r.month}-${r.incomeStreamCode}`}>
                      <TableCell>{r.month}</TableCell>
                      <TableCell>{r.incomeStreamLabel}</TableCell>
                      <TableCell className="text-right">{formatKES(r.budgetedAmount)}</TableCell>
                      <TableCell className="text-right">{formatKES(r.actualAmount)}</TableCell>
                      <TableCell className={`text-right ${r.variance < 0 ? "text-destructive" : "text-success"}`}>{formatKES(r.variance)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* Assets */}
        <TabsContent value="assets" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <ExportButton sheet="assets" fromDate={fromDate} toDate={toDate} label="Export assets report" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Active assets" value={String(assetsList.filter((a) => a.status === "active").length)} icon={Boxes} accent="muted" testId="stat-report-assets-active" />
            <StatCard label="Total acquisition cost" value={formatKES(assetsList.reduce((s, a) => s + a.acquisitionCost, 0))} icon={Wallet} accent="success" testId="stat-report-assets-cost" />
            <StatCard label="Disposed assets" value={String(assetsList.filter((a) => a.status === "disposed").length)} icon={FileSpreadsheet} accent="warning" testId="stat-report-assets-disposed" />
          </div>
          <Card>
            <div className="p-4 border-b border-card-border">
              <h2 className="text-lg font-semibold">Asset register</h2>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset #</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assetsList.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No assets registered yet.</TableCell></TableRow>
                  )}
                  {assetsList.map((a) => (
                    <TableRow key={a.id} data-testid={`row-report-asset-${a.id}`}>
                      <TableCell className="font-mono text-xs">{a.assetNumber}</TableCell>
                      <TableCell>{a.name}</TableCell>
                      <TableCell>{assetCategories.find((c) => c.id === a.categoryId)?.name ?? "—"}</TableCell>
                      <TableCell className="text-right">{formatKES(a.acquisitionCost)}</TableCell>
                      <TableCell><Badge variant={a.status === "active" ? "secondary" : a.status === "disposed" ? "outline" : "destructive"}>{titleCase(a.status)}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
