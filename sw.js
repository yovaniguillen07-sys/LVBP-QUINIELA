self.addEventListener('install', (e) => {
    console.log('Service Worker instalado');
});

self.addEventListener('fetch', (e) => {
    // Permite que la app funcione y cargue con normalidad
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});