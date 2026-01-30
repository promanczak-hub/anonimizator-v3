import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, FileText, Sparkles, Shield } from 'lucide-react'
import { jobs } from '../api/client'

function HomePage() {
    const [file, setFile] = useState(null)
    const [mode, setMode] = useState('unify')
    const [dragOver, setDragOver] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState(null)
    const fileInputRef = useRef(null)
    const navigate = useNavigate()

    const handleDrop = (e) => {
        e.preventDefault()
        setDragOver(false)
        const droppedFile = e.dataTransfer.files[0]
        if (droppedFile?.type === 'application/pdf') {
            setFile(droppedFile)
            setError(null)
        } else {
            setError('Tylko pliki PDF są obsługiwane')
        }
    }

    const handleFileSelect = (e) => {
        const selectedFile = e.target.files[0]
        if (selectedFile?.type === 'application/pdf') {
            setFile(selectedFile)
            setError(null)
        } else {
            setError('Tylko pliki PDF są obsługiwane')
        }
    }

    const handleUpload = async () => {
        if (!file) return

        setUploading(true)
        setError(null)

        try {
            const job = await jobs.create(file, { mode })
            navigate(`/process/${job.id}`)
        } catch (err) {
            setError(err.response?.data?.detail || 'Błąd podczas uploadu pliku')
            setUploading(false)
        }
    }

    return (
        <div style={{ maxWidth: 700, margin: '0 auto', paddingTop: 40 }}>
            <div style={{ textAlign: 'center', marginBottom: 40 }}>
                <h1 style={{ marginBottom: 12 }}>Anonimizacja dokumentów</h1>
                <p className="text-muted">
                    Prześlij ofertę lub specyfikację samochodu do anonimizacji
                </p>
            </div>

            <div
                className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
            >
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    accept=".pdf"
                    style={{ display: 'none' }}
                />

                {file ? (
                    <>
                        <FileText size={48} />
                        <div className="upload-zone-title">{file.name}</div>
                        <div className="upload-zone-subtitle">
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                        </div>
                    </>
                ) : (
                    <>
                        <Upload size={48} />
                        <div className="upload-zone-title">
                            Przeciągnij plik PDF lub kliknij aby wybrać
                        </div>
                        <div className="upload-zone-subtitle">
                            Maksymalny rozmiar: 50 MB
                        </div>
                    </>
                )}
            </div>

            {error && (
                <div className="badge badge-error" style={{ marginTop: 16 }}>
                    {error}
                </div>
            )}

            <div className="mode-selector">
                <div
                    className={`mode-option ${mode === 'unify' ? 'selected' : ''}`}
                    onClick={() => setMode('unify')}
                >
                    <Sparkles size={24} style={{ marginBottom: 8, color: 'var(--color-accent)' }} />
                    <div className="mode-option-label">Tryb A: Unifikacja</div>
                    <div className="mode-option-desc">
                        Pełna ekstrakcja do Digital Twin
                    </div>
                </div>

                <div
                    className={`mode-option ${mode === 'layout' ? 'selected' : ''}`}
                    onClick={() => setMode('layout')}
                >
                    <Shield size={24} style={{ marginBottom: 8, color: 'var(--color-accent)' }} />
                    <div className="mode-option-label">Tryb B: Redakcja</div>
                    <div className="mode-option-desc">
                        Zachowaj oryginalny układ
                    </div>
                </div>
            </div>

            <button
                className="btn btn-primary"
                style={{ width: '100%', marginTop: 24, padding: 16, fontSize: '1rem' }}
                onClick={handleUpload}
                disabled={!file || uploading}
            >
                {uploading ? 'Przetwarzanie...' : 'Rozpocznij anonimizację'}
            </button>
        </div>
    )
}

export default HomePage
