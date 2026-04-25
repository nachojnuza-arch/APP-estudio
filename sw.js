const CACHE_NAME = 'apuntes-facultad-cache-v1';
const FILES_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './scripts.js',
  './manifest.json',
  './pdfjs-5.5.207-dist/build/pdf.mjs',
  './pdfjs-5.5.207-dist/build/pdf.worker.mjs'
];

// Instala el service worker y guarda en caché todos los archivos principales de la aplicación.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[ServiceWorker] Guardando archivos en caché para uso offline');
        return cache.addAll(FILES_TO_CACHE);
      })
  );
  self.skipWaiting();
});

// Activa el service worker y elimina cachés antiguos.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keyList => {
      return Promise.all(keyList.map(key => {
        if (key !== CACHE_NAME) {
          console.log('[ServiceWorker] Eliminando caché antiguo', key);
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

// Intercepta las peticiones y sirve los archivos desde la caché.
// Si un archivo no está en la caché, intenta buscarlo en la red.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(event.request)
        .then(response => {
          return response || fetch(event.request);
        });
    })
  );
});
