/* HSE Ders Takip — çevrimdışı çalışma için service worker */
var ONBELLEK = 'ders-takip-v3';
var DOSYALAR = ['./', './index.html', './style.css', './calc.js', './yedek.js', './cicek.js', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(ONBELLEK).then(function (c) { return c.addAll(DOSYALAR); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== ONBELLEK; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return; // Apps Script'e giden POST'lara dokunma
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  // Önce ağdan dene (güncel sürüm), olmazsa önbellekten ver
  e.respondWith(
    fetch(e.request).then(function (r) {
      if (r && r.ok) { var kopya = r.clone(); caches.open(ONBELLEK).then(function (c) { c.put(e.request, kopya); }); }
      return r;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match('./index.html'); });
    })
  );
});
