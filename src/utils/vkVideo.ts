// Встроенный плеер VK Видео для записи урока.
// Понимает ссылки вида vkvideo.ru/video-123_456, vk.com/video-123_456,
// vk.com/...?z=video-123_456, клипы (clip-123_456) и готовые ссылки плеера
// video_ext.php (их даёт «Поделиться → Код для вставки» — с hash, нужен
// для видео с доступом «по ссылке»).

const VK_HOSTS = /^(?:[a-z0-9-]+\.)*(?:vk\.com|vk\.ru|vkvideo\.ru)$/i

function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return VK_HOSTS.test(url.hostname) ? url : null
  } catch {
    return null
  }
}

/** Ссылка для <iframe> плеера VK или null, если это не видео VK. */
export function vkEmbedUrl(value: string | undefined | null): string | null {
  if (!value) return null
  const url = parseUrl(value)
  if (!url) return null

  let oid: string | null
  let id: string | null
  let hash = url.searchParams.get('hash')

  if (url.pathname.endsWith('/video_ext.php')) {
    oid = url.searchParams.get('oid')
    id = url.searchParams.get('id')
  } else {
    const match = decodeURIComponent(url.pathname + url.search).match(/(?:video|clip)(-?\d+)_(\d+)/)
    if (!match) return null
    ;[, oid, id] = match
  }
  if (!oid || !/^-?\d+$/.test(oid) || !id || !/^\d+$/.test(id)) return null
  if (hash && !/^[\w-]+$/.test(hash)) hash = null

  const embed = new URL('https://vkvideo.ru/video_ext.php')
  embed.searchParams.set('oid', oid)
  embed.searchParams.set('id', id)
  if (hash) embed.searchParams.set('hash', hash)
  embed.searchParams.set('hd', '2')
  return embed.toString()
}

/** Если вставили код <iframe ...> из VK — оставляем только ссылку из src. */
export function normalizeRecordingUrl(value: string): string {
  if (!/<iframe/i.test(value)) return value
  const src = value.match(/src\s*=\s*["']([^"']+)["']/i)?.[1]
  if (!src) return value
  const decoded = src.replace(/&amp;/g, '&')
  return decoded.startsWith('//') ? `https:${decoded}` : decoded
}
