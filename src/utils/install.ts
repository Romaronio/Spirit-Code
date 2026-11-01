import { useEffect, useState } from 'react'

// Установка сайта как приложения (PWA). Событие beforeinstallprompt браузер присылает один раз
// и рано — ловим его сразу при загрузке, а кнопка «Установить» появляется, когда оно есть

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

export function setupInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // своё окно браузер покажет по нажатию нашей кнопки
    deferred = e as InstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
  // Service worker нужен браузеру для установки; в разработке не мешаем Vite
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => console.error('Service worker:', err))
    })
  }
}

// Можно ли сейчас предложить установку (не установлено и браузер разрешил)
export function useCanInstall() {
  const [can, setCan] = useState(() => deferred !== null)
  useEffect(() => {
    const update = () => setCan(deferred !== null)
    listeners.add(update)
    update()
    return () => {
      listeners.delete(update)
    }
  }, [])
  return can
}

export async function promptInstall() {
  const event = deferred
  if (!event) return
  await event.prompt()
  const { outcome } = await event.userChoice
  if (outcome === 'accepted') {
    deferred = null
    notify()
  }
}
