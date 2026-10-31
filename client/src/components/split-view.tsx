import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Columns2, Maximize2, Minus, Plus, X, Equal } from "lucide-react";
import {
  IN_PANE, MAX_SCREENS, useDesk, openScreen, closeScreen, minimiseScreen, focusScreen, maximiseScreen, tileScreens,
  rememberRoute, resizePair, moveScreen, evenScreens, closeAllScreens, type Screen,
} from "@/lib/desk";
import { pageTitleFor } from "@/components/app-sidebar";

/** The title a screen shows: its page heading, or the page name from the menu. */
function titleOf(doc: Document | null | undefined, hash: string): string {
  const named = pageTitleFor(hash || "#/");
  if (named !== "Screen") return named;
  return doc?.querySelector('[data-testid="text-page-title"]')?.textContent?.trim() || named;
}

function useTitles(frames: React.MutableRefObject<Record<string, HTMLIFrameElement | null>>) {
  const [titles, setTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    const tick = () => {
      const next: Record<string, string> = frames.current.main ? {} : { main: titleOf(document, window.location.hash) };
      for (const [id, f] of Object.entries(frames.current)) {
        try {
          if (!f?.contentWindow) continue;
          // Still loading (about:blank): keep the route it was opened with.
          if (f.contentWindow.location.href === "about:blank" || !f.contentDocument?.querySelector("#root > *")) continue;
          const hash = f.contentWindow.location.hash || "#/";
          next[id] = titleOf(f.contentDocument, hash);
          rememberRoute(id, hash);
        } catch { /* not loaded yet */ }
      }
      setTitles((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [frames]);
  return titles;
}

/** Turn a menu link's href ("/x" or "#/x") into a route for a screen. */
function routeOf(href: string | null): string | null {
  if (!href) return null;
  if (href.startsWith("#/")) return href;
  if (href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/api")) return `#${href}`;
  return null;
}

// Screens currently on the page, so the Home button can act on the one in focus.
const liveFrames: Record<string, HTMLIFrameElement | null> = {};
let liveFocus = "main";
/** Go to a page in the screen in focus (or the window itself when there is one screen). */
export function goInFocusedScreen(route: string): void {
  const f = liveFrames[liveFocus];
  if (f?.contentWindow) f.contentWindow.location.hash = route;
  else window.location.hash = route;
}

const iconBtn = "inline-flex h-6 w-6 items-center justify-center rounded hover-elevate text-current";

/** Several screens in one window: side by side or one at a time, with a taskbar to switch, minimise and close. */
export function SplitView({ children }: { children: ReactNode }) {
  const desk = useDesk();
  const frames = useRef<Record<string, HTMLIFrameElement | null>>(liveFrames);
  // Each screen's address is fixed when it opens; later page changes happen inside the screen.
  const srcs = useRef<Record<string, string>>({});
  const titles = useTitles(frames);
  const row = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  // Phones and small tablets keep one screen; the taskbar needs a wider window.
  const [wide, setWide] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 768px)").matches);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 768px)");
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);

  // Inside a screen: tell the window when this screen is touched, so it comes into focus.
  useEffect(() => {
    if (!IN_PANE) return;
    const id = new URLSearchParams(window.location.search).get("screen");
    if (!id) return;
    const tell = () => { try { window.parent.postMessage({ chekataScreenFocus: id }, window.location.origin); } catch { /* ignore */ } };
    document.addEventListener("pointerdown", tell, true);
    document.addEventListener("keydown", tell, true);
    return () => { document.removeEventListener("pointerdown", tell, true); document.removeEventListener("keydown", tell, true); };
  }, []);

  // Clicking inside a screen makes it the one in focus.
  useEffect(() => {
    if (IN_PANE) return;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const id = (e.data as { chekataScreenFocus?: string } | null)?.chekataScreenFocus;
      if (typeof id === "string" && id in frames.current) focusScreen(id);
    };
    window.addEventListener("message", onMsg);
    const onBlur = () => window.setTimeout(() => {
      const el = document.activeElement;
      for (const [id, f] of Object.entries(frames.current)) if (f && el === f) focusScreen(id);
    }, 0);
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("[data-screen-main]")) focusScreen("main");
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("mousedown", onDown, true);
    return () => { window.removeEventListener("message", onMsg); window.removeEventListener("blur", onBlur); document.removeEventListener("mousedown", onDown, true); };
  }, []);

  // One menu for every screen: a page picked in the left-hand menu opens in the screen in focus.
  // Ctrl/Shift/middle-click on a menu item opens it in a new screen instead.
  useEffect(() => {
    if (IN_PANE || !wide) return;
    const handle = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || !a.closest('[data-sidebar="sidebar"]')) return;
      const route = routeOf(a.getAttribute("href"));
      if (!route) return;
      const newScreen = e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1;
      if (newScreen) {
        e.preventDefault(); e.stopPropagation();
        openScreen(route);
        return;
      }
      if (e.type !== "click") return;
      const f = frames.current[desk.focus];
      const target = desk.screens.find((x) => x.id === desk.focus);
      if (!f?.contentWindow || !target || target.min) return;
      e.preventDefault(); e.stopPropagation();
      f.contentWindow.location.hash = route;
    };
    document.addEventListener("click", handle, true);
    document.addEventListener("auxclick", handle, true);
    return () => { document.removeEventListener("click", handle, true); document.removeEventListener("auxclick", handle, true); };
  }, [desk, wide]);

  if (IN_PANE || !wide) return <main className="flex-1 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>{children}</main>;

  const many = desk.screens.length > 1;
  liveFocus = desk.focus;
  if (!many) delete srcs.current.main;
  const tiled = desk.layout === "tile";
  const shown = (s: Screen) => !s.min && (tiled || s.id === desk.focus);
  const visible = desk.screens.filter(shown);
  const title = (id: string) => titles[id] ?? "Screen";

  // Drag the divider between two screens: the pair shares its width in a new proportion.
  const startDrag = (e: React.PointerEvent, a: Screen, b: Screen) => {
    e.preventDefault();
    const ea = row.current?.querySelector<HTMLElement>(`[data-testid="screen-${a.id}"]`);
    const eb = row.current?.querySelector<HTMLElement>(`[data-testid="screen-${b.id}"]`);
    if (!ea || !eb) return;
    const left = ea.getBoundingClientRect().left;
    const total = ea.offsetWidth + eb.offsetWidth;
    const weight = (a.size ?? 1) + (b.size ?? 1);
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const w = Math.min(total - 280, Math.max(280, ev.clientX - left));
      resizePair(a.id, b.id, (w / total) * weight, ((total - w) / total) * weight);
    };
    const up = () => { setDragging(false); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const keyResize = (e: React.KeyboardEvent, a: Screen, b: Screen) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const weight = (a.size ?? 1) + (b.size ?? 1);
    const step = (e.key === "ArrowLeft" ? -0.05 : 0.05) * weight;
    const na = Math.min(weight * 0.85, Math.max(weight * 0.15, (a.size ?? 1) + step));
    resizePair(a.id, b.id, na, weight - na);
  };

  const bar = (s: Screen) => {
    const focused = s.id === desk.focus;
    return (
      <div
        className={`flex h-9 shrink-0 items-center gap-1 border-b px-2 text-xs ${focused ? "border-[hsl(var(--gold))] bg-sidebar text-sidebar-foreground" : "border-border bg-muted text-muted-foreground"}`}
        onMouseDown={() => !focused && focusScreen(s.id)}
        onDoubleClick={() => (tiled ? maximiseScreen(s.id) : tileScreens())}
        data-testid={`screenbar-${s.id}`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${focused ? "bg-[hsl(var(--gold))]" : "bg-muted-foreground/40"}`} aria-hidden="true" />
        <span className={`min-w-0 flex-1 truncate font-semibold tracking-wide ${focused ? "text-[hsl(var(--gold))]" : ""}`}>{title(s.id)}</span>
        {tiled && <button type="button" onClick={() => moveScreen(s.id, -1)} className={iconBtn} aria-label="Move left" title="Move left" data-testid={`button-move-left-${s.id}`}><ChevronLeft className="h-3.5 w-3.5" /></button>}
        {tiled && <button type="button" onClick={() => moveScreen(s.id, 1)} className={iconBtn} aria-label="Move right" title="Move right" data-testid={`button-move-right-${s.id}`}><ChevronRight className="h-3.5 w-3.5" /></button>}
        <button type="button" onClick={() => minimiseScreen(s.id)} className={iconBtn} aria-label="Minimise" title="Minimise" data-testid={`button-minimise-${s.id}`}><Minus className="h-3.5 w-3.5" /></button>
        {tiled
          ? <button type="button" onClick={() => maximiseScreen(s.id)} className={iconBtn} aria-label="Expand" title="Expand to full width" data-testid={`button-maximise-${s.id}`}><Maximize2 className="h-3.5 w-3.5" /></button>
          : <button type="button" onClick={tileScreens} className={iconBtn} aria-label="Show side by side" title="Show side by side" data-testid={`button-tile-${s.id}`}><Columns2 className="h-3.5 w-3.5" /></button>}
        {s.id !== "main" && <button type="button" onClick={() => closeScreen(s.id)} className={`${iconBtn} hover:text-destructive`} aria-label="Close screen" title="Close screen" data-testid={`button-close-${s.id}`}><X className="h-3.5 w-3.5" /></button>}
      </div>
    );
  };

  return (
    <>
      <div ref={row} className="flex min-h-0 min-w-0 flex-1 gap-0 overflow-x-auto">
        {desk.screens.map((s) => {
          const vi = visible.findIndex((v) => v.id === s.id);
          const nextVisible = tiled && vi >= 0 && vi < visible.length - 1 ? visible[vi + 1] : null;
          const focused = many && s.id === desk.focus;
          return [
            <section key={s.id} aria-label={title(s.id)}
              style={tiled ? { flexGrow: s.size ?? 1, flexBasis: 0 } : undefined}
              className={`${shown(s) ? "flex" : "hidden"} min-w-[280px] flex-1 flex-col overflow-hidden ${many && tiled ? `border-t-2 ${focused ? "border-t-[hsl(var(--gold))]" : "border-t-transparent"}` : ""}`}
              data-testid={`screen-${s.id}`}>
              {many && bar(s)}
              {s.id === "main" && !many
                ? <main className="min-h-0 flex-1 overflow-y-auto" style={{ overscrollBehavior: "contain" }} data-screen-main="" data-testid="main-content">{children}</main>
                : <iframe title={title(s.id)} ref={(el) => { frames.current[s.id] = el; if (!el) delete frames.current[s.id]; }}
                    src={(srcs.current[s.id] ??= `${window.location.pathname}?screen=${s.id}${s.route || window.location.hash || "#/"}`)}
                    className={`min-h-0 w-full flex-1 border-0 bg-background ${dragging ? "pointer-events-none" : ""}`}
                    data-testid={`frame-${s.id}`} />}
            </section>,
            nextVisible && (
              <div key={`${s.id}-div`} role="separator" aria-orientation="vertical" tabIndex={0}
                aria-label="Drag to resize the screens on either side"
                title="Drag to resize"
                onPointerDown={(e) => startDrag(e, s, nextVisible)} onKeyDown={(e) => keyResize(e, s, nextVisible)}
                onDoubleClick={evenScreens}
                className="group relative w-1.5 shrink-0 cursor-col-resize bg-sidebar hover:bg-[hsl(var(--gold))] focus-visible:bg-[hsl(var(--gold))] focus-visible:outline-none"
                data-testid={`divider-${s.id}`}>
                <span className="absolute left-1/2 top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-[hsl(var(--gold))] group-hover:bg-sidebar" aria-hidden="true" />
              </div>
            ),
          ];
        })}
      </div>
      <nav aria-label="Open screens" className="hidden h-10 shrink-0 items-center gap-1 overflow-x-auto border-t border-sidebar-border bg-sidebar px-2 text-sidebar-foreground md:flex" data-testid="taskbar">
        {desk.screens.map((s) => {
          const active = s.id === desk.focus && !s.min;
          return (
            <button key={s.id} type="button"
              onClick={() => (active && many ? minimiseScreen(s.id) : focusScreen(s.id))}
              className={`flex h-7 max-w-[220px] shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors ${active ? "border-[hsl(var(--gold))] bg-[hsl(var(--gold))] font-semibold text-sidebar" : s.min ? "border-transparent text-sidebar-foreground/60 hover:bg-sidebar-accent" : "border-sidebar-border bg-sidebar-accent text-sidebar-foreground hover:border-[hsl(var(--gold))]"}`}
              aria-pressed={active} title={s.min ? "Restore" : active && many ? "Minimise" : "Show"} data-testid={`task-${s.id}`}>
              <span className="truncate">{title(s.id)}</span>
              {s.min && <span className="text-[10px] uppercase tracking-wide opacity-70">min</span>}
            </button>
          );
        })}
        <button type="button" onClick={() => openScreen()} disabled={desk.screens.length >= MAX_SCREENS}
          className="ml-1 flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-[hsl(var(--gold))] hover:bg-sidebar-accent disabled:opacity-40"
          title={desk.screens.length >= MAX_SCREENS ? `Up to ${MAX_SCREENS} screens` : "Open another screen beside this one (or Ctrl+click a menu item)"} data-testid="button-new-screen">
          <Plus className="h-3.5 w-3.5" /> New screen
        </button>
        {many && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button type="button" onClick={tileScreens} className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground" data-testid="button-tile">
              <Columns2 className="h-3.5 w-3.5" /> Side by side
            </button>
            {tiled && (
              <button type="button" onClick={evenScreens} className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground" data-testid="button-even">
                <Equal className="h-3.5 w-3.5" /> Equal widths
              </button>
            )}
            <button type="button" onClick={closeAllScreens} className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground" data-testid="button-close-all">
              <X className="h-3.5 w-3.5" /> Close others
            </button>
          </div>
        )}
      </nav>
    </>
  );
}
