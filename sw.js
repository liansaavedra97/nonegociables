/**
 * sw.js — Service worker de NO NEGOCIABLES.
 *
 * Estrategia:
 *  - Al instalar, descarga y guarda TODOS los archivos de la app en una caché
 *    con el nombre de la versión (sin pasar por la caché HTTP).
 *  - Sirve los archivos desde esa caché (funciona sin conexión).
 *  - Para publicar una versión nueva se cambia VERSION: el navegador detecta
 *    el cambio, instala la versión nueva en paralelo y la app ofrece
 *    "Actualizar". Al aceptar, se activa y se borran las cachés antiguas.
 *  - La app registra este archivo con updateViaCache:'none', así nunca queda
 *    atrapada en una versión vieja por la caché HTTP.
 *
 * Los datos personales NO están aquí: viven en IndexedDB y no se tocan
 * al actualizar.
 */
const VERSION = 'nn-v1.0.0';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './theme-init.js',
  './app.js',
  './db.js',
  './dates.js',
  './model.js',
  './stats.js',
  './backup.js',
  './ui.js',
  './onboarding.js',
  './manifest.webmanifest',
  './fonts/archivo.woff2',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/badge-96.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // cache:'reload' evita guardar copias viejas de la caché HTTP.
    await cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })));
    // Primera instalación: activar de inmediato. Actualizaciones: esperar a que la persona acepte.
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('nn-') && k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // la app no usa recursos externos

  // Navegaciones: siempre la página de la app desde la caché (offline-first).
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match('./index.html') || await cache.match('./');
      if (cached) return cached;
      try { return await fetch(req); } catch { return new Response('<h1>Sin conexión</h1><p>Abre la app una vez con internet para poder usarla sin conexión.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }); }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      return await fetch(req);
    } catch {
      return new Response('', { status: 504, statusText: 'Sin conexión' });
    }
  })());
});

// Al tocar una notificación, abre o enfoca la app en la pantalla Hoy.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { await c.focus(); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow('./#today');
  })());
});
