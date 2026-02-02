import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
    Download,
    AlertTriangle, ZoomIn, ZoomOut,
    Trash2, Square, RotateCcw, Save,
    Type, Replace, Plus, X, Scissors, Hand
} from 'lucide-react'
import { jobs } from '../api/client'
import PDFHighlighterEditor from '../components/PDFHighlighterEditor'

function ProcessingPage() {
    const { jobId } = useParams()
    const API_URL = import.meta.env.VITE_API_URL || ''
    const [job, setJob] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [zoom, setZoom] = useState('fit') // 'fit' = fit to width, or number for %
    const [rendering, setRendering] = useState(false)

    // Editing mode: 'rectangle', 'text', 'replace', 'pan'
    const [editMode, setEditMode] = useState('pan')

    // Regions for redaction per page
    const [regions, setRegions] = useState({}) // { pageIndex: [{ x, y, width, height, id }] }

    // Text replacement rules
    const [replacements, setReplacements] = useState([])
    const [newFind, setNewFind] = useState('')
    const [newReplace, setNewReplace] = useState('')
    const [newPage, setNewPage] = useState('all')

    // Pages to delete
    const [pagesToDelete, setPagesToDelete] = useState([])
    // Image/Text blocks marked for deletion
    const [blocksToDelete, setBlocksToDelete] = useState([])

    // Refs for each page canvas
    const fabricRefs = useRef({})
    const containerRef = useRef(null)
    const refreshTimeoutRef = useRef(null)

    // Text blocks for Word-like editing
    const [textBlocks, setTextBlocks] = useState({}) // { pageIndex: [{ text, bbox, font_size }] }
    const [editingBlock, setEditingBlock] = useState(null) // { pageIndex, blockIndex, text }
    const [textEdits, setTextEdits] = useState({}) // { pageIndex_blockIndex: newText }

    // Poll for job status
    useEffect(() => {
        let isMounted = true
        const fetchJob = async () => {
            try {
                const data = await jobs.get(jobId)
                if (!isMounted) return
                setJob(data)
                setLoading(false)

                if (['queued', 'processing', 'analyzing'].includes(data.status)) {
                    refreshTimeoutRef.current = setTimeout(fetchJob, 2000)
                }
            } catch (err) {
                if (!isMounted) return
                setError(err.response?.data?.detail || 'Błąd ładowania')
                setLoading(false)
            }
        }
        fetchJob()
        return () => {
            isMounted = false
            if (refreshTimeoutRef.current) {
                clearTimeout(refreshTimeoutRef.current)
            }
        }
    }, [jobId])



    // Wheel zoom handler for PDF container
    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const handleWheel = (e) => {
            // Zoom on Ctrl+scroll (standard) OR pinch gesture (ctrlKey is auto-set)
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault()
                e.stopPropagation()

                // Zoom in/out based on scroll direction
                const delta = e.deltaY > 0 ? -10 : 10
                setZoom(z => {
                    const current = z === 'fit' ? 100 : z
                    return Math.min(200, Math.max(25, current + delta))
                })
            }
        }

        container.addEventListener('wheel', handleWheel, { passive: false })
        return () => container.removeEventListener('wheel', handleWheel)
    }, [job]) // Re-attach when job loads and container is rendered

    // Load text blocks when text editing mode is active
    useEffect(() => {
        if (editMode === 'text' && job && Object.keys(textBlocks).length === 0) {
            const loadTextBlocks = async () => {
                try {
                    const response = await fetch(`${API_URL}/api/jobs/${job.id}/text-blocks`)
                    if (response.ok) {
                        const data = await response.json()
                        const blocksMap = {}
                        data.pages.forEach(page => {
                            blocksMap[page.page] = page.blocks
                        })
                        setTextBlocks(blocksMap)
                        console.log('✅ Text blocks loaded:', Object.keys(blocksMap).length, 'pages')
                    }
                } catch (err) {
                    console.error('Failed to load text blocks:', err)
                }
            }
            loadTextBlocks()
        }
    }, [editMode, job, textBlocks])

    // Canvas redraw handled by FabricPDFEditor

    // All canvas mouse handlers removed - now handled by FabricPDFEditor

    const clearAllRegions = () => {
        setRegions({})
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

        setRendering(true)
        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/jobs/${jobId}/delete-pages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pages: pagesToDelete })
            })
            const result = await response.json()
            if (result.status === 'ok') {
                // Force reload the page to get fresh thumbnails (cache-busting)
                window.location.reload()
            } else {
                setError('Błąd usuwania stron: ' + (result.detail || 'Nieznany błąd'))
            }
        } catch (err) {
            setError('Błąd usuwania stron')
        }
    }

    // Remove duplicate declarations


    // Toggle block for deletion
    const toggleBlockDelete = (pageIndex, blockIndex, bbox) => {
        const blockId = `${pageIndex}_${blockIndex}`
        setBlocksToDelete(prev => {
            const exists = prev.find(b => b.id === blockId)
            if (exists) {
                return prev.filter(b => b.id !== blockId)
            }
            return [...prev, {
                id: blockId,
                page: pageIndex,
                bbox: bbox // Normalized bbox from the block data
            }]
        })
    }

    // Apply block deletions
    const applyBlockDeletions = async () => {
        console.log('🔴 applyBlockDeletions called, blocksToDelete:', blocksToDelete)
        if (blocksToDelete.length === 0) {
            console.log('❌ No blocks to delete')
            return
        }

        setRendering(true)
        try {
            const payload = blocksToDelete.map(b => ({
                page: b.page,
                bbox: b.bbox
            }))
            console.log('📤 Sending to API:', payload)

            const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/jobs/${jobId}/delete-blocks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            console.log('📥 Response status:', response.status)

            const result = await response.json()
            console.log('📥 Response body:', result)

            if (result.status === 'ok') {
                // Refresh job and clear selection
                const data = await jobs.get(jobId)
                setJob(data)
                setBlocksToDelete([])
                setTextBlocks({}) // Clear text blocks to force re-fetch
                alert(`Usunięto ${result.deleted_count} elementów`)
            } else {
                console.error('❌ API error:', result)
                setError(result.detail || 'Błąd usuwania')
            }
        } catch (err) {
            console.error('❌ Fetch error:', err)
            setError('Błąd usuwania elementów: ' + err.message)
        }
        setRendering(false)
    }

    // Count total regions
    const totalRegions = Object.values(regions).reduce((sum, arr) => sum + arr.length, 0)

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

                    {/* Jim Carrey Typing Animation */}
                    <div className="flex justify-center mb-md" style={{
                        width: '100%',
                        overflow: 'hidden',
                        position: 'relative',
                        height: '140px'
                    }}>
                        <img
                            src="https://media.tenor.com/_q1nB7l9dE0AAAAM/jim-carrey-typing.gif"
                            alt="Processing..."
                            style={{
                                height: '100%',
                                objectFit: 'cover',
                                maskImage: 'radial-gradient(circle, black 30%, transparent 70%)',
                                WebkitMaskImage: 'radial-gradient(circle, black 30%, transparent 70%)',
                                opacity: 0.9
                            }}
                        />
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
                    <div className="split-view-left">
                        {/* Toolbar - fixed at top */}
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
                                    className={`btn btn-icon ${editMode === 'pan' ? 'active' : ''}`}
                                    onClick={() => setEditMode('pan')}
                                    title="Przesuń widok (przy powiększeniu)"
                                >
                                    <Hand size={18} />
                                </button>
                                <button
                                    className={`btn btn-icon ${editMode === 'text' ? 'active' : ''}`}
                                    onClick={() => setEditMode('text')}
                                    title="Edytuj tekst (Word-like)"
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

                            {editMode === 'rectangle' && (
                                <span className="toolbar-info">
                                    🖱️ Rysuj prostokąt aby zaznaczyć obszar do usunięcia
                                </span>
                            )}
                            {editMode === 'pan' && (
                                <span className="toolbar-info">
                                    ✋ Przeciągnij aby przesunąć powiększony widok
                                </span>
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
                            <button className="btn btn-icon" onClick={() => setZoom(z => {
                                const current = z === 'fit' ? 100 : z
                                return Math.max(25, current - 25)
                            })}>
                                <ZoomOut size={18} />
                            </button>
                            <button
                                className="btn btn-sm"
                                onClick={() => setZoom('fit')}
                                style={{ minWidth: '70px', fontSize: '12px' }}
                            >
                                {zoom === 'fit' ? 'Dopasuj' : `${zoom}%`}
                            </button>
                            <button className="btn btn-icon" onClick={() => setZoom(z => {
                                const current = z === 'fit' ? 100 : z
                                return Math.min(200, current + 25)
                            })}>
                                <ZoomIn size={18} />
                            </button>
                        </div>

                        {/* Scrollable PDF area */}
                        <div className="pdf-scroll-container" ref={containerRef}>
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
                                        <PDFHighlighterEditor
                                            pdfUrl={`${API_URL}/api/jobs/${jobId}/pdf`}
                                            highlights={[]}
                                            onHighlightsChange={() => { }}
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
                            {editMode === 'text' && (
                                <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                                    <li><strong>Kliknij</strong> na dowolny tekst w PDF</li>
                                    <li><strong>Wpisz</strong> nową treść</li>
                                    <li>Wciśnij <strong>Enter</strong> lub kliknij poza polem</li>
                                    <li>Kliknij <strong>Generuj PDF</strong> aby zapisać</li>
                                </ol>
                            )}
                            {editMode === 'pan' && (
                                <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                                    <li><strong>Przeciągaj</strong> myszką aby przesuwać widok</li>
                                    <li>Użyj <strong>Ctrl+scroll</strong> do zoomowania</li>
                                    <li>Przełącz narzędzie na górze aby edytować</li>
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

                        {/* Blocks to delete panel (Images/Text) */}
                        {blocksToDelete.length > 0 && (
                            <div className="card mt-md" style={{ borderColor: '#ef4444' }}>
                                <h4 className="mb-sm" style={{ color: '#ef4444' }}>
                                    🗑️ Elementy do usunięcia ({blocksToDelete.length})
                                </h4>
                                <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
                                    Zaznaczono {blocksToDelete.length} elementów do trwałego usunięcia.
                                </div>

                                <button
                                    className="btn btn-danger w-full"
                                    onClick={applyBlockDeletions}
                                    disabled={rendering}
                                >
                                    <Trash2 size={16} />
                                    {rendering ? 'Usuwanie...' : 'Usuń zaznaczone'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <style>{`
                /* Image block styling */
                .text-block.image-block:hover {
                    background-color: rgba(139, 92, 246, 0.1) !important;
                    border-color: #8b5cf6 !important;
                }
                
                .text-block.image-block:hover .image-label {
                    display: block !important;
                }
                .split-view-left {
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }
                
                .drawing-toolbar {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 12px;
                    background: var(--color-bg-tertiary);
                    border-radius: 8px;
                    margin-bottom: 12px;
                    flex-shrink: 0;
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
                    padding: 20px 40px;
                    padding-bottom: 40px;
                    flex: 1;
                    overflow: auto;
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
                
                /* Text block hover effects for Word-like editing */
                .text-block {
                    transition: background-color 0.15s, border 0.15s;
                }
                
                /* Only apply hover effect to unmodified, non-editing blocks */
                .text-block:hover:not(.editing):not(.modified) {
                    background-color: rgba(59, 130, 246, 0.1) !important;
                    border: 1px dashed rgba(59, 130, 246, 0.5) !important;
                }
                
                /* Ensure modified blocks always have white background to mask original text */
                .text-block.modified {
                    background-color: white !important;
                }
                
                .text-block.editing {
                    z-index: 10;
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
