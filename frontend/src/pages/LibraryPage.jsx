import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, FileText } from 'lucide-react'
import { jobs } from '../api/client'

function LibraryPage() {
    const [allDocs, setAllDocs] = useState([])
    const [loading, setLoading] = useState(true)
    const [query, setQuery] = useState('')
    const [statusFilter, setStatusFilter] = useState('')
    const [modeFilter, setModeFilter] = useState('')
    const navigate = useNavigate()

    const fetchDocuments = async () => {
        setLoading(true)
        try {
            // Fetch all documents (no server-side filtering)
            const data = await jobs.list({})
            setAllDocs(data.items || [])
        } catch (err) {
            console.error('Error fetching documents:', err)
        }
        setLoading(false)
    }

    useEffect(() => {
        fetchDocuments()
    }, [])

    // Client-side filtering - real-time as user types
    const filteredDocs = useMemo(() => {
        return allDocs.filter(doc => {
            // Filter by search query (partial match, case-insensitive)
            const searchLower = query.toLowerCase().trim()
            const matchesQuery = !searchLower ||
                doc.original_filename?.toLowerCase().includes(searchLower) ||
                doc.description?.toLowerCase().includes(searchLower)

            // Filter by status
            const matchesStatus = !statusFilter || doc.status === statusFilter

            // Filter by mode
            const matchesMode = !modeFilter || doc.mode === modeFilter

            return matchesQuery && matchesStatus && matchesMode
        })
    }, [allDocs, query, statusFilter, modeFilter])

    const formatDate = (dateStr) => {
        return new Date(dateStr).toLocaleDateString('pl-PL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        })
    }



    return (
        <div>
            <div className="flex items-center justify-between mb-md">
                <h1>Biblioteka dokumentów</h1>
                <span className="text-muted">{filteredDocs.length} dokumentów</span>
            </div>

            {/* Search and filters */}
            <div className="flex gap-md mb-md">
                <div className="search-bar" style={{ flex: 1 }}>
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Szukaj po nazwie, opisie..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        style={{ flex: 1 }}
                    />
                    <span className="btn btn-secondary" style={{ pointerEvents: 'none' }}>
                        <Search size={18} />
                    </span>
                </div>

                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="btn btn-secondary"
                >
                    <option value="">Wszystkie statusy</option>
                    <option value="done">Gotowe</option>
                    <option value="review">Do weryfikacji</option>
                    <option value="processing">W trakcie</option>
                    <option value="failed">Błąd</option>
                </select>

                <select
                    value={modeFilter}
                    onChange={(e) => setModeFilter(e.target.value)}
                    className="btn btn-secondary"
                >
                    <option value="">Wszystkie tryby</option>
                    <option value="unify">Unifikacja</option>
                    <option value="layout">Redakcja</option>
                </select>
            </div>

            {/* Documents grid */}
            {loading ? (
                <div className="empty-state">
                    <p>Ładowanie...</p>
                </div>
            ) : filteredDocs.length === 0 ? (
                <div className="empty-state">
                    <FileText size={48} />
                    <h3>Brak dokumentów</h3>
                    <p className="text-muted">{query ? 'Nie znaleziono dokumentów pasujących do wyszukiwania' : 'Prześlij pierwszy dokument aby rozpocząć'}</p>
                </div>
            ) : (
                <div className="document-grid">
                    {filteredDocs.map(doc => (
                        <div
                            key={doc.id}
                            className="document-card"
                            onClick={() => navigate(`/process/${doc.id}`)}
                            style={{ cursor: 'pointer' }}
                        >
                            <div className="document-thumbnail">
                                {doc.page_count > 0 ? (
                                    <img
                                        src={jobs.getThumbnailUrl(doc.id, 0)}
                                        alt={doc.original_filename}
                                        onError={(e) => e.target.style.display = 'none'}
                                    />
                                ) : (
                                    <FileText size={48} style={{ opacity: 0.3 }} />
                                )}
                            </div>
                            <div className="document-info">
                                <div className="document-name" title={doc.original_filename}>
                                    {doc.original_filename}
                                </div>
                                <div className="document-meta">
                                    <span className="status">
                                        <span className={`status-dot ${doc.status}`} />
                                        {doc.status === 'done' ? 'Gotowe' :
                                            doc.status === 'review' ? 'Weryfikacja' :
                                                doc.status === 'failed' ? 'Błąd' : 'Przetwarzanie'}
                                    </span>
                                    <span>{formatDate(doc.created_at)}</span>
                                </div>
                                <div className="document-meta mt-sm">
                                    <span className="badge badge-info">
                                        {doc.mode === 'unify' ? 'Unifikacja' : 'Redakcja'}
                                    </span>
                                    <span>{doc.page_count} str.</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

export default LibraryPage
