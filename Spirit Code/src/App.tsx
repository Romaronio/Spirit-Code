import { Routes, Route } from 'react-router-dom';
import Registration_Place from './Input_Sait/Registration_Place';
import Home_Pages from './Home_Pages/Home_Pages';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Registration_Place />} />
      
      {/* Добавляем маршрут для dashboard */}
      <Route path="/dashboard" element={<Home_Pages />} /> 
      
      {/* Или можно оставить /home, если хотите */}
      <Route path="/home" element={<Home_Pages />} />
    </Routes>
  )
}

export default App
