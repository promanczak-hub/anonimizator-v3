import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import {
    Download, FileText, Check, X, Eye, EyeOff,
    AlertTriangle, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Trash2
} from 'lucide-react'
import { jobs } from '../api/client'

// Tab components
const TABS = ['Fiszki', 'Wykrycia', 'Adnotacje', 'Audit']

// Risk level colors for highlights
const HIGHLIGHT_COLORS = {
    HIGH: 'rgba(239, 68, 68, 0.3)',
    MEDIUM: 'rgba(251, 191, 36, 0.3)',
    LOW: 'rgba(34, 197, 94, 0.3)',
    DEFAULT: 'rgba(139, 92, 246, 0.3)'
}

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

    // Hover state for highlighting
    const [hoveredItem, setHoveredItem] = useState(null)
    const [hoveredType, setHoveredType] = useState(null) // 'fiszka', 'finding', 'section'

    // Ref for PDF container
    const pdfContainerRef = useRef(null)

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

    // Handle hover on fiszka - highlight related findings on PDF
    const handleFiszkaHover = (fiszka) => {
        setHoveredItem(fiszka)
        setHoveredType('fiszka')

        // Find first page with this category
        const findings = job?.findings || []
        const categoryFinding = findings.find(f => f.category === fiszka.category)
        if (categoryFinding?.page) {
            setCurrentPage(categoryFinding.page - 1)
        }
    }

    // Handle hover on finding - show exact location
    const handleFindingHover = (finding) => {
        setHoveredItem(finding)
        setHoveredType('finding')
        if (finding.page) {
            setCurrentPage(finding.page - 1)
        }
    }

    // Handle hover on section
    const handleSectionHover = (section) => {
        setHoveredItem(section)
        setHoveredType('section')
        if (section.page_range?.[0]) {
            setCurrentPage(section.page_range[0] - 1)
        }
    }

    const handleMouseLeave = () => {
        setHoveredItem(null)
        setHoveredType(null)
    }

    // Get highlights for current page
    const getHighlightsForPage = (pageIndex) => {
        if (!hoveredItem) return []

        const highlights = []
        const pageNum = pageIndex + 1

        if (hoveredType === 'fiszka') {
            // Highlight all findings of this category on this page
            const findings = job?.findings || []
            findings
                .filter(f => f.category === hoveredItem.category && f.page === pageNum && f.bbox)
                .forEach(f => {
                    highlights.push({
                        bbox: f.bbox,
                        color: HIGHLIGHT_COLORS[hoveredItem.risk_level] || HIGHLIGHT_COLORS.DEFAULT,
                        label: f.label || f.value_preview
                    })
                })

            // Also highlight matching sections
            const sections = job?.sections || []
            sections
                .filter(s => s.category === hoveredItem.category &&
                    pageNum >= (s.page_range?.[0] || 0) && pageNum <= (s.page_range?.[1] || 0))
                .forEach(s => {
                    if (s.bbox) {
                        highlights.push({
                            bbox: s.bbox,
                            color: HIGHLIGHT_COLORS[hoveredItem.risk_level] || HIGHLIGHT_COLORS.DEFAULT,
                            label: s.title
                        })
                    } else {
                        // Full page highlight if no bbox
                        highlights.push({
                            fullPage: true,
                            color: HIGHLIGHT_COLORS[hoveredItem.risk_level] || HIGHLIGHT_COLORS.DEFAULT,
                            label: s.title,
                            category: s.category
                        })
                    }
                })
        } else if (hoveredType === 'finding' && hoveredItem.page === pageNum) {
            if (hoveredItem.bbox) {
                highlights.push({
                    bbox: hoveredItem.bbox,
                    color: HIGHLIGHT_COLORS.DEFAULT,
                    label: hoveredItem.label
                })
            }
        } else if (hoveredType === 'section') {
            const { page_range } = hoveredItem
            if (page_range && pageNum >= page_range[0] && pageNum <= page_range[1]) {
                if (hoveredItem.bbox) {
                    highlights.push({
                        bbox: hoveredItem.bbox,
                        color: HIGHLIGHT_COLORS.DEFAULT,
                        label: hoveredItem.title
                    })
                } else {
                    highlights.push({
                        fullPage: true,
                        color: HIGHLIGHT_COLORS.DEFAULT,
                        label: hoveredItem.title,
                        category: hoveredItem.category
                    })
                }
            }
        }

        return highlights
    }

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

        // Also mark sections
        const sections = job?.sections || []
        sections.filter(s => s.category === category).forEach(s => {
            newDecisions[s.id] = action
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

    // Count items per category
    const getCategoryCount = (category) => {
        const findingsCount = (job?.findings || []).filter(f => f.category === category).length
        const sectionsCount = (job?.sections || []).filter(s => s.category === category).length
        return findingsCount + sectionsCount
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
                        <div className="pdf-viewer" ref={pdfContainerRef}>
                            {job.thumbnails?.map((_, idx) => {
                                const highlights = getHighlightsForPage(idx)
                                const isVisible = currentPage === idx || job.page_count <= 3

                                return (
                                    <div
                                        key={idx}
                                        className="pdf-page"
                                        style={{
                                            width: `${zoom}%`,
                                            display: isVisible ? 'block' : 'none',
                                            position: 'relative'
                                        }}
                                    >
                                        <img
                                            src={jobs.getThumbnailUrl(jobId, idx)}
                                            alt={`Strona ${idx + 1}`}
                                            style={{ width: '100%', display: 'block' }}
                                        />

                                        {/* Highlight overlays */}
                                        {highlights.map((hl, hlIdx) => (
                                            <div
                                                key={hlIdx}
                                                className="pdf-highlight"
                                                style={{
                                                    position: 'absolute',
                                                    ...(hl.fullPage ? {
                                                        top: 0,
                                                        left: 0,
                                                        right: 0,
                                                        bottom: 0,
                                                    } : {
                                                        left: `${hl.bbox?.x || 0}%`,
                                                        top: `${hl.bbox?.y || 0}%`,
                                                        width: `${hl.bbox?.w || 100}%`,
                                                        height: `${hl.bbox?.h || 100}%`,
                                                    }),
                                                    backgroundColor: hl.color,
                                                    border: `2px solid ${hl.color.replace('0.3', '0.8')}`,
                                                    borderRadius: '4px',
                                                    pointerEvents: 'none',
                                                    transition: 'all 0.2s ease-in-out',
                                                    animation: 'pulse-highlight 1.5s infinite'
                                                }}
                                            >
                                                {hl.label && (
                                                    <div
                                                        className="pdf-highlight-label"
                                                        style={{
                                                            position: 'absolute',
                                                            top: '-28px',
                                                            left: '0',
                                                            backgroundColor: hl.color.replace('0.3', '0.9'),
                                                            color: 'white',
                                                            padding: '4px 8px',
                                                            borderRadius: '4px',
                                                            fontSize: '12px',
                                                            fontWeight: '500',
                                                            whiteSpace: 'nowrap',
                                                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                                                        }}
                                                    >
                                                        {hl.label}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )
                            })}
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
                                {job.fiszki?.map(fiszka => {
                                    const count = getCategoryCount(fiszka.category)
                                    const isHovered = hoveredItem?.id === fiszka.id
                                    const categoryDecision = decisions[fiszka.id]

                                    return (
                                        <div
                                            key={fiszka.id}
                                            className={`fiszka ${isHovered ? 'fiszka-hovered' : ''}`}
                                            onMouseEnter={() => handleFiszkaHover(fiszka)}
                                            onMouseLeave={handleMouseLeave}
                                            style={{
                                                transition: 'all 0.2s ease',
                                                cursor: 'pointer',
                                                ...(isHovered && {
                                                    transform: 'translateX(-4px)',
                                                    boxShadow: '0 0 0 2px var(--color-primary)'
                                                })
                                            }}
                                        >
                                            <div className={`fiszka-indicator ${fiszka.risk_level.toLowerCase()}`} />
                                            <div className="fiszka-content">
                                                <div className="fiszka-title">{fiszka.label}</div>
                                                <div className="fiszka-description">{fiszka.description}</div>
                                            </div>
                                            <div className="fiszka-count">{count}</div>
                                            <div className="fiszka-actions">
                                                <button
                                                    className={`btn btn-icon ${categoryDecision === 'remove' ? 'btn-danger' : ''}`}
                                                    title="Usuń całkowicie"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        handleCategoryAction(fiszka.category, 'remove')
                                                        handleDecision(fiszka.id, 'remove')
                                                    }}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                                <button
                                                    className={`btn btn-icon ${categoryDecision === 'mask' ? 'btn-warning' : ''}`}
                                                    title="Zamaskuj"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        handleCategoryAction(fiszka.category, 'mask')
                                                        handleDecision(fiszka.id, 'mask')
                                                    }}
                                                >
                                                    <EyeOff size={16} />
                                                </button>
                                                <button
                                                    className={`btn btn-icon ${categoryDecision === 'keep' ? 'btn-success' : ''}`}
                                                    title="Zachowaj"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        handleCategoryAction(fiszka.category, 'keep')
                                                        handleDecision(fiszka.id, 'keep')
                                                    }}
                                                >
                                                    <Eye size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    )
                                })}

                                {/* Sections list */}
                                {job.sections?.length > 0 && (
                                    <>
                                        <div className="text-sm text-muted mt-md mb-sm" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
                                            Wykryte sekcje ({job.sections.length})
                                        </div>
                                        {job.sections.map(section => {
                                            const isHovered = hoveredItem?.id === section.id
                                            const sectionDecision = decisions[section.id]

                                            return (
                                                <div
                                                    key={section.id}
                                                    className={`fiszka fiszka-section ${isHovered ? 'fiszka-hovered' : ''}`}
                                                    onMouseEnter={() => handleSectionHover(section)}
                                                    onMouseLeave={handleMouseLeave}
                                                    style={{
                                                        transition: 'all 0.2s ease',
                                                        cursor: 'pointer',
                                                        opacity: 0.9,
                                                        ...(isHovered && {
                                                            transform: 'translateX(-4px)',
                                                            boxShadow: '0 0 0 2px var(--color-primary)',
                                                            opacity: 1
                                                        })
                                                    }}
                                                >
                                                    <div className="fiszka-indicator" style={{ backgroundColor: 'var(--color-primary)' }} />
                                                    <div className="fiszka-content">
                                                        <div className="fiszka-title">{section.title}</div>
                                                        <div className="fiszka-description">
                                                            {section.category} • Strony {section.page_range?.[0]}-{section.page_range?.[1]}
                                                        </div>
                                                    </div>
                                                    <div className="fiszka-actions">
                                                        <button
                                                            className={`btn btn-icon ${sectionDecision === 'remove' ? 'btn-danger' : ''}`}
                                                            title="Usuń sekcję"
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                handleDecision(section.id, 'remove')
                                                            }}
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                        <button
                                                            className={`btn btn-icon ${sectionDecision === 'keep' ? 'btn-success' : ''}`}
                                                            title="Zachowaj"
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                handleDecision(section.id, 'keep')
                                                            }}
                                                        >
                                                            <Eye size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </>
                                )}
                            </div>
                        )}

                        {/* Wykrycia tab */}
                        {activeTab === 'Wykrycia' && (
                            <div className="flex flex-col gap-sm">
                                {job.findings?.map(finding => {
                                    const isHovered = hoveredItem?.id === finding.id

                                    return (
                                        <div
                                            key={finding.id}
                                            className={`fiszka ${isHovered ? 'fiszka-hovered' : ''}`}
                                            onMouseEnter={() => handleFindingHover(finding)}
                                            onMouseLeave={handleMouseLeave}
                                            style={{
                                                transition: 'all 0.2s ease',
                                                cursor: 'pointer',
                                                ...(isHovered && {
                                                    transform: 'translateX(-4px)',
                                                    boxShadow: '0 0 0 2px var(--color-primary)'
                                                })
                                            }}
                                        >
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
                                                    <Trash2 size={16} />
                                                </button>
                                                <button
                                                    className={`btn btn-icon ${decisions[finding.id] === 'mask' ? 'btn-warning' : ''}`}
                                                    onClick={() => handleDecision(finding.id, 'mask')}
                                                >
                                                    <EyeOff size={16} />
                                                </button>
                                                <button
                                                    className={`btn btn-icon ${decisions[finding.id] === 'keep' ? 'btn-success' : ''}`}
                                                    onClick={() => handleDecision(finding.id, 'keep')}
                                                >
                                                    <Eye size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    )
                                })}
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
                                    <p>Sekcji: {job.sections?.length || 0}</p>
                                    <p>Wykryć: {job.findings?.length || 0}</p>
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

            {/* CSS for highlight animation */}
            <style>{`
                @keyframes pulse-highlight {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.6; }
                }
                
                .fiszka-hovered {
                    background: var(--color-surface-hover) !important;
                }
                
                .btn-success {
                    background: var(--color-success) !important;
                    color: white !important;
                }
                
                .fiszka-section {
                    background: var(--color-surface);
                    border-left: 3px solid var(--color-primary);
                }
            `}</style>
        </div>
    )
}

export default ProcessingPage
