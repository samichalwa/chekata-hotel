import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  BedDouble,
  PartyPopper,
  UtensilsCrossed,
  Users,
  Receipt,
  FileBarChart,
  FileText,
  Settings as SettingsIcon,
  LogOut,
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
import { Logo } from "@/components/logo";
import { useCurrentUser, useLogout, canAccess } from "@/hooks/use-auth";
import type { ModuleKey } from "@shared/schema";

const items: { title: string; url: string; icon: any; key: ModuleKey }[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, key: "dashboard" },
  { title: "Accommodation", url: "/accommodation", icon: BedDouble, key: "accommodation" },
  { title: "Conference & Movie Room", url: "/facilities", icon: PartyPopper, key: "facilities" },
  { title: "Bar & Restaurant", url: "/bar-restaurant", icon: UtensilsCrossed, key: "bar-restaurant" },
  { title: "Staff", url: "/staff", icon: Users, key: "staff" },
  { title: "Expenses", url: "/expenses", icon: Receipt, key: "expenses" },
  { title: "Reports", url: "/reports", icon: FileBarChart, key: "reports" },
  { title: "Invoices & Receipts", url: "/documents", icon: FileText, key: "documents" },
  { title: "Settings", url: "/settings", icon: SettingsIcon, key: "settings" },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { data: user } = useCurrentUser();
  const logout = useLogout();

  const visibleItems = items.filter((item) => canAccess(user, item.key));

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5 text-sidebar-foreground">
          <Logo className="h-6 w-6 text-sidebar-primary shrink-0" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">The Chekata</span>
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
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-xs font-medium text-sidebar-foreground" data-testid="text-current-user">{user.fullName}</span>
              <span className="text-[11px] text-sidebar-foreground/50">{user.isAdmin ? "Administrator" : "Staff"}</span>
            </div>
            <button
              type="button"
              onClick={() => logout.mutate()}
              className="rounded-md p-1.5 text-sidebar-foreground/60 hover-elevate active-elevate-2"
              title="Sign out"
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="px-2 py-1.5 text-xs text-sidebar-foreground/50">
          Currency: KES · All figures in Kenyan Shillings
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
