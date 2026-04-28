const CACHE_NAME = 'apuntes-facultad-cache-v2';

// 1. Lista corregida: usamos los nombres reales de tus archivos
const FILES_TO_CACHE = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './local-summary.js',
  './google-drive-sync.js',
  './ai-original.js',
  './manifest.json'
];

// Instala el service worker y guarda en caché
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[ServiceWorker] Guardando archivos en caché para uso offline');
        // Usamos catch para que si falta un archivo (ej: app.css), el ServiceWorker no se muera
        return cache.addAll(FILES_TO_CACHE).catch(err => {
            console.warn('[ServiceWorker] Advertencia: Algún archivo no se pudo cachear.', err);
        });
      })
  );
  self.skipWaiting();
});

// Activa el service worker y elimina cachés antiguos
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

// Intercepta las peticiones (Fetch)
self.addEventListener('fetch', event => {
  
  // 🛑 REGLA DE ORO PARA GOOGLE DRIVE Y GEMINI
  // Si la petición va dirigida a Google, Drive o no es tipo GET (ej: POST para subir archivo),
  // el ServiceWorker la ignora y la deja pasar directo a internet.
  if (
      event.request.url.includes('googleapis.com') || 
      event.request.url.includes('googleusercontent.com') ||
      event.request.url.includes('googledrive.com') ||
      event.request.method !== 'GET'
  ) {
      return; 
  }

  // Para el resto (archivos de tu página), intenta usar el caché o ir a la red
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request).catch(() => {
            console.log('[ServiceWorker] Sin conexión para:', event.request.url);
        });
      })
  );
});