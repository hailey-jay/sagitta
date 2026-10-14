/// Lets Sagitta, served as a web page, open without a network, as an installed app should: every
/// file the page fetches from its own site is kept as it arrives, and served from there when the
/// network fails. The network comes first, so a new version is taken up as soon as it is
/// published, and nothing needs listing here as the page grows. KaTeX's fonts are fetched only as
/// labels use them, so offline, a style no label has used yet falls back to the system's fonts.
///
/// It is registered by `web/host.js`, and lives beside `index.html` so that its scope covers the
/// page.

const CACHE = "sagitta";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
        return;
    }
    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        try {
            const response = await fetch(request);
            if (response.ok) {
                await cache.put(request, response.clone());
            }
            return response;
        } catch (error) {
            const kept = await cache.match(request, { ignoreSearch: true });
            if (kept === undefined) {
                throw error;
            }
            return kept;
        }
    })());
});
