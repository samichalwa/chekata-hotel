import { useEffect, useState } from "react";
import { Bell, CheckCheck, AlertOctagon, AlertTriangle, Info, CheckSquare, BedDouble, Wrench, CalendarDays, FileCheck2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  useNotifications, useMarkNotificationsRead, useClearReadNotifications, useDirectorSummary, relativeTime,
  type NotificationItem, type DirectorAlert,
} from "@/lib/director";

const CATEGORY_ICON: Record<string, typeof Info> = {
  approval: CheckSquare, decision: FileCheck2, booking: BedDouble, maintenance: Wrench, leave: CalendarDays,
};
const SEVERITY_ICON: Record<DirectorAlert["severity"], { icon: typeof Info; cls: string }> = {
  critical: { icon: AlertOctagon, cls: "text-destructive" },
  warning: { icon: AlertTriangle, cls: "text-amber-600 dark:text-amber-400" },
  info: { icon: Info, cls: "text-primary" },
};

function go(path: string | null | undefined) {
  if (path) window.location.hash = path.startsWith("/") ? path : `/${path}`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data } = useNotifications();
  const { data: summary } = useDirectorSummary();
  const markRead = useMarkNotificationsRead();
  const clearRead = useClearReadNotifications();

  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];
  const alerts = summary?.alerts ?? [];
  const urgentAlerts = alerts.filter((a) => a.severity !== "info").length;
  const badge = unread + urgentAlerts;

  // Home-screen icon badge for the installed app (supported on Android/desktop Chrome and iOS 16.4+ PWAs).
  useEffect(() => {
    const nav = navigator as any;
    try {
      if (badge > 0) nav.setAppBadge?.(badge)?.catch?.(() => {});
      else nav.clearAppBadge?.()?.catch?.(() => {});
    } catch { /* unsupported */ }
  }, [badge]);

  const openItem = (n: NotificationItem) => {
    if (!n.readAt) markRead.mutate([n.id]);
    setOpen(false);
    go(n.linkPath);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={badge > 0 ? `Notifications, ${badge} new` : "Notifications"} data-testid="button-notifications">
          <Bell className="h-4 w-4" />
          {badge > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] font-semibold leading-4 text-destructive-foreground tabular-nums" data-testid="badge-notifications">
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(22rem,calc(100vw-1.5rem))] p-0" data-testid="popover-notifications">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          <div className="flex items-center gap-1">
            {unread > 0 && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => markRead.mutate(undefined)} disabled={markRead.isPending} data-testid="button-mark-all-read">
                <CheckCheck className="h-3.5 w-3.5 mr-1" />Mark all read
              </Button>
            )}
            {items.some((i) => i.readAt) && (
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Clear read" aria-label="Clear read notifications" onClick={() => clearRead.mutate()} disabled={clearRead.isPending} data-testid="button-clear-read">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        <div className="max-h-[70vh] overflow-y-auto overscroll-contain">
          <div>
            {alerts.length > 0 && (
              <div className="border-b border-border py-1">
                <p className="px-3 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Live alerts</p>
                {alerts.map((a) => {
                  const sev = SEVERITY_ICON[a.severity];
                  return (
                    <button key={a.id} type="button" onClick={() => { setOpen(false); go(a.link); }} className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover-elevate" data-testid={`bell-alert-${a.id}`}>
                      <sev.icon className={`mt-0.5 h-4 w-4 shrink-0 ${sev.cls}`} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium leading-snug">{a.title}</span>
                        {a.detail && <span className="block text-xs text-muted-foreground truncate">{a.detail}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="py-1">
              <p className="px-3 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Activity</p>
              {items.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground" data-testid="text-no-notifications">No notifications yet. New bookings, approval requests and decisions will appear here.</p>
              ) : items.map((n) => {
                const Icon = CATEGORY_ICON[n.category] ?? Info;
                return (
                  <button key={n.id} type="button" onClick={() => openItem(n)} className={`flex w-full items-start gap-2.5 px-3 py-2 text-left hover-elevate ${n.readAt ? "" : "bg-primary/5"}`} data-testid={`notification-${n.id}`}>
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm leading-snug ${n.readAt ? "" : "font-semibold"}`}>{n.title}</span>
                      {n.body && <span className="block text-xs text-muted-foreground line-clamp-2">{n.body}</span>}
                      <span className="block text-[11px] text-muted-foreground mt-0.5">{relativeTime(n.createdAt)}</span>
                    </span>
                    {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
