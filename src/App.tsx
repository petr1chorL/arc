import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Agents } from './pages/Agents'
import { Dashboard } from './pages/Dashboard'
import { Evaluations } from './pages/Evaluations'
import { Reviews } from './pages/Reviews'
import { Runs } from './pages/Runs'
import { Workflows } from './pages/Workflows'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/workflows" element={<Workflows />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/evaluations" element={<Evaluations />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/reviews" element={<Reviews />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
