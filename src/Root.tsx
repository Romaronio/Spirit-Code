import { Suspense, lazy } from 'react'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'

// Страница родителя (/parent/<token>) открывается без входа и не трогает сессию сайта
const ParentPage = lazy(() => import('./pages/ParentPage/ParentPage'))

function Root() {
  const parentToken = /^\/parent\/([^/]+)\/?$/.exec(window.location.pathname)?.[1]
  if (parentToken) {
    return (
      <Suspense fallback={null}>
        <ParentPage token={decodeURIComponent(parentToken)} />
      </Suspense>
    )
  }
  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  )
}

export default Root
