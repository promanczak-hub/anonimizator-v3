import { BrowserRouter, Routes, Route, NavLink, Link, Navigate } from 'react-router-dom'
import { FolderOpen } from 'lucide-react'
import ProcessingPage from './pages/ProcessingPage'
import LibraryPage from './pages/LibraryPage'

function App() {
    return (
        <BrowserRouter>
            <div className="app-container">
                <header className="header">
                    <Link to="/library" className="header-logo" style={{ textDecoration: 'none', cursor: 'pointer' }}>
                        <img src="/express_logo.png" alt="Express Car Rental" style={{ height: 36 }} />
                        <span style={{ marginLeft: 8, fontWeight: 600, color: 'var(--color-text-primary)' }}>Anonimizator</span>
                    </Link>

                    <nav className="header-nav">
                        <NavLink to="/library" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                            <FolderOpen size={18} />
                            Biblioteka
                        </NavLink>
                    </nav>
                </header>

                <main className="main-content">
                    <Routes>
                        <Route path="/" element={<Navigate to="/library" replace />} />
                        <Route path="/process/:jobId" element={<ProcessingPage />} />
                        <Route path="/library" element={<LibraryPage />} />
                    </Routes>
                </main>
            </div>
        </BrowserRouter>
    )
}

export default App
