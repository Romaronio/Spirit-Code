import { useCallback, useEffect, useState } from 'react'
import * as api from '../services/api'

// Push-уведомления: приходят, даже когда сайт закрыт (о начале урока и т. п.).
// Подписку браузера сохраняем на сервере; при выходе из аккаунта — удаляем

export type PushState =
  | 'unsupported' // браузер не умеет
  | 'needs-install' // iPhone/iPad: работает только у сайта, добавленного на экран «Домой»
  | 'denied' // ученик запретил — включить можно только в настройках браузера
  | 'off' // можно включить
  | 'on'

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

function supported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

// Service worker регистрируется только в собранном сайте (utils/install.ts) — в разработке его нет
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null
  const existing = await navigator.serviceWorker.getRegistration()
  if (existing) return existing
  if (!import.meta.env.PROD) return null
  return navigator.serviceWorker.ready
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

async function currentState(): Promise<PushState> {
  if (isIos() && !isStandalone() && !('PushManager' in window)) return 'needs-install'
  if (!supported()) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') return 'off'
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}

// Подписать это устройство: спросить разрешение (только по нажатию кнопки) и сохранить подписку
export async function enablePush(): Promise<PushState> {
  if (!supported()) return currentState()
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'
  const reg = await registration()
  if (!reg) throw new Error('Уведомления работают только на сайте spiritcode.duckdns.org')
  const key = await api.getPushKey()
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
  }
  await api.savePushSubscription(sub.toJSON())
  return 'on'
}

// Разрешение уже есть — напоминаем серверу о подписке (она могла смениться или перейти к другому аккаунту)
export async function syncPush() {
  if (!supported() || Notification.permission !== 'granted') return
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) await api.savePushSubscription(sub.toJSON())
}

// При выходе: этому аккаунту на этом устройстве уведомления больше не нужны
export async function disablePush() {
  if (!supported()) return
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await api.deletePushSubscription(sub.endpoint).catch(() => {})
  await sub.unsubscribe().catch(() => false)
}

export function usePush() {
  const [state, setState] = useState<PushState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    currentState()
      .then((s) => !cancelled && setState(s))
      .catch(() => !cancelled && setState('unsupported'))
    syncPush().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const enable = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      setState(await enablePush())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось включить уведомления')
    } finally {
      setBusy(false)
    }
  }, [])

  return { state, error, busy, enable }
}
