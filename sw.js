/* 梦游周记 · 离线缓存
 *
 * 策略（关键：保证「换新版后手机上不会一直卡旧版」）
 *   - 页面导航（index.html）：网络优先。有网必拿最新版，没网回退缓存。
 *   - ./assets/ 里的 js/css/png：缓存优先。文件名带 hash，内容变了文件名就变，天然不会过时。
 *   - 其他 GET（manifest、图标、字体）：stale-while-revalidate。
 *
 * 每次发版只需要改 CACHE 里的版本号，activate 时会自动清掉所有旧缓存。
 */
const VERSION = 'v2'
const CACHE = `together-fit-${VERSION}`
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE).catch(() => undefined))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// 页面那边喊一声就立刻接管，省得用户开两次
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting()
})

function isAsset(url) {
  return /\/assets\/.+\.(js|css|png|jpg|jpeg|svg|webp|woff2?)$/i.test(url)
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || !req.url.startsWith('http')) return

  const url = new URL(req.url)
  const sameOrigin = url.origin === self.location.origin

  // 1) 页面导航：网络优先，断网回退缓存的 index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && sameOrigin) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put('./index.html', copy))
          }
          return res
        })
        .catch(() =>
          caches.match('./index.html').then((cached) => cached || caches.match('./') || Response.error())
        )
    )
    return
  }

  // 2) 带 hash 的构建产物：缓存优先
  if (sameOrigin && isAsset(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy))
            }
            return res
          })
      )
    )
    return
  }

  // 3) 其余：先给缓存，后台悄悄更新
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => cached)
      return cached || network
    })
  )
})
