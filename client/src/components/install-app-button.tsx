import { useEffect, useState } from "react";
import { Download, Share, SquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

function isIos() {
  const ua = window.navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

/** Shows an "Install app" button when the site can be added to the home screen. */
export function InstallAppButton({ className }: { className?: string }) {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [showOtherHelp, setShowOtherHelp] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;
  const ios = isIos();
  const mobile = ios || /android/i.test(window.navigator.userAgent);
  // On desktop, only offer the button when the browser supports a direct install.
  if (!promptEvent && !mobile) return null;

  const onClick = async () => {
    if (promptEvent) {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") setInstalled(true);
      setPromptEvent(null);
    } else if (ios) {
      setShowIosHelp(true);
    } else {
      setShowOtherHelp(true);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" className={`w-full gap-2 ${className ?? ""}`} onClick={onClick} data-testid="button-install-app">
        <Download className="h-4 w-4" />
        Install app on this device
      </Button>

      <Dialog open={showIosHelp} onOpenChange={setShowIosHelp}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Install on iPhone or iPad</DialogTitle>
            <DialogDescription>Add Chekata to your home screen in Safari.</DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 text-sm" data-testid="list-install-ios-steps">
            <li className="flex gap-2"><span className="font-semibold">1.</span><span>Make sure this page is open in <b>Safari</b>.</span></li>
            <li className="flex gap-2"><span className="font-semibold">2.</span><span className="flex flex-wrap items-center gap-1">Tap the <b>Share</b> button <Share className="inline h-4 w-4" /> in the toolbar.</span></li>
            <li className="flex gap-2"><span className="font-semibold">3.</span><span className="flex flex-wrap items-center gap-1">Scroll down and tap <b>Add to Home Screen</b> <SquarePlus className="inline h-4 w-4" />.</span></li>
            <li className="flex gap-2"><span className="font-semibold">4.</span><span>Tap <b>Add</b>. Open Chekata from your home screen.</span></li>
          </ol>
        </DialogContent>
      </Dialog>

      <Dialog open={showOtherHelp} onOpenChange={setShowOtherHelp}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Install on Android</DialogTitle>
            <DialogDescription>Add Chekata to your home screen in Chrome.</DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 text-sm" data-testid="list-install-android-steps">
            <li className="flex gap-2"><span className="font-semibold">1.</span><span>Open this page in <b>Chrome</b>.</span></li>
            <li className="flex gap-2"><span className="font-semibold">2.</span><span>Tap the <b>⋮</b> menu at the top right.</span></li>
            <li className="flex gap-2"><span className="font-semibold">3.</span><span>Tap <b>Install app</b> or <b>Add to Home screen</b>, then <b>Install</b>.</span></li>
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
