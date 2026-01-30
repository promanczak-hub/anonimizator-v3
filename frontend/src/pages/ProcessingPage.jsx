import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
    Download, FileText, Check, X, Eye, EyeOff,
    AlertTriangle, ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
    Trash2, Square, MousePointer, RotateCcw, Save
} from 'lucide-react'
import { jobs } from '../api/client'

const TABS = ['Zaznaczenia', 'Wykrycia', 'Adnotacje', 'Audit']

// Tool modes
const TOOLS = {
    SELECT: 'select',
    DRAW: 'draw'
}

function ProcessingPage() {
    const { jobId } = useParams()
    const [job, setJob] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [activeTab, setActiveTab] = useState('Zaznaczenia')
    const [currentPage, setCurrentPage] = useState(0)
    const [zoom, setZoom] = useState(100)
    const [rendering, setRendering] = useState(false)

    // Drawing state
    const [activeTool, setActiveTool] = useState(TOOLS.DRAW)
    const [isDrawing, setIsDrawing] = useState(false)
    const [startPoint, setStartPoint] = useState(null)
    const [currentRect, setCurrentRect] = useState(null)
    const [userRegions, setUserRegions] = useState({}) // { pageIndex: [{ x, y, w, h, id }] }
    const [selectedRegion, setSelectedRegion] = useState(null)

    // Refs
    const canvasRef = useRef(null)
    const containerRef = useRef(null)
    const imageRef = useRef(null)

    // Poll for job status
    useEffect(() => {
        const fetchJob = async () => {
            try {
                const data = await jobs.get(jobId)
                setJob(data)
                setLoading(false)

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

    // Get mouse position relative to image
    const getMousePos = useCallback((e) => {
        if (!imageRef.current) return null
        const rect = imageRef.current.getBoundingClientRect()
        const x = ((e.clientX - rect.left) / rect.width) * 100
        const y = ((e.clientY - rect.top) / rect.height) * 100
        return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) }
    }, [])

    // Start drawing
    const handleMouseDown = useCallback((e) => {
        if (activeTool !== TOOLS.DRAW) return
        const pos = getMousePos(e)
        if (!pos) return

        setIsDrawing(true)
        setStartPoint(pos)
        setCurrentRect({ x: pos.x, y: pos.y, w: 0, h: 0 })
    }, [activeTool, getMousePos])

    // Continue drawing
    const handleMouseMove = useCallback((e) => {
        if (!isDrawing || !startPoint) return
        const pos = getMousePos(e)
        if (!pos) return

        const x = Math.min(startPoint.x, pos.x)
        const y = Math.min(startPoint.y, pos.y)
        const w = Math.abs(pos.x - startPoint.x)
        const h = Math.abs(pos.y - startPoint.y)

        setCurrentRect({ x, y, w, h })
    }, [isDrawing, startPoint, getMousePos])

    // Finish drawing
    const handleMouseUp = useCallback(() => {
        if (!isDrawing || !currentRect) {
            setIsDrawing(false)
            return
        }

        // Only save if rectangle is big enough
        if (currentRect.w > 1 && currentRect.h > 1) {
            const newRegion = {
                ...currentRect,
                id: `region-${Date.now()}`,
                page: currentPage
            }

            setUserRegions(prev => ({
                ...prev,
                [currentPage]: [...(prev[currentPage] || []), newRegion]
            }))
        }

        setIsDrawing(false)
        setStartPoint(null)
        setCurrentRect(null)
    }, [isDrawing, currentRect, currentPage])

    // Delete region
    const deleteRegion = useCallback((pageIndex, regionId) => {
        setUserRegions(prev => ({
            ...prev,
            [pageIndex]: (prev[pageIndex] || []).filter(r => r.id !== regionId)
        }))
        setSelectedRegion(null)
    }, [])

    // Clear all regions on current page
    const clearCurrentPage = useCallback(() => {
        setUserRegions(prev => ({
            ...prev,
            [currentPage]: []
        }))
    }, [currentPage])

    // Count total regions
    const totalRegions = Object.values(userRegions).reduce((sum, arr) => sum + arr.length, 0)

    // Handle render with user regions
    const handleRender = async () => {
        setRendering(true)
        try {
            // Convert user regions to decisions
            const regionDecisions = []
            Object.entries(userRegions).forEach(([pageIdx, regions]) => {
                regions.forEach(region => {
                    regionDecisions.push({
                        item_id: region.id,
                        item_type: 'user_region',
                        action: 'remove',
                        page: parseInt(pageIdx),
                        bbox: { x: region.x, y: region.y, w: region.w, h: region.h }
                    })
                })
            })

            await jobs.submitDecisions(jobId, { decisions: regionDecisions })
            await jobs.render(jobId)

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
    const currentPageRegions = userRegions[currentPage] || []

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
                        </>
                    )}
                    {isReview && (
                        <button
                            className="btn btn-primary"
                            onClick={handleRender}
                            disabled={rendering || totalRegions === 0}
                        >
                            <Save size={18} />
                            {rendering ? 'Generowanie...' : `Generuj PDF (${totalRegions} zaznaczeń)`}
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
                    {/* PDF Viewer with Canvas Overlay */}
                    <div className="split-view-left">
                        {/* Drawing toolbar */}
                        <div className="drawing-toolbar">
                            <div className="toolbar-group">
                                <button
                                    className={`btn btn-icon ${activeTool === TOOLS.SELECT ? 'active' : ''}`}
                                    onClick={() => setActiveTool(TOOLS.SELECT)}
                                    title="Zaznacz (do edycji)"
                                >
                                    <MousePointer size={18} />
                                </button>
                                <button
                                    className={`btn btn-icon ${activeTool === TOOLS.DRAW ? 'active' : ''}`}
                                    onClick={() => setActiveTool(TOOLS.DRAW)}
                                    title="Rysuj prostokąt do usunięcia"
                                >
                                    <Square size={18} />
                                </button>
                            </div>
                            <div className="toolbar-divider" />
                            <button
                                className="btn btn-icon"
                                onClick={clearCurrentPage}
                                title="Wyczyść stronę"
                                disabled={currentPageRegions.length === 0}
                            >
                                <RotateCcw size={18} />
                            </button>
                            <span className="toolbar-info">
                                {currentPageRegions.length} zaznaczeń na stronie
                            </span>
                        </div>

                        <div className="pdf-viewer" ref={containerRef}>
                            {job.thumbnails?.map((_, idx) => {
                                const isVisible = currentPage === idx
                                const pageRegions = userRegions[idx] || []

                                return (
                                    <div
                                        key={idx}
                                        className="pdf-page-container"
                                        style={{
                                            width: `${zoom}%`,
                                            display: isVisible ? 'block' : 'none',
                                            position: 'relative',
                                            cursor: activeTool === TOOLS.DRAW ? 'crosshair' : 'default'
                                        }}
                                        onMouseDown={handleMouseDown}
                                        onMouseMove={handleMouseMove}
                                        onMouseUp={handleMouseUp}
                                        onMouseLeave={handleMouseUp}
                                    >
                                        <img
                                            ref={idx === currentPage ? imageRef : null}
                                            src={jobs.getThumbnailUrl(jobId, idx)}
                                            alt={`Strona ${idx + 1}`}
                                            style={{
                                                width: '100%',
                                                display: 'block',
                                                userSelect: 'none',
                                                pointerEvents: 'none'
                                            }}
                                            draggable={false}
                                        />

                                        {/* Saved regions */}
                                        {pageRegions.map((region) => (
                                            <div
                                                key={region.id}
                                                className={`user-region ${selectedRegion === region.id ? 'selected' : ''}`}
                                                style={{
                                                    position: 'absolute',
                                                    left: `${region.x}%`,
                                                    top: `${region.y}%`,
                                                    width: `${region.w}%`,
                                                    height: `${region.h}%`,
                                                }}
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    if (activeTool === TOOLS.SELECT) {
                                                        setSelectedRegion(region.id)
                                                    }
                                                }}
                                            >
                                                <button
                                                    className="region-delete-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        deleteRegion(idx, region.id)
                                                    }}
                                                    title="Usuń zaznaczenie"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ))}

                                        {/* Current drawing rectangle */}
                                        {isDrawing && currentRect && idx === currentPage && (
                                            <div
                                                className="drawing-rect"
                                                style={{
                                                    position: 'absolute',
                                                    left: `${currentRect.x}%`,
                                                    top: `${currentRect.y}%`,
                                                    width: `${currentRect.w}%`,
                                                    height: `${currentRect.h}%`,
                                                }}
                                            />
                                        )}
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

                        {/* Zaznaczenia tab */}
                        {activeTab === 'Zaznaczenia' && (
                            <div className="flex flex-col gap-sm">
                                <div className="card mb-md" style={{ background: 'var(--color-surface)' }}>
                                    <h4 style={{ marginBottom: '8px' }}>📌 Jak używać</h4>
                                    <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                                        <li>Wybierz narzędzie <strong>□ Prostokąt</strong></li>
                                        <li>Narysuj obszar do usunięcia na PDF</li>
                                        <li>Kliknij <strong>✕</strong> na zaznaczeniu aby usunąć</li>
                                        <li>Kliknij <strong>Generuj PDF</strong> gdy gotowe</li>
                                    </ol>
                                </div>

                                <h4>Twoje zaznaczenia ({totalRegions})</h4>

                                {Object.entries(userRegions).map(([pageIdx, regions]) => (
                                    regions.length > 0 && (
                                        <div key={pageIdx} className="region-group">
                                            <div className="region-group-header">
                                                Strona {parseInt(pageIdx) + 1}
                                                <span className="badge">{regions.length}</span>
                                            </div>
                                            {regions.map((region, idx) => (
                                                <div
                                                    key={region.id}
                                                    className={`region-item ${selectedRegion === region.id ? 'selected' : ''}`}
                                                    onClick={() => {
                                                        setCurrentPage(parseInt(pageIdx))
                                                        setSelectedRegion(region.id)
                                                    }}
                                                >
                                                    <span className="region-icon">
                                                        <Square size={14} />
                                                    </span>
                                                    <span className="region-label">
                                                        Obszar {idx + 1}
                                                    </span>
                                                    <span className="region-size">
                                                        {Math.round(region.w)}×{Math.round(region.h)}%
                                                    </span>
                                                    <button
                                                        className="btn btn-icon btn-sm"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            deleteRegion(parseInt(pageIdx), region.id)
                                                        }}
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )
                                ))}

                                {totalRegions === 0 && (
                                    <div className="empty-state" style={{ padding: '40px 20px' }}>
                                        <Square size={32} style={{ opacity: 0.5 }} />
                                        <p style={{ marginTop: '12px' }}>Brak zaznaczeń</p>
                                        <p className="text-muted text-sm">
                                            Narysuj prostokąty na PDF aby zaznaczyć<br />
                                            obszary do usunięcia
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Wykrycia tab - AI suggestions */}
                        {activeTab === 'Wykrycia' && (
                            <div className="flex flex-col gap-sm">
                                <p className="text-muted text-sm mb-md">
                                    AI wykryło następujące sekcje. Kliknij aby dodać do zaznaczeń.
                                </p>
                                {job.sections?.map(section => (
                                    <div
                                        key={section.id}
                                        className="fiszka"
                                        style={{ cursor: 'pointer' }}
                                        onClick={() => {
                                            // Add section as region (approximate)
                                            const pageIdx = (section.page_range?.[0] || 1) - 1
                                            const newRegion = {
                                                x: 5,
                                                y: 10,
                                                w: 90,
                                                h: 15,
                                                id: `ai-${section.id}-${Date.now()}`,
                                                page: pageIdx,
                                                label: section.title
                                            }
                                            setUserRegions(prev => ({
                                                ...prev,
                                                [pageIdx]: [...(prev[pageIdx] || []), newRegion]
                                            }))
                                            setCurrentPage(pageIdx)
                                        }}
                                    >
                                        <div className="fiszka-content">
                                            <div className="fiszka-title">{section.title}</div>
                                            <div className="fiszka-description">
                                                {section.category} • Strony {section.page_range?.[0]}-{section.page_range?.[1]}
                                            </div>
                                        </div>
                                        <button className="btn btn-icon btn-sm" title="Dodaj do zaznaczeń">
                                            <Square size={14} />
                                        </button>
                                    </div>
                                ))}
                                {(!job.sections || job.sections.length === 0) && (
                                    <div className="empty-state">
                                        <Check size={32} />
                                        <p>Brak wykrytych sekcji</p>
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
                                <h3 className="mb-md">Informacje o dokumencie</h3>
                                <div className="text-muted text-sm">
                                    <p>Dokument: {job.original_filename}</p>
                                    <p>Tryb: {job.mode === 'unify' ? 'Unifikacja' : 'Redakcja'}</p>
                                    <p>Stron: {job.page_count}</p>
                                    <p>Sekcji AI: {job.sections?.length || 0}</p>
                                    <p>Twoich zaznaczeń: {totalRegions}</p>
                                    <p>Utworzono: {new Date(job.created_at).toLocaleString('pl-PL')}</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Styles */}
            <style>{`
                .drawing-toolbar {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 12px;
                    background: var(--color-surface);
                    border-radius: 8px;
                    margin-bottom: 12px;
                }
                
                .toolbar-group {
                    display: flex;
                    gap: 4px;
                    background: var(--color-bg);
                    padding: 4px;
                    border-radius: 6px;
                }
                
                .toolbar-group .btn-icon.active {
                    background: var(--color-primary);
                    color: white;
                }
                
                .toolbar-divider {
                    width: 1px;
                    height: 24px;
                    background: var(--color-border);
                    margin: 0 4px;
                }
                
                .toolbar-info {
                    font-size: 13px;
                    color: var(--color-text-muted);
                    margin-left: auto;
                }
                
                .pdf-page-container {
                    border-radius: 8px;
                    overflow: hidden;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                }
                
                .user-region {
                    background: rgba(239, 68, 68, 0.25);
                    border: 2px solid rgba(239, 68, 68, 0.8);
                    border-radius: 4px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                }
                
                .user-region:hover {
                    background: rgba(239, 68, 68, 0.35);
                    border-color: #ef4444;
                }
                
                .user-region.selected {
                    border-color: #ef4444;
                    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.3);
                }
                
                .region-delete-btn {
                    position: absolute;
                    top: -10px;
                    right: -10px;
                    width: 22px;
                    height: 22px;
                    border-radius: 50%;
                    background: #ef4444;
                    color: white;
                    border: 2px solid white;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0;
                    transition: opacity 0.15s ease;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                }
                
                .user-region:hover .region-delete-btn,
                .user-region.selected .region-delete-btn {
                    opacity: 1;
                }
                
                .drawing-rect {
                    background: rgba(139, 92, 246, 0.3);
                    border: 2px dashed rgba(139, 92, 246, 0.8);
                    border-radius: 4px;
                    pointer-events: none;
                }
                
                .region-group {
                    background: var(--color-surface);
                    border-radius: 8px;
                    overflow: hidden;
                }
                
                .region-group-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 10px 12px;
                    background: var(--color-bg);
                    font-weight: 500;
                    font-size: 13px;
                }
                
                .region-item {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    border-top: 1px solid var(--color-border);
                    cursor: pointer;
                    transition: background 0.15s ease;
                }
                
                .region-item:hover {
                    background: var(--color-surface-hover);
                }
                
                .region-item.selected {
                    background: rgba(139, 92, 246, 0.1);
                    border-left: 3px solid var(--color-primary);
                }
                
                .region-icon {
                    color: #ef4444;
                    display: flex;
                }
                
                .region-label {
                    flex: 1;
                    font-size: 13px;
                }
                
                .region-size {
                    font-size: 11px;
                    color: var(--color-text-muted);
                    font-family: monospace;
                }
                
                .btn-sm {
                    padding: 4px;
                }
            `}</style>
        </div>
    )
}

export default ProcessingPage
