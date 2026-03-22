const BASE_PATH = self.location.pathname.replace(/sw\.js$/, "");
const CACHE = `bevpro-v2:${BASE_PATH}`;
const PRECACHE = [BASE_PATH, `${BASE_PATH}index.html`, `${BASE_PATH}manifest.json`];

function shouldBypassCache(request, url) {
  return (
    request.method !== "GET"
    || url.pathname.startsWith("/api")
    || url.pathname.startsWith("/@vite")
    || url.pathname.startsWith("/src/")
    || url.pathname.startsWith("/node_modules/")
    || url.pathname === "/sw.js"
    || url.searchParams.has("t")
  );
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw new Error("Network request failed");
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (shouldBypassCache(e.request, url)) {
    return;
  }

  if (e.request.mode === "navigate") {
    e.respondWith(networkFirst(e.request));
    return;
  }

  e.respondWith(cacheFirst(e.request));
});
