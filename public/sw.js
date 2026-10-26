// Service Worker para la Quiniela LVBP

self.addEventListener('install', (e) => {
    console.log('Service Worker instalado');
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    console.log('Service Worker activado');
    e.waitUntil(clients.claim());
});

// Manejo de red optimizado y limpio para evitar bloqueos con la API en Render
self.addEventListener('fetch', (e) => {
    e.respondWith(fetch(e.request));
});

// Escucha y muestra las notificaciones Push enviadas desde el servidor (2 horas antes)
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
        icon: '/ball.png', 
        badge: '/ball.png',
        vibrate: [200, 100, 200],
        data: { url: self.location.origin }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// Acción al hacer clic sobre la notificación en el teléfono o PC
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if (client.url.replace(/\/$/, '') === event.notification.data.url && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(event.notification.data.url);
            }
        })
    );
});
