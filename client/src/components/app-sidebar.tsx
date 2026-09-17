import { Link, useLocation } from "wouter";
import { useState } from "react";
import {
  LayoutDashboard,
  Plus,
  Minus,
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
  Droplets,
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useQuery } from "@tanstack/react-query";
import chekataLogo from "@/assets/chekata-logo.jpg";
import { useCurrentUser, useLogout, canAccess } from "@/hooks/use-auth";
import type { ModuleKey, Settings } from "@shared/schema";
import { MODULE_CATEGORY_GROUPS } from "@shared/schema";

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
  { title: "Water Sales", url: "/water-sales", icon: Droplets, key: "water-sales" },
  { title: "Inventory", url: "/inventory", icon: Package, key: "inventory" },
  { title: "Purchasing", url: "/purchasing", icon: ShoppingCart, key: "purchasing" },
  { title: "Internal Requisitions", url: "/internal-requisitions", icon: ClipboardCheck, key: "internal-requisitions" },
  { title: "System Administration", url: "/system-admin", icon: ShieldCheck, key: "system-admin" },
  { title: "Settings", url: "/settings", icon: SettingsIcon, key: "settings" },
];

// "Settings" is intentionally not part of any MODULE_CATEGORY_GROUPS category
// (it's never permission-assignable), so it always renders in its own
// trailing, unlabeled group at the bottom of the menu.
const itemsByKey = new Map(items.map((item) => [item.key, item]));

export function AppSidebar() {
  const [location] = useLocation();
  const { data: user } = useCurrentUser();
  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const logout = useLogout();

  const visibleItems = items.filter((item) => canAccess(user, item.key));
  const visibleKeys = new Set(visibleItems.map((item) => item.key));
  // Same 6-category grouping as Settings > Users, applied to the actual
  // navigation menu. A category header is only shown if at least one of its
  // items is visible to this user; "Settings" always renders in its own
  // trailing group since it sits outside every category.
  const groupedMenu = MODULE_CATEGORY_GROUPS
    .map((group) => ({ label: group.label, items: group.keys.filter((k) => visibleKeys.has(k)).map((k) => itemsByKey.get(k)!) }))
    .filter((group) => group.items.length > 0);
  const settingsItem = visibleItems.find((item) => item.key === "settings");
  const hotelName = settings?.hotelName || "The Chekata";
  const copyrightYear = new Date().getFullYear();

  // Each nav group is independently collapsible, collapsed by default so only
  // the group heading shows. A group that contains the page currently being
  // viewed starts expanded, so a refresh/deep link never hides the active item.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const group of groupedMenu) {
      initial[group.label] = group.items.some((item) => item.url === location);
    }
    return initial;
  });
  const toggleGroup = (label: string) => setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));

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
        {groupedMenu.map((group) => {
          const isOpen = openGroups[group.label] ?? false;
          return (
            <SidebarGroup key={group.label}>
              <Collapsible open={isOpen} onOpenChange={() => toggleGroup(group.label)}>
                <CollapsibleTrigger asChild>
                  <SidebarGroupLabel
                    className="flex w-full cursor-pointer items-center justify-between hover-elevate active-elevate-2 rounded-md"
                    data-testid={`button-group-toggle-${group.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <span>{group.label}</span>
                    {isOpen ? <Minus className="h-3.5 w-3.5 shrink-0" /> : <Plus className="h-3.5 w-3.5 shrink-0" />}
                  </SidebarGroupLabel>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item) => (
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
                </CollapsibleContent>
              </Collapsible>
            </SidebarGroup>
          );
        })}
        {settingsItem && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem key={settingsItem.title}>
                  <SidebarMenuButton asChild isActive={location === settingsItem.url} data-testid={`link-${settingsItem.title.toLowerCase().replace(/\s+/g, "-")}`}>
                    <Link href={settingsItem.url}>
                      <settingsItem.icon />
                      <span>{settingsItem.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
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
