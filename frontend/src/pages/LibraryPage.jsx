import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, FileText, Trash2, Upload, Shield } from 'lucide-react'
import { jobs } from '../api/client'

function LibraryPage() {
    const [allDocs, setAllDocs] = useState([])
    const [loading, setLoading] = useState(true)
    const [query, setQuery] = useState('')
    const [statusFilter, setStatusFilter] = useState('')
    const [modeFilter, setModeFilter] = useState('')
    const [deleteConfirm, setDeleteConfirm] = useState(null)
    const [deleting, setDeleting] = useState(false)
    const navigate = useNavigate()

    // Upload state (Redakcja mode only)
    const [file, setFile] = useState(null)
    const uploadMode = 'layout' // Fixed to Redakcja mode
    const [dragOver, setDragOver] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [uploadError, setUploadError] = useState(null)
    const fileInputRef = useRef(null)
    const MAX_FILE_SIZE_MB = 30
    const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

    const fetchDocuments = async () => {
        setLoading(true)
        try {
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

    // File validation
    const validateFile = (candidateFile) => {
        if (!candidateFile || candidateFile.type !== 'application/pdf') {
            return { valid: false, error: 'Tylko pliki PDF są obsługiwane' }
        }
        if (candidateFile.size > MAX_FILE_SIZE_BYTES) {
            return { valid: false, error: `Maksymalny rozmiar pliku to ${MAX_FILE_SIZE_MB} MB` }
        }
        return { valid: true }
    }

    const handleDrop = (e) => {
        e.preventDefault()
        setDragOver(false)
        const droppedFile = e.dataTransfer.files[0]
        const validation = validateFile(droppedFile)
        if (validation.valid) {
            setFile(droppedFile)
            setUploadError(null)
        } else {
            setFile(null)
            setUploadError(validation.error)
        }
    }

    const handleFileSelect = (e) => {
        const selectedFile = e.target.files[0]
        const validation = validateFile(selectedFile)
        if (validation.valid) {
            setFile(selectedFile)
            setUploadError(null)
        } else {
            e.target.value = null
            setFile(null)
            setUploadError(validation.error)
        }
    }

    const handleUpload = async () => {
        if (!file) return

        setUploading(true)
        setUploadError(null)

        try {
            const job = await jobs.create(file, { mode: uploadMode })
            navigate(`/process/${job.id}`)
        } catch (err) {
            setUploadError(err.response?.data?.detail || 'Błąd podczas uploadu pliku')
            setUploading(false)
        }
    }

    // Delete document handler
    const handleDelete = async (e, doc) => {
        e.stopPropagation()
        setDeleteConfirm({ id: doc.id, name: doc.original_filename })
    }

    const confirmDelete = async () => {
        if (!deleteConfirm) return
        setDeleting(true)
        try {
            await jobs.delete(deleteConfirm.id)
            setAllDocs(prev => prev.filter(d => d.id !== deleteConfirm.id))
            setDeleteConfirm(null)
        } catch (err) {
            console.error('Error deleting document:', err)
            alert('Błąd usuwania dokumentu: ' + err.message)
        }
        setDeleting(false)
    }

    // Client-side filtering
    const filteredDocs = useMemo(() => {
        return allDocs.filter(doc => {
            const searchLower = query.toLowerCase().trim()
            const matchesQuery = !searchLower ||
                doc.original_filename?.toLowerCase().includes(searchLower) ||
                doc.description?.toLowerCase().includes(searchLower)
            const matchesStatus = !statusFilter || doc.status === statusFilter
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
            {/* Upload Section */}
            <div className="card" style={{ marginBottom: 24, padding: 24 }}>
                <div className="flex gap-lg" style={{ alignItems: 'center' }}>
                    {/* Upload Zone - compact */}
                    <div
                        className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        style={{
                            flex: 1,
                            padding: '20px 24px',
                            minHeight: 'auto'
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label="Wybierz plik PDF"
                    >
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileSelect}
                            accept=".pdf"
                            style={{ display: 'none' }}
                        />
                        <div className="flex gap-md" style={{ alignItems: 'center' }}>
                            {file ? <FileText size={28} /> : <Upload size={28} />}
                            <div>
                                <div style={{ fontWeight: 500 }}>
                                    {file ? file.name : 'Przeciągnij PDF lub kliknij'}
                                </div>
                                <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                    {file
                                        ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                                        : `Maksymalny rozmiar: ${MAX_FILE_SIZE_MB} MB`
                                    }
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Upload button */}
                    <button
                        className="btn btn-primary"
                        onClick={handleUpload}
                        disabled={!file || uploading}
                        style={{ padding: '12px 24px', whiteSpace: 'nowrap' }}
                    >
                        {uploading ? 'Przetwarzanie...' : 'Przetwarzaj PDF'}
                    </button>
                </div>

                {uploadError && (
                    <div className="badge badge-error" style={{ marginTop: 12 }}>
                        {uploadError}
                    </div>
                )}
            </div>

            {/* Library Header */}
            <div className="flex items-center justify-between mb-md">
                <h2 style={{ margin: 0 }}>Dokumenty</h2>
                <span className="text-muted">{filteredDocs.length} dokumentów</span>
            </div>

            {/* Search and filters */}
            <div className="flex gap-md mb-md">
                <div className="search-bar" style={{ flex: 1 }}>
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Szukaj po nazwie..."
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
                    <p className="text-muted">
                        {query ? 'Nie znaleziono dokumentów' : 'Prześlij pierwszy PDF powyżej'}
                    </p>
                </div>
            ) : (
                <div className="document-grid">
                    {filteredDocs.map(doc => (
                        <div
                            key={doc.id}
                            className="document-card"
                            onClick={() => navigate(`/process/${doc.id}`)}
                            style={{ cursor: 'pointer', position: 'relative' }}
                        >
                            <button
                                className="btn btn-icon btn-sm delete-btn"
                                onClick={(e) => handleDelete(e, doc)}
                                title="Usuń dokument"
                                style={{
                                    position: 'absolute',
                                    top: '8px',
                                    right: '8px',
                                    zIndex: 10,
                                    background: 'rgba(239, 68, 68, 0.9)',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '50%',
                                    width: '28px',
                                    height: '28px',
                                    padding: '4px',
                                    opacity: 0.7,
                                    transition: 'opacity 0.2s',
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
                                onMouseLeave={(e) => e.currentTarget.style.opacity = 0.7}
                            >
                                <Trash2 size={16} />
                            </button>
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

            {/* Delete confirmation modal */}
            {deleteConfirm && (
                <div
                    className="modal-overlay"
                    onClick={() => setDeleteConfirm(null)}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0, 0, 0, 0.6)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000,
                    }}
                >
                    <div
                        className="modal-content card"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: 'var(--bg-secondary)',
                            padding: '24px',
                            borderRadius: '12px',
                            maxWidth: '400px',
                            width: '90%',
                        }}
                    >
                        <h3 style={{ marginBottom: '16px' }}>Potwierdź usunięcie</h3>
                        <p style={{ marginBottom: '20px', color: 'var(--text-secondary)' }}>
                            Czy na pewno chcesz usunąć dokument <strong>{deleteConfirm.name}</strong>?
                            <br /><br />
                            Ta operacja jest nieodwracalna.
                        </p>
                        <div className="flex gap-sm" style={{ justifyContent: 'flex-end' }}>
                            <button
                                className="btn btn-secondary"
                                onClick={() => setDeleteConfirm(null)}
                                disabled={deleting}
                            >
                                Anuluj
                            </button>
                            <button
                                className="btn"
                                onClick={confirmDelete}
                                disabled={deleting}
                                style={{ background: '#ef4444', color: 'white' }}
                            >
                                {deleting ? 'Usuwanie...' : 'Usuń'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default LibraryPage
