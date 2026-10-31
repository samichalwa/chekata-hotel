import { useSyncExternalStore } from "react";

/**
 * Several screens in one window, with a taskbar along the bottom (as in SHPMS).
 * Screen "main" is the app itself; every other screen is the app again in a
 * same-origin frame, so it shares the sign-in and keeps its place while minimised.
 * The layout is kept in this browser only.
 */
export const IN_PANE = typeof window !== "undefined" && window.self !== window.top;
export const MAX_SCREENS = 6;
export interface Screen { id: string; route: string; min: boolean; size?: number }
export interface Desk { screens: Screen[]; focus: string; layout: "max" | "tile" }

const KEY = "chekata.desk";
const MAIN: Screen = { id: "main", route: "", min: false };
const subs = new Set<() => void>();
let cache: Desk | null = null;

function load(): Desk {
  if (cache) return cache;
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "null");
    if (d && Array.isArray(d.screens) && d.screens.some((x: Screen) => x.id === "main")) { cache = d; return d; }
  } catch { /* fresh start */ }
  cache = { screens: [MAIN], focus: "main", layout: "max" };
  return cache;
}

function save(d: Desk) {
  // If every screen is minimised, the one in focus comes back: the window is never blank.
  if (d.screens.every((x) => x.min)) d = { ...d, screens: d.screens.map((x) => (x.id === d.focus ? { ...x, min: false } : x)) };
  // With one screen left there is nothing to tile.
  if (d.screens.length === 1) {
    // Back to one screen: the window shows the page the first screen was on.
    const r = d.screens[0].route;
    if (r && typeof window !== "undefined" && window.location.hash !== r) window.location.hash = r;
    d = { ...d, layout: "max", focus: "main", screens: [{ ...d.screens[0], route: "", min: false, size: undefined }] };
  }
  cache = d;
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private mode */ }
  subs.forEach((f) => f());
}

export function useDesk(): Desk {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, load, load);
}

export function openScreen(route?: string): void {
  const d = load();
  if (d.screens.length >= MAX_SCREENS) return;
  const id = `s${Date.now().toString(36)}`;
  // A new screen opens beside the others, so both are on view at once.
  const here = window.location.hash || "#/";
  // The first screen keeps the page it was showing.
  const screens = d.screens.map((x) => ({ ...x, min: false, route: x.id === "main" && d.screens.length === 1 ? here : x.route }));
  save({ ...d, screens: [...screens, { id, route: route ?? (d.focus === "main" || d.screens.length === 1 ? here : (d.screens.find((x) => x.id === d.focus)?.route || here)), min: false }], focus: id, layout: "tile" });
}

export function closeScreen(id: string): void {
  if (id === "main") return;
  const d = load();
  const screens = d.screens.filter((x) => x.id !== id);
  save({ ...d, screens, focus: d.focus === id ? (screens.find((x) => !x.min)?.id ?? "main") : d.focus });
}

export function minimiseScreen(id: string): void {
  const d = load();
  const screens = d.screens.map((x) => (x.id === id ? { ...x, min: true } : x));
  save({ ...d, screens, focus: d.focus === id ? (screens.find((x) => !x.min)?.id ?? id) : d.focus });
}

export function focusScreen(id: string): void {
  const d = load();
  if (d.focus === id && !d.screens.find((x) => x.id === id)?.min) return;
  save({ ...d, screens: d.screens.map((x) => (x.id === id ? { ...x, min: false } : x)), focus: id });
}

export function maximiseScreen(id: string): void {
  const d = load();
  save({ ...d, screens: d.screens.map((x) => (x.id === id ? { ...x, min: false } : x)), focus: id, layout: "max" });
}

export function tileScreens(): void {
  const d = load();
  save({ ...d, screens: d.screens.map((x) => ({ ...x, min: false })), layout: "tile" });
}

export function rememberRoute(id: string, route: string): void {
  const d = load();
  const s = d.screens.find((x) => x.id === id);
  if (!s || s.route === route) return;
  cache = { ...d, screens: d.screens.map((x) => (x.id === id ? { ...x, route } : x)) };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* private mode */ }
  subs.forEach((f) => f());
}

/** The page open in the screen in focus (for highlighting the menu). */
export function useFocusedRoute(mainLocation: string): string {
  const d = useDesk();
  if (IN_PANE || d.screens.length < 2) return mainLocation;
  const r = d.screens.find((x) => x.id === d.focus)?.route;
  return r ? "/" + r.replace(/^#?\/?/, "").split("?")[0] : mainLocation;
}

/** Share of the width each screen takes when side by side; set by dragging the divider. */
export function resizePair(a: string, b: string, sizeA: number, sizeB: number): void {
  const d = load();
  save({ ...d, screens: d.screens.map((x) => (x.id === a ? { ...x, size: sizeA } : x.id === b ? { ...x, size: sizeB } : x)) });
}

/** Give every screen an equal share again. */
export function evenScreens(): void {
  const d = load();
  save({ ...d, screens: d.screens.map((x) => ({ ...x, size: undefined, min: false })), layout: "tile" });
}

/** Move a screen one place left (-1) or right (+1). */
export function moveScreen(id: string, dir: -1 | 1): void {
  const d = load();
  const i = d.screens.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= d.screens.length) return;
  const screens = [...d.screens];
  [screens[i], screens[j]] = [screens[j], screens[i]];
  save({ ...d, screens });
}

/** Close every extra screen and go back to one. */
export function closeAllScreens(): void {
  const d = load();
  const keep = d.screens.find((x) => x.id === d.focus) ?? d.screens[0];
  save({ screens: [{ ...MAIN, route: keep.route }], focus: "main", layout: "max" });
}
