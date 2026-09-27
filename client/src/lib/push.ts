// Web Push helpers — lets CHAIMS alerts reach the phone/computer even when the
// app is closed. iPhone/iPad: works only after "Add to Home Screen" (iOS 16.4+).
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on" | "loading";

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}
function supported(): boolean {
  return window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return navigator.serviceWorker.register("/sw.js");
}

export function usePush() {
  const [state, setState] = useState<PushState>("loading");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supported()) { setState(isIos() && !isStandalone() ? "needs-install" : "unsupported"); return; }
    if (Notification.permission === "denied") { setState("denied"); return; }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub && Notification.permission === "granted" ? "on" : "off");
    } catch { setState("off"); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const enable = useCallback(async () => {
    setError(null);
    setState("loading");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "denied" : "off"); return; }
      const { publicKey } = await (await apiRequest("GET", "/api/push/public-key")).json();
      const reg = await registration();
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource });
      await apiRequest("POST", "/api/push/subscribe", sub.toJSON());
      await apiRequest("POST", "/api/push/test");
      setState("on");
    } catch (e: any) {
      setError(e?.message ?? "Could not turn on alerts");
      await refresh();
    }
  }, [refresh]);

  const disable = useCallback(async () => {
    setError(null);
    setState("loading");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await apiRequest("POST", "/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
      }
    } finally {
      await refresh();
    }
  }, [refresh]);

  return { state, error, enable, disable };
}
