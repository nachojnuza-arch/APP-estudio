const CACHE_NAME = 'apuntes-facultad-cache-v12';

// 1. Lista actualizada con la nueva estructura de carpetas
const FILES_TO_CACHE = [
  './',
  './index.html',
  './app.css',
  './styles.css',
  './google-drive-sync.js',
  './ai-original.js',
  './manifest.json',
  './src/main.js',
  './src/core/data.js',
  './src/core/db.js',
  './src/core/state.js',
  './src/features/pdf-viewer.js',
  './src/features/screenshot.js',
  './src/ui/ai-sources.js',
  './src/ui/export.js',
  './src/ui/render.js',
  './src/ui/utils.js',
  './src/ai/config-dict.js',
  './src/ai/local-init.js',
  './src/ai/summary-engine.js',
  './src/ai/tfidf-vectors.js',
  './src/ai/utils-translate.js',
  './app_logo.png',
  './icon-96.png',
  './icon-192.png',
  './icon-512.png'
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