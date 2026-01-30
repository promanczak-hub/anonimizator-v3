import { BrowserRouter, Routes, Route, NavLink, Link } from 'react-router-dom'
import { FileText, FolderOpen, Plus } from 'lucide-react'
import HomePage from './pages/HomePage'
import ProcessingPage from './pages/ProcessingPage'
import LibraryPage from './pages/LibraryPage'

function App() {
    return (
        <BrowserRouter>
            <div className="app-container">
                <header className="header">
                    <Link to="/" className="header-logo" style={{ textDecoration: 'none', cursor: 'pointer' }}>
                        <img src="/express_logo.png" alt="Express Car Rental" style={{ height: 36 }} />
                        <span style={{ marginLeft: 8, fontWeight: 600, color: 'var(--color-text-primary)' }}>Anonimizator</span>
                    </Link>

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
