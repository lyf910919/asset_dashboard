const ASSET_VERSION = "20260730-pension-calc";
const CACHE_NAME = `qdii-dashboard-v2-${ASSET_VERSION}`;
const ASSET_LIST = [
  "./",
  "./index.html",
  `./styles.css?v=${ASSET_VERSION}`,
  `./app.js?v=${ASSET_VERSION}`,
  "./icon.svg",
  `./manifest.webmanifest?v=${ASSET_VERSION}`,
  "./trend/index.html",
  "./pension/index.html",
  "./trend/manifest.json",
  "./trend/data/generated/index-volume-931643.json",
  "./trend/data/generated/index-volume-931643.js",
];
function isNetworkFirstPath(pathname) {
  return (
    pathname.endsWith("/") ||
    pathname.endsWith("/index.html") ||
    pathname.endsWith("/styles.css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith("/manifest.webmanifest")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSET_LIST))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (isNetworkFirstPath(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          if (url.pathname.endsWith("/trend/")) {
            return caches.match("./trend/index.html");
          }
          if (url.pathname.endsWith("/")) {
            return caches.match("./index.html");
          }
          throw new Error("Network request failed");
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    }),
  );
});
