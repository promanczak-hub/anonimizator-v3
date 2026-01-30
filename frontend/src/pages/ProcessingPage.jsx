import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import {
    Download, FileText, Check, X, Eye, EyeOff,
    AlertTriangle, ChevronLeft, ChevronRight, ZoomIn, ZoomOut
} from 'lucide-react'
import { jobs } from '../api/client'

// Tab components
const TABS = ['Fiszki', 'Wykrycia', 'Adnotacje', 'Audit']

function ProcessingPage() {
    const { jobId } = useParams()
    const [job, setJob] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [activeTab, setActiveTab] = useState('Fiszki')
    const [currentPage, setCurrentPage] = useState(0)
    const [zoom, setZoom] = useState(100)
    const [decisions, setDecisions] = useState({})
    const [rendering, setRendering] = useState(false)

    // Poll for job status
    useEffect(() => {
        const fetchJob = async () => {
            try {
                const data = await jobs.get(jobId)
                setJob(data)
                setLoading(false)

                // Continue polling if still processing
                if (['queued', 'processing', 'analyzing'].includes(data.status)) {
                    setTimeout(fetchJob, 2000)
                }
            } catch (err) {
                setError(err.response?.data?.detail || 'Błąd ładowania')
                setLoading(false)
            }
        }

        fetchJob()
    }, [jobId])

    const handleDecision = (itemId, action) => {
        setDecisions(prev => ({ ...prev, [itemId]: action }))
    }

    const handleCategoryAction = (category, action) => {
        const findings = job?.findings || []
        const categoryFindings = findings.filter(f => f.category === category)
        const newDecisions = { ...decisions }
        categoryFindings.forEach(f => {
            newDecisions[f.id] = action
        })
        setDecisions(newDecisions)
    }

    const handleRender = async () => {
        setRendering(true)
        try {
            const decisionsList = Object.entries(decisions).map(([itemId, action]) => ({
                item_id: itemId,
                item_type: 'finding',
                action,
            }))

            await jobs.submitDecisions(jobId, { decisions: decisionsList })
            await jobs.render(jobId)

            // Poll for completion
            const checkDone = async () => {
                const data = await jobs.get(jobId)
                setJob(data)
                if (data.status === 'rendering') {
                    setTimeout(checkDone, 1000)
                } else {
                    setRendering(false)
                }
            }
            checkDone()
        } catch (err) {
            setError('Błąd generowania pliku')
            setRendering(false)
        }
    }

    if (loading) {
        return (
            <div className="empty-state">
                <div className="progress-bar" style={{ width: 200 }}>
                    <div className="progress-bar-fill" style={{ width: '50%' }} />
                </div>
                <p className="mt-md text-muted">Ładowanie...</p>
            </div>
        )
    }

    if (error) {
        return (
            <div className="empty-state">
                <AlertTriangle size={48} />
                <p>{error}</p>
            </div>
        )
    }

    const isProcessing = ['queued', 'processing', 'analyzing'].includes(job.status)
    const isReview = job.status === 'review'
    const isDone = job.status === 'done'

    return (
        <div>
            {/* Top bar */}
            <div className="flex items-center justify-between mb-md">
                <div className="flex items-center gap-md">
                    <h2>{job.original_filename}</h2>
                    <span className="status">
                        <span className={`status-dot ${job.status}`} />
                        {job.status === 'queued' && 'W kolejce'}
                        {job.status === 'processing' && 'Przetwarzanie...'}
                        {job.status === 'analyzing' && 'Analiza AI...'}
                        {job.status === 'review' && 'Do weryfikacji'}
                        {job.status === 'rendering' && 'Generowanie...'}
                        {job.status === 'done' && 'Gotowe'}
                        {job.status === 'failed' && 'Błąd'}
                    </span>
                    {job.confidence > 0 && (
                        <span className="badge badge-info">
                            {Math.round(job.confidence * 100)}% pewności
                        </span>
                    )}
                </div>

                <div className="flex gap-sm">
                    {isDone && (
                        <>
                            <a
                                href={jobs.getDownloadUrl(jobId, 'pdf')}
                                className="btn btn-primary"
                                download
                            >
                                <Download size={18} />
                                Pobierz PDF
                            </a>
                            {job.mode === 'unify' && (
                                <a
                                    href={jobs.getDownloadUrl(jobId, 'json')}
                                    className="btn btn-secondary"
                                    download
                                >
                                    <FileText size={18} />
                                    Digital Twin
                                </a>
                            )}
                        </>
                    )}
                    {isReview && (
                        <button
                            className="btn btn-primary"
                            onClick={handleRender}
                            disabled={rendering}
                        >
                            {rendering ? 'Generowanie...' : 'Generuj PDF'}
                        </button>
                    )}
                </div>
            </div>

            {/* Progress bar for processing */}
            {isProcessing && (
                <div className="card mb-md">
                    <div className="flex items-center justify-between mb-md">
                        <span>Postęp przetwarzania</span>
                        <span className="font-semibold">{job.progress}%</span>
                    </div>
                    <div className="progress-bar">
                        <div
                            className="progress-bar-fill"
                            style={{ width: `${job.progress}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Split view for review */}
            {(isReview || isDone) && (
                <div className="split-view">
                    {/* PDF Viewer */}
                    <div className="split-view-left">
                        <div className="pdf-viewer">
                            {job.thumbnails?.map((_, idx) => (
                                <div
                                    key={idx}
                                    className="pdf-page"
                                    style={{
                                        width: `${zoom}%`,
                                        display: currentPage === idx || job.page_count <= 3 ? 'block' : 'none'
                                    }}
                                >
                                    <img
                                        src={jobs.getThumbnailUrl(jobId, idx)}
                                        alt={`Strona ${idx + 1}`}
                                    />
                                    {/* Highlight boxes would go here */}
                                </div>
                            ))}
                        </div>

                        <div className="pdf-controls">
                            <button
                                className="btn btn-icon"
                                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                                disabled={currentPage === 0}
                            >
                                <ChevronLeft size={20} />
                            </button>
                            <span className="text-sm">
                                {currentPage + 1} / {job.page_count}
                            </span>
                            <button
                                className="btn btn-icon"
                                onClick={() => setCurrentPage(p => Math.min(job.page_count - 1, p + 1))}
                                disabled={currentPage >= job.page_count - 1}
                            >
                                <ChevronRight size={20} />
                            </button>
                            <div style={{ width: 1, height: 20, background: 'var(--color-border)', margin: '0 8px' }} />
                            <button className="btn btn-icon" onClick={() => setZoom(z => Math.max(50, z - 25))}>
                                <ZoomOut size={18} />
                            </button>
                            <span className="text-sm">{zoom}%</span>
                            <button className="btn btn-icon" onClick={() => setZoom(z => Math.min(200, z + 25))}>
                                <ZoomIn size={18} />
                            </button>
                        </div>
                    </div>

                    {/* Right panel */}
                    <div className="split-view-right">
                        <div className="tabs">
                            {TABS.map(tab => (
                                <button
                                    key={tab}
                                    className={`tab ${activeTab === tab ? 'active' : ''}`}
                                    onClick={() => setActiveTab(tab)}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>

                        {/* Fiszki tab */}
                        {activeTab === 'Fiszki' && (
                            <div className="flex flex-col gap-sm">
                                {job.fiszki?.map(fiszka => (
                                    <div key={fiszka.id} className="fiszka">
                                        <div className={`fiszka-indicator ${fiszka.risk_level.toLowerCase()}`} />
                                        <div className="fiszka-content">
                                            <div className="fiszka-title">{fiszka.label}</div>
                                            <div className="fiszka-description">{fiszka.description}</div>
                                        </div>
                                        <div className="fiszka-count">{fiszka.items_count}</div>
                                        <div className="fiszka-actions">
                                            <button
                                                className={`btn btn-icon ${decisions[fiszka.id] === 'remove' ? 'btn-danger' : ''}`}
                                                title="Usuń"
                                                onClick={() => handleCategoryAction(fiszka.category, 'remove')}
                                            >
                                                <X size={16} />
                                            </button>
                                            <button
                                                className={`btn btn-icon ${decisions[fiszka.id] === 'mask' ? 'btn-warning' : ''}`}
                                                title="Zamaskuj"
                                                onClick={() => handleCategoryAction(fiszka.category, 'mask')}
                                            >
                                                <EyeOff size={16} />
                                            </button>
                                            <button
                                                className="btn btn-icon"
                                                title="Zachowaj"
                                                onClick={() => handleCategoryAction(fiszka.category, 'keep')}
                                            >
                                                <Eye size={16} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Wykrycia tab */}
                        {activeTab === 'Wykrycia' && (
                            <div className="flex flex-col gap-sm">
                                {job.findings?.map(finding => (
                                    <div key={finding.id} className="fiszka">
                                        <div className="fiszka-content">
                                            <div className="fiszka-title">{finding.label}</div>
                                            <div className="fiszka-description">
                                                {finding.value_preview} • Strona {finding.page}
                                            </div>
                                        </div>
                                        <span className="badge badge-info">
                                            {Math.round(finding.confidence * 100)}%
                                        </span>
                                        <div className="fiszka-actions">
                                            <button
                                                className={`btn btn-icon ${decisions[finding.id] === 'remove' ? 'btn-danger' : ''}`}
                                                onClick={() => handleDecision(finding.id, 'remove')}
                                            >
                                                <X size={16} />
                                            </button>
                                            <button
                                                className={`btn btn-icon ${decisions[finding.id] === 'mask' ? 'btn-warning' : ''}`}
                                                onClick={() => handleDecision(finding.id, 'mask')}
                                            >
                                                <EyeOff size={16} />
                                            </button>
                                            <button
                                                className="btn btn-icon"
                                                onClick={() => handleDecision(finding.id, 'keep')}
                                            >
                                                <Eye size={16} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {(!job.findings || job.findings.length === 0) && (
                                    <div className="empty-state">
                                        <Check size={32} />
                                        <p>Brak wykrytych danych wrażliwych</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Adnotacje tab */}
                        {activeTab === 'Adnotacje' && (
                            <div className="card">
                                <h3 className="mb-md">Moje uwagi</h3>
                                <textarea
                                    placeholder="Dodaj uwagi do dokumentu..."
                                    rows={6}
                                    style={{ width: '100%', resize: 'vertical' }}
                                />
                            </div>
                        )}

                        {/* Audit tab */}
                        {activeTab === 'Audit' && (
                            <div className="card">
                                <h3 className="mb-md">Historia zmian</h3>
                                <div className="text-muted text-sm">
                                    <p>Dokument: {job.original_filename}</p>
                                    <p>Tryb: {job.mode === 'unify' ? 'Unifikacja' : 'Redakcja'}</p>
                                    <p>Stron: {job.page_count}</p>
                                    <p>Utworzono: {new Date(job.created_at).toLocaleString('pl-PL')}</p>
                                    {job.completed_at && (
                                        <p>Zakończono: {new Date(job.completed_at).toLocaleString('pl-PL')}</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default ProcessingPage
