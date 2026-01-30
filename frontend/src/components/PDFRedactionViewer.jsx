import { useState, useCallback, useRef, useEffect } from 'react'
import {
    PdfLoader,
    PdfHighlighter,
    Highlight,
    Popup,
    AreaHighlight,
} from 'react-pdf-highlighter'
import 'react-pdf-highlighter/dist/style.css'
import { Trash2, Save, RotateCcw } from 'lucide-react'

// Types
const getNextId = () => String(Math.random()).slice(2)

const resetHash = () => {
    document.location.hash = ''
}

/**
 * PDF Redaction Viewer using react-pdf-highlighter
 * Allows users to select text or draw rectangles to mark for removal
 */
function PDFRedactionViewer({ pdfUrl, jobId, onHighlightsChange }) {
    const [highlights, setHighlights] = useState([])
    const scrollViewerTo = useRef(() => { })

    // Scroll to highlight by hash
    useEffect(() => {
        const scrollToHighlightFromHash = () => {
            const highlight = getHighlightById(parseIdFromHash())
            if (highlight) {
                scrollViewerTo.current(highlight)
            }
        }
        window.addEventListener('hashchange', scrollToHighlightFromHash, false)
        return () => window.removeEventListener('hashchange', scrollToHighlightFromHash)
    }, [])

    const parseIdFromHash = () => document.location.hash.slice('#highlight-'.length)

    const getHighlightById = (id) => highlights.find((h) => h.id === id)

    const addHighlight = useCallback((highlight) => {
        console.log('Adding highlight:', highlight)
        const newHighlight = { ...highlight, id: getNextId() }
        setHighlights((prev) => {
            const updated = [...prev, newHighlight]
            onHighlightsChange?.(updated)
            return updated
        })
    }, [onHighlightsChange])

    const updateHighlight = useCallback((highlightId, position, content) => {
        console.log('Updating highlight:', highlightId, position, content)
        setHighlights((prev) => {
            const updated = prev.map((h) => {
                if (h.id === highlightId) {
                    return {
                        ...h,
                        position: { ...h.position, ...position },
                        content: { ...h.content, ...content },
                    }
                }
                return h
            })
            onHighlightsChange?.(updated)
            return updated
        })
    }, [onHighlightsChange])

    const removeHighlight = useCallback((highlightId) => {
        setHighlights((prev) => {
            const updated = prev.filter((h) => h.id !== highlightId)
            onHighlightsChange?.(updated)
            return updated
        })
    }, [onHighlightsChange])

    const clearAllHighlights = useCallback(() => {
        setHighlights([])
        onHighlightsChange?.([])
    }, [onHighlightsChange])

    // Highlight popup component
    const HighlightPopup = ({ comment }) => (
        comment?.text ? (
            <div className="highlight-popup">
                {comment.text}
            </div>
        ) : null
    )

    return (
        <div className="pdf-redaction-viewer">
            {/* Toolbar */}
            <div className="redaction-toolbar">
                <span className="toolbar-info">
                    🖍️ Zaznacz tekst lub narysuj prostokąt aby oznaczyć do usunięcia
                </span>
                <span className="badge badge-danger">
                    {highlights.length} zaznaczeń
                </span>
                <button
                    className="btn btn-icon btn-sm"
                    onClick={clearAllHighlights}
                    disabled={highlights.length === 0}
                    title="Wyczyść wszystkie"
                >
                    <RotateCcw size={16} />
                </button>
            </div>

            {/* Highlights sidebar */}
            {highlights.length > 0 && (
                <div className="highlights-sidebar">
                    <h4>Do usunięcia ({highlights.length})</h4>
                    <ul className="highlights-list">
                        {highlights.map((highlight, index) => (
                            <li
                                key={highlight.id}
                                className="highlight-item"
                                onClick={() => {
                                    document.location.hash = `highlight-${highlight.id}`
                                }}
                            >
                                <div className="highlight-item-content">
                                    <span className="highlight-item-page">
                                        Str. {highlight.position.pageNumber}
                                    </span>
                                    <span className="highlight-item-text">
                                        {highlight.content?.text?.slice(0, 30) || 'Obszar'}
                                        {highlight.content?.text?.length > 30 ? '...' : ''}
                                    </span>
                                </div>
                                <button
                                    className="btn btn-icon btn-xs btn-danger"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        removeHighlight(highlight.id)
                                    }}
                                >
                                    <Trash2 size={12} />
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* PDF Viewer */}
            <div className="pdf-container">
                <PdfLoader url={pdfUrl} beforeLoad={<div className="loading">Ładowanie PDF...</div>}>
                    {(pdfDocument) => (
                        <PdfHighlighter
                            pdfDocument={pdfDocument}
                            enableAreaSelection={(event) => event.altKey}
                            onScrollChange={resetHash}
                            scrollRef={(scrollTo) => {
                                scrollViewerTo.current = scrollTo
                            }}
                            onSelectionFinished={(
                                position,
                                content,
                                hideTipAndSelection,
                                transformSelection
                            ) => (
                                <div className="selection-tip">
                                    <button
                                        className="btn btn-danger btn-sm"
                                        onClick={() => {
                                            addHighlight({ content, position, comment: { text: 'Do usunięcia' } })
                                            hideTipAndSelection()
                                        }}
                                    >
                                        <Trash2 size={14} />
                                        Usuń ten fragment
                                    </button>
                                </div>
                            )}
                            highlightTransform={(
                                highlight,
                                index,
                                setTip,
                                hideTip,
                                viewportToScaled,
                                screenshot,
                                isScrolledTo
                            ) => {
                                const isTextHighlight = !Boolean(highlight.content?.image)

                                const component = isTextHighlight ? (
                                    <Highlight
                                        isScrolledTo={isScrolledTo}
                                        position={highlight.position}
                                        comment={highlight.comment}
                                    />
                                ) : (
                                    <AreaHighlight
                                        isScrolledTo={isScrolledTo}
                                        highlight={highlight}
                                        onChange={(boundingRect) => {
                                            updateHighlight(
                                                highlight.id,
                                                { boundingRect: viewportToScaled(boundingRect) },
                                                { image: screenshot(boundingRect) }
                                            )
                                        }}
                                    />
                                )

                                return (
                                    <Popup
                                        popupContent={<HighlightPopup {...highlight} />}
                                        onMouseOver={(popupContent) =>
                                            setTip(highlight, () => popupContent)
                                        }
                                        onMouseOut={hideTip}
                                        key={index}
                                    >
                                        {component}
                                    </Popup>
                                )
                            }}
                            highlights={highlights}
                        />
                    )}
                </PdfLoader>
            </div>

            {/* Styles */}
            <style>{`
                .pdf-redaction-viewer {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    background: var(--color-bg-tertiary);
                }

                .redaction-toolbar {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px 16px;
                    background: var(--color-bg-secondary);
                    border-bottom: 1px solid var(--color-border);
                }

                .highlights-sidebar {
                    position: absolute;
                    right: 0;
                    top: 60px;
                    width: 280px;
                    background: var(--color-bg-secondary);
                    border-left: 1px solid var(--color-border);
                    padding: 12px;
                    max-height: calc(100% - 60px);
                    overflow-y: auto;
                    z-index: 10;
                }

                .highlights-list {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                }

                .highlight-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px;
                    margin-bottom: 4px;
                    background: var(--color-bg-tertiary);
                    border-radius: 4px;
                    cursor: pointer;
                    transition: background 0.2s;
                }

                .highlight-item:hover {
                    background: var(--color-bg-hover);
                }

                .highlight-item-content {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }

                .highlight-item-page {
                    font-size: 11px;
                    color: var(--color-text-muted);
                }

                .highlight-item-text {
                    font-size: 13px;
                    color: var(--color-text-primary);
                }

                .pdf-container {
                    flex: 1;
                    overflow: auto;
                    position: relative;
                }

                .selection-tip {
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    padding: 8px;
                }

                .selection-tip .btn {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .highlight-popup {
                    background: #333;
                    color: white;
                    padding: 6px 10px;
                    border-radius: 4px;
                    font-size: 12px;
                }

                .loading {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 200px;
                    color: var(--color-text-muted);
                }

                /* Override react-pdf-highlighter styles for redaction look */
                .Highlight__part {
                    background: rgba(239, 68, 68, 0.3) !important;
                }

                .Highlight--scrolledTo .Highlight__part {
                    background: rgba(239, 68, 68, 0.5) !important;
                }

                .AreaHighlight {
                    background: rgba(239, 68, 68, 0.3) !important;
                    border: 2px solid #ef4444 !important;
                }
            `}</style>
        </div>
    )
}

export default PDFRedactionViewer
