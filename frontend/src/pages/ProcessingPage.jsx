import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
    Download, FileText, Check,
    AlertTriangle, ZoomIn, ZoomOut,
    Trash2, Square, RotateCcw, Save,
    Type, Replace, Plus, X, Scissors
} from 'lucide-react'
import { jobs } from '../api/client'

function ProcessingPage() {
    const { jobId } = useParams()
    const [job, setJob] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [zoom, setZoom] = useState(100)
    const [rendering, setRendering] = useState(false)

    // Editing mode: 'rectangle', 'text', 'replace'
    const [editMode, setEditMode] = useState('rectangle')

    // Drawing state - now per page
    const [isDrawing, setIsDrawing] = useState(false)
    const [drawingPage, setDrawingPage] = useState(null)
    const [drawStart, setDrawStart] = useState(null)
    const [currentRect, setCurrentRect] = useState(null)
    const [regions, setRegions] = useState({}) // { pageIndex: [{ x, y, width, height, id }] }

    // Text replacement rules
    const [replacements, setReplacements] = useState([])
    const [newFind, setNewFind] = useState('')
    const [newReplace, setNewReplace] = useState('')
    const [newPage, setNewPage] = useState('all')

    // Pages to delete
    const [pagesToDelete, setPagesToDelete] = useState([])

    // Text blocks from backend (for text selection mode)
    const [textBlocks, setTextBlocks] = useState({})
    const [selectedTexts, setSelectedTexts] = useState({}) // { pageIndex: [{ text, bbox, id }] }

    // Refs for each page canvas
    const canvasRefs = useRef({})
    const imageRefs = useRef({})
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

    // Redraw all canvases when regions change
    useEffect(() => {
        if (job) {
            for (let i = 0; i < job.page_count; i++) {
                redrawCanvas(i)
            }
        }
    }, [regions, currentRect, drawingPage, job])

    const redrawCanvas = useCallback((pageIndex) => {
        const canvas = canvasRefs.current[pageIndex]
        if (!canvas) return

        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        // Draw existing regions for this page
        const pageRegions = regions[pageIndex] || []
        pageRegions.forEach(rect => {
            // WHITE FILL to cover content (this is what will be removed!)
            ctx.fillStyle = 'white'
            ctx.fillRect(rect.x, rect.y, rect.width, rect.height)

            // Red border around removal area
            ctx.strokeStyle = '#ef4444'
            ctx.lineWidth = 3
            ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)

            // Delete icon in corner (red circle with ×)
            ctx.fillStyle = '#ef4444'
            ctx.beginPath()
            ctx.arc(rect.x + rect.width - 14, rect.y + 14, 14, 0, 2 * Math.PI)
            ctx.fill()
            ctx.fillStyle = 'white'
            ctx.font = 'bold 18px sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText('×', rect.x + rect.width - 14, rect.y + 14)

            // USUŃ label at bottom
            ctx.fillStyle = '#ef4444'
            ctx.fillRect(rect.x, rect.y + rect.height - 22, 75, 22)
            ctx.fillStyle = 'white'
            ctx.font = 'bold 12px sans-serif'
            ctx.textAlign = 'left'
            ctx.fillText('USUŃ', rect.x + 10, rect.y + rect.height - 8)
        })

        // Draw current rectangle being drawn (on the active page)
        if (drawingPage === pageIndex && currentRect) {
            ctx.fillStyle = 'rgba(139, 92, 246, 0.3)'
            ctx.fillRect(currentRect.x, currentRect.y, currentRect.width, currentRect.height)
            ctx.strokeStyle = '#8b5cf6'
            ctx.lineWidth = 2
            ctx.setLineDash([5, 5])
            ctx.strokeRect(currentRect.x, currentRect.y, currentRect.width, currentRect.height)
            ctx.setLineDash([])
        }
    }, [regions, currentRect, drawingPage])

    const handleImageLoad = useCallback((pageIndex) => {
        const img = imageRefs.current[pageIndex]
        const canvas = canvasRefs.current[pageIndex]
        if (img && canvas) {
            canvas.width = img.clientWidth
            canvas.height = img.clientHeight
            redrawCanvas(pageIndex)
        }
    }, [redrawCanvas])

    const getMousePos = useCallback((e, pageIndex) => {
        const canvas = canvasRefs.current[pageIndex]
        if (!canvas) return { x: 0, y: 0 }

        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height

        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        }
    }, [])

    const handleMouseDown = useCallback((e, pageIndex) => {
        const pos = getMousePos(e, pageIndex)

        // Check if clicked on delete button (× in corner) or USUŃ label
        const pageRegions = regions[pageIndex] || []
        for (let i = pageRegions.length - 1; i >= 0; i--) {
            const rect = pageRegions[i]

            // Check × button (circle in top-right corner)
            const dx = pos.x - (rect.x + rect.width - 12)
            const dy = pos.y - (rect.y + 12)
            if (dx * dx + dy * dy < 144) { // 12px radius
                // Delete this region
                setRegions(prev => ({
                    ...prev,
                    [pageIndex]: prev[pageIndex].filter((_, idx) => idx !== i)
                }))
                return
            }

            // Check USUŃ label (bottom-left rectangle 70x20)
            if (pos.x >= rect.x && pos.x <= rect.x + 70 &&
                pos.y >= rect.y + rect.height - 20 && pos.y <= rect.y + rect.height) {
                // Delete this region
                setRegions(prev => ({
                    ...prev,
                    [pageIndex]: prev[pageIndex].filter((_, idx) => idx !== i)
                }))
                return
            }
        }

        // Start drawing
        setIsDrawing(true)
        setDrawingPage(pageIndex)
        setDrawStart(pos)
    }, [regions, getMousePos])

    const handleMouseMove = useCallback((e, pageIndex) => {
        if (!isDrawing || drawingPage !== pageIndex || !drawStart) return

        const pos = getMousePos(e, pageIndex)

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
    }, [isDrawing, drawingPage, drawStart, getMousePos])

    const handleMouseUp = useCallback((pageIndex) => {
        if (!isDrawing || drawingPage !== pageIndex || !currentRect) {
            setIsDrawing(false)
            setDrawStart(null)
            setCurrentRect(null)
            setDrawingPage(null)
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
                [pageIndex]: [...(prev[pageIndex] || []), newRegion]
            }))
        }

        setIsDrawing(false)
        setDrawStart(null)
        setCurrentRect(null)
        setDrawingPage(null)
    }, [isDrawing, drawingPage, currentRect])

    const clearAllRegions = () => {
        setRegions({})
        setSelectedTexts({})
        setReplacements([])
    }

    // Add a text replacement rule
    const addReplacement = () => {
        if (!newFind.trim()) return
        setReplacements(prev => [...prev, {
            id: `repl-${Date.now()}`,
            find: newFind,
            replace: newReplace,
            page: newPage === 'all' ? null : parseInt(newPage)
        }])
        setNewFind('')
        setNewReplace('')
        setNewPage('all')
    }

    // Remove a replacement rule
    const removeReplacement = (id) => {
        setReplacements(prev => prev.filter(r => r.id !== id))
    }

    // Apply text replacements
    const applyReplacements = async () => {
        if (replacements.length === 0) return
        setRendering(true)
        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/jobs/${jobId}/text-replace`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(replacements.map(r => ({
                    find: r.find,
                    replace: r.replace,
                    page: r.page
                })))
            })
            const result = await response.json()
            if (result.status === 'ok') {
                // Refresh job to get new thumbnails
                const data = await jobs.get(jobId)
                setJob(data)
                setReplacements([])
                alert(`Zastąpiono ${result.changes_count} wystąpień`)
            }
        } catch (err) {
            setError('Błąd zamiany tekstu')
        }
        setRendering(false)
    }

    // Toggle page for deletion
    const togglePageDelete = (pageIndex) => {
        setPagesToDelete(prev =>
            prev.includes(pageIndex)
                ? prev.filter(p => p !== pageIndex)
                : [...prev, pageIndex]
        )
    }

    // Apply page deletions
    const applyPageDeletions = async () => {
        if (pagesToDelete.length === 0) return
        if (!confirm(`Czy na pewno usunąć ${pagesToDelete.length} stron(y)?`)) return

        setRendering(true)
        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/jobs/${jobId}/delete-pages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pagesToDelete)
            })
            const result = await response.json()
            if (result.status === 'ok') {
                // Refresh job to get updated page count and thumbnails
                const data = await jobs.get(jobId)
                setJob(data)
                setPagesToDelete([])
                setRegions({}) // Clear regions as page indices changed
                alert(`Usunięto ${result.deleted_pages.length} stron(y). Nowa liczba stron: ${result.new_page_count}`)
            }
        } catch (err) {
            setError('Błąd usuwania stron')
        }
        setRendering(false)
    }

    // Count total regions
    const totalRegions = Object.values(regions).reduce((sum, arr) => sum + arr.length, 0)
    const totalSelectedTexts = Object.values(selectedTexts).reduce((sum, arr) => sum + arr.length, 0)

    // Handle render
    const handleRender = async () => {
        setRendering(true)
        try {
            const regionDecisions = []

            Object.entries(regions).forEach(([pageIdx, pageRegions]) => {
                const canvas = canvasRefs.current[parseInt(pageIdx)]
                if (!canvas) return

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
                    <span className="badge badge-info">
                        {job.page_count} stron
                    </span>
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
                            {rendering ? 'Generowanie...' : `Generuj PDF (${totalRegions} usunięć)`}
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
                    {/* PDF Continuous Scroll */}
                    <div className="split-view-left" ref={containerRef}>
                        {/* Toolbar with editing modes */}
                        <div className="drawing-toolbar">
                            {/* Mode selection */}
                            <div className="toolbar-group">
                                <button
                                    className={`btn btn-icon ${editMode === 'rectangle' ? 'active' : ''}`}
                                    onClick={() => setEditMode('rectangle')}
                                    title="Zaznacz obszar prostokątem"
                                >
                                    <Square size={18} />
                                </button>
                                <button
                                    className={`btn btn-icon ${editMode === 'text' ? 'active' : ''}`}
                                    onClick={() => setEditMode('text')}
                                    title="Zaznacz tekst (wkrótce)"
                                    disabled
                                >
                                    <Type size={18} />
                                </button>
                                <button
                                    className={`btn btn-icon ${editMode === 'replace' ? 'active' : ''}`}
                                    onClick={() => setEditMode('replace')}
                                    title="Zamień tekst"
                                >
                                    <Replace size={18} />
                                </button>
                            </div>
                            <div className="toolbar-divider" />

                            {/* Mode-specific info */}
                            {editMode === 'rectangle' && (
                                <>
                                    <span className="toolbar-info">
                                        🖱️ Narysuj prostokąt aby usunąć obszar
                                    </span>
                                    <span className="badge badge-danger ml-sm">
                                        {totalRegions} usunięć
                                    </span>
                                </>
                            )}
                            {editMode === 'replace' && (
                                <span className="toolbar-info">
                                    ✏️ Użyj panelu po prawej aby zamienić tekst
                                </span>
                            )}

                            <div className="toolbar-divider" />
                            <button
                                className="btn btn-icon"
                                onClick={clearAllRegions}
                                title="Wyczyść wszystkie"
                                disabled={totalRegions === 0 && replacements.length === 0}
                            >
                                <RotateCcw size={18} />
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

                        {/* All pages continuous scroll */}
                        <div className="pdf-scroll-container">
                            {Array.from({ length: job.page_count }).map((_, pageIndex) => (
                                <div key={pageIndex} className={`pdf-page-wrapper ${pagesToDelete.includes(pageIndex) ? 'marked-for-delete' : ''}`}>
                                    <div className="page-header">
                                        <span className="page-number-label">Strona {pageIndex + 1}</span>
                                        <button
                                            className={`btn btn-icon btn-sm ${pagesToDelete.includes(pageIndex) ? 'btn-danger-active' : ''}`}
                                            onClick={() => togglePageDelete(pageIndex)}
                                            title={pagesToDelete.includes(pageIndex) ? 'Cofnij usunięcie strony' : 'Usuń całą stronę'}
                                        >
                                            <Scissors size={16} />
                                        </button>
                                    </div>
                                    <div className="canvas-wrapper" style={{ position: 'relative', display: 'inline-block' }}>
                                        <img
                                            ref={el => imageRefs.current[pageIndex] = el}
                                            src={jobs.getThumbnailUrl(jobId, pageIndex)}
                                            alt={`Strona ${pageIndex + 1}`}
                                            onLoad={() => handleImageLoad(pageIndex)}
                                            style={{
                                                width: `${zoom}%`,
                                                display: 'block',
                                                borderRadius: '4px',
                                                boxShadow: pagesToDelete.includes(pageIndex) ? '0 0 0 3px #ef4444' : '0 4px 12px rgba(0,0,0,0.3)',
                                                userSelect: 'none',
                                                opacity: pagesToDelete.includes(pageIndex) ? 0.5 : 1
                                            }}
                                            draggable={false}
                                        />
                                        <canvas
                                            ref={el => canvasRefs.current[pageIndex] = el}
                                            onMouseDown={(e) => handleMouseDown(e, pageIndex)}
                                            onMouseMove={(e) => handleMouseMove(e, pageIndex)}
                                            onMouseUp={() => handleMouseUp(pageIndex)}
                                            onMouseLeave={() => handleMouseUp(pageIndex)}
                                            style={{
                                                position: 'absolute',
                                                top: 0,
                                                left: 0,
                                                width: '100%',
                                                height: '100%',
                                                cursor: 'crosshair',
                                                borderRadius: '4px'
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Right panel */}
                    <div className="split-view-right">
                        <div className="card mb-md">
                            <h4 style={{ marginBottom: '8px' }}>📌 Instrukcja</h4>
                            {editMode === 'rectangle' && (
                                <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                                    <li><strong>Przewiń</strong> aby zobaczyć wszystkie strony</li>
                                    <li><strong>Narysuj prostokąt</strong> na obszarze do usunięcia</li>
                                    <li>Kliknij <strong>×</strong> aby cofnąć zaznaczenie</li>
                                    <li>Kliknij <strong>Generuj PDF</strong></li>
                                </ol>
                            )}
                            {editMode === 'replace' && (
                                <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                                    <li>Wpisz tekst do <strong>znalezienia</strong></li>
                                    <li>Wpisz tekst <strong>zastępczy</strong></li>
                                    <li>Wybierz stronę lub wszystkie</li>
                                    <li>Kliknij <strong>+ Dodaj regułę</strong></li>
                                    <li>Kliknij <strong>Zastosuj zamiany</strong></li>
                                </ol>
                            )}
                        </div>

                        {/* Text Replacement Panel */}
                        {editMode === 'replace' && (
                            <div className="card mb-md">
                                <h4 className="mb-sm">🔄 Zamiana tekstu</h4>

                                <div className="form-group" style={{ marginBottom: '12px' }}>
                                    <label style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Znajdź:</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="np. 80.000"
                                        value={newFind}
                                        onChange={(e) => setNewFind(e.target.value)}
                                    />
                                </div>

                                <div className="form-group" style={{ marginBottom: '12px' }}>
                                    <label style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Zamień na:</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="np. 100.000"
                                        value={newReplace}
                                        onChange={(e) => setNewReplace(e.target.value)}
                                    />
                                </div>

                                <div className="form-group" style={{ marginBottom: '12px' }}>
                                    <label style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Strona:</label>
                                    <select
                                        className="input"
                                        value={newPage}
                                        onChange={(e) => setNewPage(e.target.value)}
                                    >
                                        <option value="all">Wszystkie strony</option>
                                        {Array.from({ length: job?.page_count || 0 }).map((_, i) => (
                                            <option key={i} value={i}>Strona {i + 1}</option>
                                        ))}
                                    </select>
                                </div>

                                <button
                                    className="btn btn-secondary w-full"
                                    onClick={addReplacement}
                                    disabled={!newFind.trim()}
                                >
                                    <Plus size={16} /> Dodaj regułę
                                </button>

                                {replacements.length > 0 && (
                                    <>
                                        <div style={{ marginTop: '16px', borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
                                            <h5 style={{ fontSize: '13px', marginBottom: '8px' }}>Reguły ({replacements.length}):</h5>
                                            {replacements.map(r => (
                                                <div key={r.id} className="region-item" style={{ background: 'var(--color-bg-tertiary)' }}>
                                                    <span style={{ flex: 1, fontSize: '12px' }}>
                                                        <span style={{ color: '#ef4444' }}>{r.find}</span>
                                                        {' → '}
                                                        <span style={{ color: '#22c55e' }}>{r.replace || '[usuń]'}</span>
                                                        {r.page !== null && <span style={{ color: 'var(--color-text-muted)' }}> (str. {r.page + 1})</span>}
                                                    </span>
                                                    <button
                                                        className="btn btn-icon btn-sm"
                                                        onClick={() => removeReplacement(r.id)}
                                                    >
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>

                                        <button
                                            className="btn btn-primary w-full mt-md"
                                            onClick={applyReplacements}
                                            disabled={rendering}
                                        >
                                            {rendering ? 'Przetwarzanie...' : `Zastosuj zamiany (${replacements.length})`}
                                        </button>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Regions list (only in rectangle mode) */}
                        {editMode === 'rectangle' && (
                            <div className="card">
                                <h4 className="mb-sm">🗑️ Obszary do usunięcia ({totalRegions})</h4>

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
                                                >
                                                    <span className="region-icon">
                                                        <Trash2 size={14} />
                                                    </span>
                                                    <span className="region-label">
                                                        Obszar {idx + 1}
                                                    </span>
                                                    <span className="region-size">
                                                        {Math.round(region.width)}×{Math.round(region.height)}
                                                    </span>
                                                    <button
                                                        className="btn btn-icon btn-sm"
                                                        onClick={() => {
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
                                    <div className="empty-state" style={{ padding: '30px 20px' }}>
                                        <Square size={28} style={{ opacity: 0.5 }} />
                                        <p style={{ marginTop: '8px', fontSize: '13px' }}>
                                            Narysuj prostokąty na PDF aby oznaczyć obszary do usunięcia
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Pages to delete panel */}
                        {pagesToDelete.length > 0 && (
                            <div className="card mt-md" style={{ borderColor: '#ef4444' }}>
                                <h4 className="mb-sm" style={{ color: '#ef4444' }}>
                                    ✂️ Strony do usunięcia ({pagesToDelete.length})
                                </h4>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                                    {pagesToDelete.sort((a, b) => a - b).map(pageNum => (
                                        <span
                                            key={pageNum}
                                            className="badge badge-danger"
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => togglePageDelete(pageNum)}
                                            title="Kliknij aby cofnąć"
                                        >
                                            Strona {pageNum + 1} ×
                                        </span>
                                    ))}
                                </div>
                                <button
                                    className="btn btn-danger w-full"
                                    onClick={applyPageDeletions}
                                    disabled={rendering}
                                >
                                    <Scissors size={16} />
                                    {rendering ? 'Usuwanie...' : `Usuń ${pagesToDelete.length} stron(y)`}
                                </button>
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
                    background: var(--color-bg-tertiary);
                    border-radius: 8px;
                    margin-bottom: 12px;
                    position: sticky;
                    top: 0;
                    z-index: 10;
                }
                
                .toolbar-group {
                    display: flex;
                    gap: 4px;
                    background: var(--color-bg-secondary);
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
                
                .pdf-scroll-container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 24px;
                    padding-bottom: 24px;
                }
                
                .pdf-page-wrapper {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }
                
                .pdf-page-wrapper.marked-for-delete {
                    opacity: 0.7;
                }
                
                .page-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 8px;
                }
                
                .page-number-label {
                    font-size: 12px;
                    color: var(--color-text-muted);
                }
                
                .btn-danger-active {
                    background: #ef4444 !important;
                    color: white !important;
                }
                
                .btn-danger-active:hover {
                    background: #dc2626 !important;
                }
                
                .page-number {
                    font-size: 12px;
                    color: var(--color-text-muted);
                    margin-bottom: 8px;
                    background: var(--color-bg-tertiary);
                    padding: 4px 12px;
                    border-radius: 4px;
                }
                
                .canvas-wrapper {
                    user-select: none;
                }
                
                .region-group {
                    background: var(--color-bg-tertiary);
                    border-radius: 8px;
                    overflow: hidden;
                    margin-bottom: 8px;
                }
                
                .region-group-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 10px 12px;
                    background: rgba(239, 68, 68, 0.1);
                    font-weight: 500;
                    font-size: 13px;
                    color: #ef4444;
                }
                
                .region-item {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    border-top: 1px solid var(--color-border);
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
