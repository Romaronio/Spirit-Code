// Service worker Spirit Code: нужен браузеру, чтобы сайт можно было установить как приложение.
// Ничего не кэширует — все запросы идут в сеть как обычно, поэтому после деплоя
// у всех сразу новая версия, а уроки, ответы и созвоны никогда не берутся «из старого».
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
// Пустой обработчик: без него Chrome не считает сайт приложением. respondWith не вызываем —
// запрос обрабатывает браузер сам
self.addEventListener('fetch', () => {})
