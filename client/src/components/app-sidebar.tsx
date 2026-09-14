import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  BedDouble,
  PartyPopper,
  Clapperboard,
  UtensilsCrossed,
  Users,
  Receipt,
  FileBarChart,
  FileText,
  Settings as SettingsIcon,
  LogOut,
  Wrench,
  ClipboardList,
  Wallet,
  ShieldCheck,
  Package,
  ShoppingCart,
  ClipboardCheck,
  Building2,
  ChefHat,
  CalendarClock,
  CalendarDays,
  Landmark,
  PiggyBank,
  Boxes,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { useQuery } from "@tanstack/react-query";
import chekataLogo from "@/assets/chekata-logo.jpg";
import { useCurrentUser, useLogout, canAccess } from "@/hooks/use-auth";
import type { ModuleKey, Settings } from "@shared/schema";

const items: { title: string; url: string; icon: any; key: ModuleKey }[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, key: "dashboard" },
  { title: "Accommodation", url: "/accommodation", icon: BedDouble, key: "accommodation" },
  { title: "Conference & Movie Room", url: "/facilities", icon: PartyPopper, key: "facilities" },
  { title: "Movie Room (Seats)", url: "/movie-room", icon: Clapperboard, key: "movie-room" },
  { title: "Bar & Restaurant", url: "/bar-restaurant", icon: UtensilsCrossed, key: "bar-restaurant" },
  { title: "F&B Costing", url: "/fnb-costing", icon: ChefHat, key: "fnb-costing" },
  { title: "Tenants", url: "/tenants", icon: Building2, key: "tenants" },
  { title: "Staff", url: "/staff", icon: Users, key: "staff" },
  { title: "Attendance", url: "/attendance", icon: CalendarClock, key: "attendance" },
  { title: "Leave", url: "/leave", icon: CalendarDays, key: "leave" },
  { title: "Payroll", url: "/payroll", icon: Landmark, key: "payroll" },
  { title: "Expenses", url: "/expenses", icon: Receipt, key: "expenses" },
  { title: "Maintenance", url: "/maintenance", icon: Wrench, key: "maintenance" },
  { title: "Lists", url: "/lists", icon: ClipboardList, key: "lists" },
  { title: "Reports", url: "/reports", icon: FileBarChart, key: "reports" },
  { title: "Invoices & Receipts", url: "/documents", icon: FileText, key: "documents" },
  { title: "Finance", url: "/finance", icon: Wallet, key: "finance" },
  { title: "Budgeting", url: "/budgeting", icon: PiggyBank, key: "budgeting" },
  { title: "Assets", url: "/assets", icon: Boxes, key: "assets" },
  { title: "Inventory", url: "/inventory", icon: Package, key: "inventory" },
  { title: "Purchasing", url: "/purchasing", icon: ShoppingCart, key: "purchasing" },
  { title: "Internal Requisitions", url: "/internal-requisitions", icon: ClipboardCheck, key: "internal-requisitions" },
  { title: "System Administration", url: "/system-admin", icon: ShieldCheck, key: "system-admin" },
  { title: "Settings", url: "/settings", icon: SettingsIcon, key: "settings" },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { data: user } = useCurrentUser();
  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const logout = useLogout();

  const visibleItems = items.filter((item) => canAccess(user, item.key));
  const hotelName = settings?.hotelName || "The Chekata";
  const copyrightYear = new Date().getFullYear();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5 text-sidebar-foreground">
          <img
            src={chekataLogo}
            alt={`${hotelName} logo`}
            className="h-8 w-8 shrink-0 rounded-md object-cover"
            data-testid="img-sidebar-logo"
          />
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold" data-testid="text-sidebar-hotel-name">{hotelName}</span>
            <span className="text-xs text-sidebar-foreground/60">Highway Hotel</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {user && (
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1">
            <div className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-xs font-medium text-sidebar-foreground" data-testid="text-current-user">{user.fullName}</span>
              <span className="text-[11px] text-sidebar-foreground/50">{user.isAdmin ? "Administrator" : "Staff"}</span>
            </div>
            <button
              type="button"
              onClick={() => logout.mutate()}
              className="shrink-0 rounded-md p-1.5 text-sidebar-foreground/60 hover-elevate active-elevate-2"
              title="Sign out"
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="px-2 py-1.5 text-xs text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
          Currency: KES · All figures in Kenyan Shillings
        </div>
        <div className="px-2 pb-1.5 text-[11px] text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden" data-testid="text-copyright">
          © {copyrightYear} CHAIMS (Chalwa Integrated Hotel Management System).
        </div>
        <div className="px-2 pb-2 text-[11px] text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden" data-testid="text-developer-credit">
          Developed by SAMIC
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
