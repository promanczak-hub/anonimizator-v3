import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { Shield, FileText, FolderOpen, Plus } from 'lucide-react'
import HomePage from './pages/HomePage'
import ProcessingPage from './pages/ProcessingPage'
import LibraryPage from './pages/LibraryPage'

function App() {
    return (
        <BrowserRouter>
            <div className="app-container">
                <header className="header">
                    <div className="header-logo">
                        <Shield size={28} />
                        <span>Anonimizator</span>
                    </div>

                    <nav className="header-nav">
                        <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                            <Plus size={18} />
                            Nowy
                        </NavLink>
                        <NavLink to="/library" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                            <FolderOpen size={18} />
                            Biblioteka
                        </NavLink>
                    </nav>
                </header>

                <main className="main-content">
                    <Routes>
                        <Route path="/" element={<HomePage />} />
                        <Route path="/process/:jobId" element={<ProcessingPage />} />
                        <Route path="/library" element={<LibraryPage />} />
                    </Routes>
                </main>
            </div>
        </BrowserRouter>
    )
}

export default App
