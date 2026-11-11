// Service worker Spirit Code: нужен браузеру, чтобы сайт можно было установить как приложение,
// и показывает push-уведомления (например, «Начался урок»), даже когда сайт закрыт.
// Ничего не кэширует — все запросы идут в сеть как обычно, поэтому после деплоя
// у всех сразу новая версия, а уроки, ответы и созвоны никогда не берутся «из старого».
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
// Пустой обработчик: без него Chrome не считает сайт приложением. respondWith не вызываем —
// запрос обрабатывает браузер сам
self.addEventListener('fetch', () => {})

// Уведомление с сервера: {title, body, url, tag}
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Spirit Code', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || undefined, // повторное уведомление о том же уроке заменяет прежнее
      renotify: Boolean(data.tag),
      data: { url: data.url || '/home' },
    })
  )
})

// Нажали на уведомление — открываем нужную страницу: в уже открытой вкладке сайта или в новой
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/home', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          return client.navigate(url).then((c) => (c || client).focus())
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
