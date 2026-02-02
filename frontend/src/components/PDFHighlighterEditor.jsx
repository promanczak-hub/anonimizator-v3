import { useEffect, useRef, useState, useCallback } from 'react'
import {
    PdfLoader,
    PdfHighlighter,
    Highlight,
    Popup,
    AreaHighlight,
} from 'react-pdf-highlighter'
import FloatingToolbar from './FloatingToolbar'
import '../pdfjs-config'
import 'react-pdf-highlighter/dist/style.css'
import './PDFHighlighter.css'

const getNextId = () => String(Math.random()).slice(2)

const PDFHighlighterEditor = ({
    pdfUrl,
    highlights = [],
    onHighlightsChange,
}) => {
    const [currentHighlights, setCurrentHighlights] = useState(highlights)
    const scrollViewerTo = useRef(() => { })

    useEffect(() => {
        setCurrentHighlights(highlights)
    }, [highlights])

    const addHighlight = useCallback((highlight) => {
        const newHighlight = {
            ...highlight,
            id: getNextId(),
        }
        const updated = [...currentHighlights, newHighlight]
        setCurrentHighlights(updated)
        onHighlightsChange?.(updated)
    }, [currentHighlights, onHighlightsChange])

    const removeHighlight = useCallback((highlightId) => {
        const updated = currentHighlights.filter(h => h.id !== highlightId)
        setCurrentHighlights(updated)
        onHighlightsChange?.(updated)
    }, [currentHighlights, onHighlightsChange])

    const updateHighlight = useCallback((highlightId, position, content) => {
        const updated = currentHighlights.map(h => {
            if (h.id === highlightId) {
                return {
                    ...h,
                    position: { ...h.position, ...position },
                    content: { ...h.content, ...content },
                }
            }
            return h
        })
        setCurrentHighlights(updated)
        onHighlightsChange?.(updated)
    }, [currentHighlights, onHighlightsChange])

    return (
        <div className="pdf-highlighter-container" style={{ height: '100%', position: 'relative' }}>
            <PdfLoader
                url={pdfUrl}
                beforeLoad={
                    <div className="pdf-skeleton">
                        <div className="skeleton-line" />
                        <div className="skeleton-line" />
                        <div className="skeleton-line short" />
                    </div>
                }
            >
                {(pdfDocument) => (
                    <PdfHighlighter
                        pdfDocument={pdfDocument}
                        enableAreaSelection={(event) => event.altKey}
                        onScrollChange={() => { }}
                        scrollRef={(scrollTo) => {
                            scrollViewerTo.current = scrollTo
                        }}
                        onSelectionFinished={(
                            position,
                            content,
                            hideTipAndSelection,
                            transformSelection
                        ) => (
                            <FloatingToolbar
                                onRedact={() => {
                                    addHighlight({
                                        content,
                                        position,
                                        comment: { text: '🔒 Do usunięcia', type: 'redaction' },
                                    })
                                    hideTipAndSelection()
                                }}
                                onCancel={hideTipAndSelection}
                            />
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
                            const isTextHighlight = !highlight.content?.image

                            const component = isTextHighlight ? (
                                <Highlight
                                    isScrolledTo={isScrolledTo}
                                    position={highlight.position}
                                    comment={highlight.comment}
                                    onClick={() => {
                                        if (window.confirm('Usunąć zaznaczenie?')) {
                                            removeHighlight(highlight.id)
                                        }
                                    }}
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
                                    popupContent={
                                        <div className="highlight-popup">
                                            {highlight.comment?.text}
                                        </div>
                                    }
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
                        highlights={currentHighlights}
                    />
                )}
            </PdfLoader>
        </div>
    )
}

export default PDFHighlighterEditor
