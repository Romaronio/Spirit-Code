import { Routes, Route } from 'react-router-dom'
import AuthPage from './pages/AuthPage/AuthPage'
import HomePage from './pages/HomePage/HomePage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<AuthPage />} />
      <Route path="/home" element={<HomePage />} />
    </Routes>
  )
}

export default App
