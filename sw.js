// Service Worker para la Quiniela LVBP

self.addEventListener('install', (e) => {
    console.log('Service Worker instalado');
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    console.log('Service Worker activado');
    e.waitUntil(clients.claim());
});

// Interceptador de peticiones para mantener el funcionamiento fluido de la app
self.addEventListener('fetch', (e) => {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

// NUEVO: Escucha y muestra las notificaciones Push enviadas desde el servidor (2 horas antes)
self.addEventListener('push', (event) => {
    let data = { 
        title: '⚾ ¡Hora de alistar las carreras! 🏟️', 
        body: 'Faltan 2 horas para que cierren los pronósticos de la jornada. ¡Entra ya a la Quiniela y guarda tu jugada! ⏳✍️' 
    };
    
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body,
        icon: '/icon.png', // Icono por defecto de la app
        badge: '/icon.png',
        vibrate: [200, 100, 200],
        data: { url: self.location.origin }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// NUEVO: Acción al hacer clic sobre la notificación en el teléfono o PC
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if (client.url === event.notification.data.url && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(event.notification.data.url);
            }
        })
    );
});