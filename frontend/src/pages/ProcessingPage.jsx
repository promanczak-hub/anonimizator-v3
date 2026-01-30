import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Stage, Layer, Rect, Transformer } from 'react-konva'
import {
    Download, FileText, Check,
    AlertTriangle, ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
    Trash2, Square, MousePointer, RotateCcw, Save
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
    const [newRect, setNewRect] = useState(null)
    const [regions, setRegions] = useState({}) // { pageIndex: [{ x, y, width, height, id }] }
    const [selectedId, setSelectedId] = useState(null)
    const [stageSize, setStageSize] = useState({ width: 800, height: 1100 })
    const [imageLoaded, setImageLoaded] = useState(false)

    // Refs
    const containerRef = useRef(null)
    const imageRef = useRef(null)
    const transformerRef = useRef(null)

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

    // Update stage size when image loads
    useEffect(() => {
        if (imageRef.current && imageLoaded) {
            const img = imageRef.current
            const containerWidth = containerRef.current?.clientWidth || 800
            const scale = (containerWidth * zoom / 100) / img.naturalWidth
            setStageSize({
                width: img.naturalWidth * scale,
                height: img.naturalHeight * scale
            })
        }
    }, [imageLoaded, zoom, currentPage])

    // Update transformer when selection changes
    useEffect(() => {
        if (transformerRef.current) {
            const stage = transformerRef.current.getStage()
            const selectedNode = stage?.findOne('#' + selectedId)
            if (selectedNode) {
                transformerRef.current.nodes([selectedNode])
            } else {
                transformerRef.current.nodes([])
            }
            transformerRef.current.getLayer()?.batchDraw()
        }
    }, [selectedId])

    const handleMouseDown = (e) => {
        // Deselect if clicking on empty area
        if (e.target === e.target.getStage()) {
            setSelectedId(null)
        }

        // Start drawing if not clicking on a shape
        if (e.target === e.target.getStage()) {
            setIsDrawing(true)
            const pos = e.target.getStage().getPointerPosition()
            setNewRect({
                x: pos.x,
                y: pos.y,
                width: 0,
                height: 0,
                id: `rect-${Date.now()}`
            })
        }
    }

    const handleMouseMove = (e) => {
        if (!isDrawing || !newRect) return

        const stage = e.target.getStage()
        const pos = stage.getPointerPosition()

        setNewRect({
            ...newRect,
            width: pos.x - newRect.x,
            height: pos.y - newRect.y
        })
    }

    const handleMouseUp = () => {
        if (!isDrawing || !newRect) {
            setIsDrawing(false)
            return
        }

        // Normalize rectangle (handle negative dimensions)
        let { x, y, width, height, id } = newRect
        if (width < 0) {
            x = x + width
            width = Math.abs(width)
        }
        if (height < 0) {
            y = y + height
            height = Math.abs(height)
        }

        // Only save if big enough (at least 10x10 pixels)
        if (width > 10 && height > 10) {
            const normalized = { x, y, width, height, id }
            setRegions(prev => ({
                ...prev,
                [currentPage]: [...(prev[currentPage] || []), normalized]
            }))
        }

        setIsDrawing(false)
        setNewRect(null)
    }

    const deleteRegion = (pageIndex, regionId) => {
        setRegions(prev => ({
            ...prev,
            [pageIndex]: (prev[pageIndex] || []).filter(r => r.id !== regionId)
        }))
        setSelectedId(null)
    }

    const clearCurrentPage = () => {
        setRegions(prev => ({
            ...prev,
            [currentPage]: []
        }))
        setSelectedId(null)
    }

    const handleTransformEnd = (e, regionId) => {
        const node = e.target
        const scaleX = node.scaleX()
        const scaleY = node.scaleY()

        // Reset scale and update dimensions
        node.scaleX(1)
        node.scaleY(1)

        setRegions(prev => ({
            ...prev,
            [currentPage]: prev[currentPage].map(r =>
                r.id === regionId ? {
                    ...r,
                    x: node.x(),
                    y: node.y(),
                    width: Math.max(10, node.width() * scaleX),
                    height: Math.max(10, node.height() * scaleY)
                } : r
            )
        }))
    }

    const handleDragEnd = (e, regionId) => {
        setRegions(prev => ({
            ...prev,
            [currentPage]: prev[currentPage].map(r =>
                r.id === regionId ? { ...r, x: e.target.x(), y: e.target.y() } : r
            )
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
            Object.entries(regions).forEach(([pageIdx, pageRegions]) => {
                pageRegions.forEach(region => {
                    regionDecisions.push({
                        item_id: region.id,
                        item_type: 'user_region',
                        action: 'remove',
                        page: parseInt(pageIdx),
                        bbox: {
                            x: (region.x / stageSize.width) * 100,
                            y: (region.y / stageSize.height) * 100,
                            w: (region.width / stageSize.width) * 100,
                            h: (region.height / stageSize.height) * 100
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
                            {selectedId && (
                                <button
                                    className="btn btn-icon btn-danger"
                                    onClick={() => deleteRegion(currentPage, selectedId)}
                                    title="Usuń zaznaczony"
                                >
                                    <Trash2 size={18} />
                                </button>
                            )}
                            <span className="toolbar-info">
                                {currentPageRegions.length} zaznaczeń na stronie {currentPage + 1}
                            </span>
                        </div>

                        {/* Canvas container */}
                        <div className="canvas-container" style={{ position: 'relative' }}>
                            {/* Background image */}
                            <img
                                ref={imageRef}
                                src={jobs.getThumbnailUrl(jobId, currentPage)}
                                alt={`Strona ${currentPage + 1}`}
                                onLoad={() => setImageLoaded(true)}
                                style={{
                                    width: `${zoom}%`,
                                    display: 'block',
                                    borderRadius: '8px',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                                }}
                            />

                            {/* Konva Stage overlay */}
                            {imageLoaded && (
                                <Stage
                                    width={stageSize.width}
                                    height={stageSize.height}
                                    onMouseDown={handleMouseDown}
                                    onMouseMove={handleMouseMove}
                                    onMouseUp={handleMouseUp}
                                    onTouchStart={handleMouseDown}
                                    onTouchMove={handleMouseMove}
                                    onTouchEnd={handleMouseUp}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        cursor: 'crosshair'
                                    }}
                                >
                                    <Layer>
                                        {/* Existing rectangles */}
                                        {currentPageRegions.map((rect) => (
                                            <Rect
                                                key={rect.id}
                                                id={rect.id}
                                                x={rect.x}
                                                y={rect.y}
                                                width={rect.width}
                                                height={rect.height}
                                                fill="rgba(239, 68, 68, 0.3)"
                                                stroke="#ef4444"
                                                strokeWidth={2}
                                                draggable
                                                onClick={() => setSelectedId(rect.id)}
                                                onTap={() => setSelectedId(rect.id)}
                                                onDragEnd={(e) => handleDragEnd(e, rect.id)}
                                                onTransformEnd={(e) => handleTransformEnd(e, rect.id)}
                                            />
                                        ))}

                                        {/* Currently drawing rectangle */}
                                        {isDrawing && newRect && (
                                            <Rect
                                                x={newRect.x}
                                                y={newRect.y}
                                                width={newRect.width}
                                                height={newRect.height}
                                                fill="rgba(139, 92, 246, 0.3)"
                                                stroke="#8b5cf6"
                                                strokeWidth={2}
                                                dash={[5, 5]}
                                            />
                                        )}

                                        {/* Transformer for selected rectangle */}
                                        <Transformer
                                            ref={transformerRef}
                                            boundBoxFunc={(oldBox, newBox) => {
                                                // Limit minimum size
                                                if (newBox.width < 10 || newBox.height < 10) {
                                                    return oldBox
                                                }
                                                return newBox
                                            }}
                                        />
                                    </Layer>
                                </Stage>
                            )}
                        </div>

                        {/* Page controls */}
                        <div className="pdf-controls">
                            <button
                                className="btn btn-icon"
                                onClick={() => { setCurrentPage(p => Math.max(0, p - 1)); setSelectedId(null); setImageLoaded(false); }}
                                disabled={currentPage === 0}
                            >
                                <ChevronLeft size={20} />
                            </button>
                            <span className="text-sm">
                                {currentPage + 1} / {job.page_count}
                            </span>
                            <button
                                className="btn btn-icon"
                                onClick={() => { setCurrentPage(p => Math.min(job.page_count - 1, p + 1)); setSelectedId(null); setImageLoaded(false); }}
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
                                <li><strong>Kliknij i przeciągnij</strong> aby narysować prostokąt</li>
                                <li><strong>Kliknij prostokąt</strong> aby go zaznaczyć i przeskalować</li>
                                <li><strong>Przeciągnij prostokąt</strong> aby go przesunąć</li>
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
                                            className={`region-item ${selectedId === region.id ? 'selected' : ''}`}
                                            onClick={() => {
                                                setCurrentPage(parseInt(pageIdx))
                                                setSelectedId(region.id)
                                                setImageLoaded(false)
                                            }}
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
                
                .canvas-container {
                    display: inline-block;
                }
                
                .btn-danger {
                    background: #ef4444 !important;
                    color: white !important;
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
