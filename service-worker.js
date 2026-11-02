/// Lets Sagitta, served as a web page, open without a network, as an installed app should: every
/// file the page fetches from its own site is kept as it arrives, so nothing needs listing here as
/// the page grows. A file kept is served at once, without waiting on the network, and fetched
/// afresh behind it for the next visit, so a version published after the last visit is taken up
/// on the visit after the one that finds it. KaTeX's fonts are fetched only as labels use them, so
/// offline, a style no label has used yet falls back to the system's fonts.
///
/// The page asks for all its scripts and styles as it opens, so one visit refreshes them together,
/// and the next opens one version of the page, not a mixture.
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
    // The network's copy, handed on as it streams in and kept behind it. `no-cache` asks the
    // server whether the browser's own copy is current, which costs little when it is, rather
    // than trusting it.
    let stored = Promise.resolve();
    const fresh = fetch(request, { cache: "no-cache" }).then((response) => {
        if (response.ok) {
            const copy = response.clone();
            stored = caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
    });
    // Keep the worker alive until the copy is kept, whether or not the page waits for it. A
    // failure here is only the network's: the page has what was kept, or hears of it below.
    event.waitUntil(fresh.then(() => stored).catch(() => {}));
    event.respondWith((async () => {
        const kept = await (await caches.open(CACHE)).match(request, { ignoreSearch: true });
        return kept ?? fresh;
    })());
});
