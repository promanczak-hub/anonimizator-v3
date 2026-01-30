import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
    Download, FileText, Check,
    AlertTriangle, ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
    Trash2, Square, RotateCcw, Save
} from 'lucide-react'
import { jobs } from '../api/client'

function ProcessingPage() {
    const { jobId } = useParams()
    const [job, setJob] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [currentPage, setCurrentPage] = useState(0)
    const [zoom, setZoom] = useState(100)
    const [rendering, setRendering] = useState(false)

    // Drawing state
    const [isDrawing, setIsDrawing] = useState(false)
    const [drawStart, setDrawStart] = useState(null)
    const [currentRect, setCurrentRect] = useState(null)
    const [regions, setRegions] = useState({}) // { pageIndex: [{ x, y, width, height, id }] }

    // Refs
    const canvasRef = useRef(null)
    const imageRef = useRef(null)
    const containerRef = useRef(null)

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

    // Redraw canvas when regions change or page changes
    useEffect(() => {
        redrawCanvas()
    }, [regions, currentPage, currentRect])

    // Update canvas size when image loads
    const handleImageLoad = useCallback(() => {
        if (imageRef.current && canvasRef.current) {
            const img = imageRef.current
            canvasRef.current.width = img.clientWidth
            canvasRef.current.height = img.clientHeight
            redrawCanvas()
        }
    }, [])

    const redrawCanvas = useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        // Draw existing regions for current page
        const pageRegions = regions[currentPage] || []
        pageRegions.forEach(rect => {
            // Fill
            ctx.fillStyle = 'rgba(239, 68, 68, 0.3)'
            ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
            // Border
            ctx.strokeStyle = '#ef4444'
            ctx.lineWidth = 2
            ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
            // Delete button
            ctx.fillStyle = '#ef4444'
            ctx.beginPath()
            ctx.arc(rect.x + rect.width - 10, rect.y + 10, 10, 0, 2 * Math.PI)
            ctx.fill()
            ctx.fillStyle = 'white'
            ctx.font = 'bold 14px sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText('×', rect.x + rect.width - 10, rect.y + 10)
        })

        // Draw current rectangle being drawn
        if (currentRect) {
            ctx.fillStyle = 'rgba(139, 92, 246, 0.3)'
            ctx.fillRect(currentRect.x, currentRect.y, currentRect.width, currentRect.height)
            ctx.strokeStyle = '#8b5cf6'
            ctx.lineWidth = 2
            ctx.setLineDash([5, 5])
            ctx.strokeRect(currentRect.x, currentRect.y, currentRect.width, currentRect.height)
            ctx.setLineDash([])
        }
    }, [regions, currentPage, currentRect])

    const getMousePos = useCallback((e) => {
        const canvas = canvasRef.current
        if (!canvas) return { x: 0, y: 0 }

        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height

        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        }
    }, [])

    const handleMouseDown = useCallback((e) => {
        const canvas = canvasRef.current
        if (!canvas) return

        const pos = getMousePos(e)

        // Check if clicked on delete button
        const pageRegions = regions[currentPage] || []
        for (let i = pageRegions.length - 1; i >= 0; i--) {
            const rect = pageRegions[i]
            const dx = pos.x - (rect.x + rect.width - 10)
            const dy = pos.y - (rect.y + 10)
            if (dx * dx + dy * dy < 100) { // 10px radius
                // Delete this region
                setRegions(prev => ({
                    ...prev,
                    [currentPage]: prev[currentPage].filter((_, idx) => idx !== i)
                }))
                return
            }
        }

        // Start drawing
        setIsDrawing(true)
        setDrawStart(pos)
    }, [currentPage, regions, getMousePos])

    const handleMouseMove = useCallback((e) => {
        if (!isDrawing || !drawStart) return

        const pos = getMousePos(e)

        let x = drawStart.x
        let y = drawStart.y
        let width = pos.x - drawStart.x
        let height = pos.y - drawStart.y

        // Handle negative dimensions
        if (width < 0) {
            x = pos.x
            width = Math.abs(width)
        }
        if (height < 0) {
            y = pos.y
            height = Math.abs(height)
        }

        setCurrentRect({ x, y, width, height })
    }, [isDrawing, drawStart, getMousePos])

    const handleMouseUp = useCallback(() => {
        if (!isDrawing || !currentRect) {
            setIsDrawing(false)
            setDrawStart(null)
            setCurrentRect(null)
            return
        }

        // Only save if big enough (at least 10x10 pixels)
        if (currentRect.width > 10 && currentRect.height > 10) {
            const newRegion = {
                ...currentRect,
                id: `rect-${Date.now()}`
            }
            setRegions(prev => ({
                ...prev,
                [currentPage]: [...(prev[currentPage] || []), newRegion]
            }))
        }

        setIsDrawing(false)
        setDrawStart(null)
        setCurrentRect(null)
    }, [isDrawing, currentRect, currentPage])

    const clearCurrentPage = () => {
        setRegions(prev => ({
            ...prev,
            [currentPage]: []
        }))
    }

    // Count total regions
    const totalRegions = Object.values(regions).reduce((sum, arr) => sum + arr.length, 0)
    const currentPageRegions = regions[currentPage] || []

    // Handle render
    const handleRender = async () => {
        setRendering(true)
        try {
            // Convert pixel positions to percentages
            const regionDecisions = []
            const canvas = canvasRef.current

            Object.entries(regions).forEach(([pageIdx, pageRegions]) => {
                pageRegions.forEach(region => {
                    regionDecisions.push({
                        item_id: region.id,
                        item_type: 'user_region',
                        action: 'remove',
                        page: parseInt(pageIdx),
                        bbox: {
                            x: (region.x / canvas.width) * 100,
                            y: (region.y / canvas.height) * 100,
                            w: (region.width / canvas.width) * 100,
                            h: (region.height / canvas.height) * 100
                        }
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

    return (
        <div>
            {/* Top bar */}
            <div className="flex items-center justify-between mb-md">
                <div className="flex items-center gap-md">
                    <h2 style={{ fontSize: '18px' }}>{job.original_filename}</h2>
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
                        <a
                            href={jobs.getDownloadUrl(jobId, 'pdf')}
                            className="btn btn-primary"
                            download
                        >
                            <Download size={18} />
                            Pobierz PDF
                        </a>
                    )}
                    {isReview && (
                        <button
                            className="btn btn-primary"
                            onClick={handleRender}
                            disabled={rendering || totalRegions === 0}
                        >
                            <Save size={18} />
                            {rendering ? 'Generowanie...' : `Generuj PDF (${totalRegions})`}
                        </button>
                    )}
                </div>
            </div>

            {/* Progress bar */}
            {isProcessing && (
                <div className="card mb-md">
                    <div className="flex items-center justify-between mb-md">
                        <span>Postęp przetwarzania</span>
                        <span className="font-semibold">{job.progress}%</span>
                    </div>
                    <div className="progress-bar">
                        <div className="progress-bar-fill" style={{ width: `${job.progress}%` }} />
                    </div>
                </div>
            )}

            {/* Main editor */}
            {(isReview || isDone) && (
                <div className="split-view">
                    {/* PDF Canvas */}
                    <div className="split-view-left" ref={containerRef}>
                        {/* Toolbar */}
                        <div className="drawing-toolbar">
                            <div className="toolbar-group">
                                <button className="btn btn-icon active" title="Rysuj prostokąt">
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
                                {currentPageRegions.length} zaznaczeń na stronie {currentPage + 1}
                            </span>
                        </div>

                        {/* Canvas container */}
                        <div className="canvas-wrapper" style={{ position: 'relative', display: 'inline-block' }}>
                            {/* Background image */}
                            <img
                                ref={imageRef}
                                src={jobs.getThumbnailUrl(jobId, currentPage)}
                                alt={`Strona ${currentPage + 1}`}
                                onLoad={handleImageLoad}
                                style={{
                                    width: `${zoom}%`,
                                    display: 'block',
                                    borderRadius: '8px',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                    userSelect: 'none'
                                }}
                                draggable={false}
                            />

                            {/* Drawing canvas overlay */}
                            <canvas
                                ref={canvasRef}
                                onMouseDown={handleMouseDown}
                                onMouseMove={handleMouseMove}
                                onMouseUp={handleMouseUp}
                                onMouseLeave={handleMouseUp}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: '100%',
                                    cursor: 'crosshair',
                                    borderRadius: '8px'
                                }}
                            />
                        </div>

                        {/* Page controls */}
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
                            <div className="toolbar-divider" />
                            <button className="btn btn-icon" onClick={() => setZoom(z => Math.max(50, z - 25))}>
                                <ZoomOut size={18} />
                            </button>
                            <span className="text-sm">{zoom}%</span>
                            <button className="btn btn-icon" onClick={() => setZoom(z => Math.min(150, z + 25))}>
                                <ZoomIn size={18} />
                            </button>
                        </div>
                    </div>

                    {/* Right panel - Regions list */}
                    <div className="split-view-right">
                        <div className="card mb-md">
                            <h4 style={{ marginBottom: '8px' }}>📌 Instrukcja</h4>
                            <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                                <li><strong>Kliknij i przeciągnij</strong> na PDF</li>
                                <li>Kliknij <strong>×</strong> na prostokącie aby usunąć</li>
                                <li>Kliknij <strong>Generuj PDF</strong> gdy gotowe</li>
                            </ol>
                        </div>

                        <h4 className="mb-sm">Obszary do usunięcia ({totalRegions})</h4>

                        {Object.entries(regions).map(([pageIdx, pageRegions]) => (
                            pageRegions.length > 0 && (
                                <div key={pageIdx} className="region-group">
                                    <div className="region-group-header">
                                        Strona {parseInt(pageIdx) + 1}
                                        <span className="badge">{pageRegions.length}</span>
                                    </div>
                                    {pageRegions.map((region, idx) => (
                                        <div
                                            key={region.id}
                                            className="region-item"
                                            onClick={() => setCurrentPage(parseInt(pageIdx))}
                                        >
                                            <span className="region-icon">
                                                <Square size={14} />
                                            </span>
                                            <span className="region-label">
                                                Obszar {idx + 1}
                                            </span>
                                            <span className="region-size">
                                                {Math.round(region.width)}×{Math.round(region.height)}px
                                            </span>
                                            <button
                                                className="btn btn-icon btn-sm"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    setRegions(prev => ({
                                                        ...prev,
                                                        [pageIdx]: prev[pageIdx].filter((_, i) => i !== idx)
                                                    }))
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
                                    Narysuj prostokąty na PDF
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}

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
                
                .canvas-wrapper {
                    user-select: none;
                }
                
                .region-group {
                    background: var(--color-surface);
                    border-radius: 8px;
                    overflow: hidden;
                    margin-bottom: 8px;
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
