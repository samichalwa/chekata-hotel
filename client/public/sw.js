// Minimal service worker: makes the site installable as an app.
// It deliberately caches nothing, so users always get the latest version.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
