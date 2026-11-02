import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { BrowserRouter } from 'react-router-dom'
import { setupInstall } from './utils/install'

setupInstall()

// После деплоя открытая вкладка ищет куски старой сборки (например, страницу созвона), а их уже нет.
// Перезагружаемся на новую версию — один раз за минуту, чтобы не зациклиться, если сервер недоступен
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'spirit.reloadedForUpdate'
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    // без sessionStorage просто перезагружаемся
  }
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
