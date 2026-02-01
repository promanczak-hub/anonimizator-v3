import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import * as fabric from 'fabric'

/**
 * Fabric.js PDF Editor Component
 * 
 * Features:
 * - Rectangle drawing for redaction regions
 * - Pan mode (hand tool)
 * - Zoom (Ctrl+scroll, buttons)
 * - Text block selection for deletion
 * - Word-like inline text editing
 * - Resizable/movable redaction boxes
 */
const FabricPDFEditor = forwardRef(({
    pageIndex,
    imageUrl,
    zoom = 100,
    editMode = 'pan',
    regions = [],
    onRegionsChange,
    textBlocks = [],
    textEdits = {},           // { blockIdx: newText }
    onTextEdit,               // (pageIndex, blockIdx, newText) => void
    blocksToDelete = [],
    onBlockToggle,
    onImageLoad
}, ref) => {
    const canvasRef = useRef(null)
    const fabricRef = useRef(null)
    const containerRef = useRef(null)
    const [isDrawing, setIsDrawing] = useState(false)
    const [drawStart, setDrawStart] = useState(null)
    const currentRectRef = useRef(null)
    const imageRef = useRef(null)

    // Word-like text editing state
    const [editingBlock, setEditingBlock] = useState(null) // { blockIndex, text, bbox }
    const inputRef = useRef(null)

    // Initialize fabric canvas
    useEffect(() => {
        if (!canvasRef.current) return

        const canvas = new fabric.Canvas(canvasRef.current, {
            selection: false,
            preserveObjectStacking: true,
            renderOnAddRemove: true
        })

        fabricRef.current = canvas

        return () => {
            canvas.dispose()
            fabricRef.current = null
        }
    }, [])

    // Load background image
    useEffect(() => {
        const canvas = fabricRef.current
        if (!canvas || !imageUrl) return

        fabric.FabricImage.fromURL(imageUrl, { crossOrigin: 'anonymous' }).then((img) => {
            if (!fabricRef.current) return

            imageRef.current = img

            // Set canvas size to match image
            const width = img.width || 800
            const height = img.height || 1000

            canvas.setWidth(width)
            canvas.setHeight(height)

            // Set image as background
            canvas.backgroundImage = img
            img.set({
                originX: 'left',
                originY: 'top',
                left: 0,
                top: 0,
                selectable: false,
                evented: false
            })

            canvas.renderAll()
            onImageLoad?.(pageIndex, { width, height })
        }).catch(err => {
            console.error('Failed to load PDF page image:', err)
        })
    }, [imageUrl, pageIndex, onImageLoad])

    // Apply zoom
    useEffect(() => {
        const canvas = fabricRef.current
        if (!canvas) return

        const zoomFactor = zoom / 100
        canvas.setZoom(zoomFactor)

        if (imageRef.current) {
            canvas.setWidth((imageRef.current.width || 800) * zoomFactor)
            canvas.setHeight((imageRef.current.height || 1000) * zoomFactor)
        }

        canvas.renderAll()
    }, [zoom])

    // Sync regions to canvas
    useEffect(() => {
        const canvas = fabricRef.current
        if (!canvas) return

        // Remove old rectangles (but keep background)
        const objects = canvas.getObjects()
        objects.forEach(obj => {
            if (obj.regionId) {
                canvas.remove(obj)
            }
        })

        // Add current regions
        regions.forEach(region => {
            const rect = new fabric.Rect({
                left: region.x,
                top: region.y,
                width: region.width,
                height: region.height,
                fill: 'rgba(0, 0, 0, 0.7)',
                stroke: '#ef4444',
                strokeWidth: 2,
                strokeDashArray: [4, 4],
                selectable: editMode === 'rectangle',
                hasControls: editMode === 'rectangle',
                hasBorders: true,
                lockRotation: true,
                cornerColor: '#ef4444',
                cornerSize: 8,
                transparentCorners: false
            })
            rect.regionId = region.id

            canvas.add(rect)
        })

        canvas.renderAll()
    }, [regions, editMode])

    // Handle text blocks visualization
    useEffect(() => {
        const canvas = fabricRef.current
        if (!canvas || editMode !== 'text') return

        // Remove old text block overlays
        canvas.getObjects().forEach(obj => {
            if (obj.isTextBlock) {
                canvas.remove(obj)
            }
        })

        const canvasWidth = canvas.getWidth() / (zoom / 100)
        const canvasHeight = canvas.getHeight() / (zoom / 100)

        // Add text block overlays
        textBlocks.forEach((block, idx) => {
            const bbox = block.bbox
            const isMarked = blocksToDelete.some(b => b.id === `${pageIndex}_${idx}`)

            const rect = new fabric.Rect({
                left: (bbox.x / 100) * canvasWidth,
                top: (bbox.y / 100) * canvasHeight,
                width: (bbox.w / 100) * canvasWidth,
                height: (bbox.h / 100) * canvasHeight,
                fill: isMarked ? 'rgba(239, 68, 68, 0.3)' : 'rgba(59, 130, 246, 0.1)',
                stroke: isMarked ? '#ef4444' : '#3b82f6',
                strokeWidth: 1,
                selectable: false,
                evented: true,
                hoverCursor: 'pointer'
            })
            rect.isTextBlock = true
            rect.blockIndex = idx
            rect.blockBbox = bbox

            canvas.add(rect)
        })

        canvas.renderAll()
    }, [textBlocks, blocksToDelete, editMode, pageIndex, zoom])

    // Handle mouse events based on editMode
    useEffect(() => {
        const canvas = fabricRef.current
        if (!canvas) return

        const handleMouseDown = (opt) => {
            const evt = opt.e
            const pointer = canvas.getPointer(evt)

            if (editMode === 'pan') {
                canvas.isDragging = true
                canvas.lastPosX = evt.clientX
                canvas.lastPosY = evt.clientY
                canvas.selection = false
                return
            }

            if (editMode === 'text') {
                // Check if clicked on text block
                const target = canvas.findTarget(evt)
                if (target && target.isTextBlock) {
                    // Word-like editing: show input to edit text
                    const block = textBlocks[target.blockIndex]
                    const currentText = textEdits[target.blockIndex] !== undefined
                        ? textEdits[target.blockIndex]
                        : block?.text || ''
                    setEditingBlock({
                        blockIndex: target.blockIndex,
                        text: currentText,
                        bbox: target.blockBbox,
                        originalText: block?.text || '',
                        fontSize: block?.font_size || 12
                    })
                } else {
                    // Clicked outside - save and close editor
                    if (editingBlock && editingBlock.text !== editingBlock.originalText) {
                        onTextEdit?.(pageIndex, editingBlock.blockIndex, editingBlock.text)
                    }
                    setEditingBlock(null)
                }
                return
            }

            if (editMode === 'rectangle') {
                // Check if clicked on delete button of existing rect
                const target = canvas.findTarget(evt)
                if (target && target.regionId) {
                    // Clicked on existing region - let fabric handle selection
                    return
                }

                // Start drawing new rectangle
                setIsDrawing(true)
                setDrawStart({ x: pointer.x, y: pointer.y })

                const rect = new fabric.Rect({
                    left: pointer.x,
                    top: pointer.y,
                    width: 0,
                    height: 0,
                    fill: 'rgba(139, 92, 246, 0.3)',
                    stroke: '#8b5cf6',
                    strokeWidth: 2,
                    strokeDashArray: [5, 5],
                    selectable: false,
                    evented: false
                })
                currentRectRef.current = rect
                canvas.add(rect)
            }
        }

        const handleMouseMove = (opt) => {
            const evt = opt.e

            if (editMode === 'pan' && canvas.isDragging) {
                const container = containerRef.current?.parentElement
                if (container) {
                    container.scrollLeft -= evt.clientX - canvas.lastPosX
                    container.scrollTop -= evt.clientY - canvas.lastPosY
                }
                canvas.lastPosX = evt.clientX
                canvas.lastPosY = evt.clientY
                return
            }

            if (editMode === 'rectangle' && isDrawing && drawStart && currentRectRef.current) {
                const pointer = canvas.getPointer(evt)

                let x = drawStart.x
                let y = drawStart.y
                let width = pointer.x - drawStart.x
                let height = pointer.y - drawStart.y

                if (width < 0) {
                    x = pointer.x
                    width = Math.abs(width)
                }
                if (height < 0) {
                    y = pointer.y
                    height = Math.abs(height)
                }

                currentRectRef.current.set({
                    left: x,
                    top: y,
                    width: width,
                    height: height
                })
                canvas.renderAll()
            }
        }

        const handleMouseUp = () => {
            if (editMode === 'pan') {
                canvas.isDragging = false
                return
            }

            if (editMode === 'rectangle' && isDrawing && currentRectRef.current) {
                const rect = currentRectRef.current

                // Only save if big enough
                if (rect.width > 10 && rect.height > 10) {
                    const newRegion = {
                        id: `rect-${Date.now()}`,
                        x: rect.left,
                        y: rect.top,
                        width: rect.width,
                        height: rect.height
                    }
                    onRegionsChange?.([...regions, newRegion])
                }

                canvas.remove(rect)
                currentRectRef.current = null
                setIsDrawing(false)
                setDrawStart(null)
                canvas.renderAll()
            }
        }

        const handleObjectModified = (opt) => {
            const obj = opt.target
            if (obj && obj.regionId) {
                // Update region position/size
                const updated = regions.map(r => {
                    if (r.id === obj.regionId) {
                        return {
                            ...r,
                            x: obj.left,
                            y: obj.top,
                            width: obj.width * obj.scaleX,
                            height: obj.height * obj.scaleY
                        }
                    }
                    return r
                })
                onRegionsChange?.(updated)
            }
        }

        canvas.on('mouse:down', handleMouseDown)
        canvas.on('mouse:move', handleMouseMove)
        canvas.on('mouse:up', handleMouseUp)
        canvas.on('object:modified', handleObjectModified)

        return () => {
            canvas.off('mouse:down', handleMouseDown)
            canvas.off('mouse:move', handleMouseMove)
            canvas.off('mouse:up', handleMouseUp)
            canvas.off('object:modified', handleObjectModified)
        }
    }, [editMode, isDrawing, drawStart, regions, onRegionsChange, onBlockToggle, pageIndex])

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
        getCanvas: () => fabricRef.current,
        getRegions: () => regions,
        removeRegion: (regionId) => {
            onRegionsChange?.(regions.filter(r => r.id !== regionId))
        },
        clearRegions: () => {
            onRegionsChange?.([])
        }
    }), [regions, onRegionsChange])

    // Handle delete key for selected region
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                const canvas = fabricRef.current
                if (!canvas) return

                const active = canvas.getActiveObject()
                if (active && active.regionId) {
                    e.preventDefault()
                    onRegionsChange?.(regions.filter(r => r.id !== active.regionId))
                }
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [regions, onRegionsChange])

    // Handle text input completion
    const handleTextInputKeyDown = useCallback((e) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            if (editingBlock && editingBlock.text !== editingBlock.originalText) {
                onTextEdit?.(pageIndex, editingBlock.blockIndex, editingBlock.text)
            }
            setEditingBlock(null)
        } else if (e.key === 'Escape') {
            setEditingBlock(null)
        }
    }, [editingBlock, onTextEdit, pageIndex])

    // Focus input when editing block changes
    useEffect(() => {
        if (editingBlock && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [editingBlock])

    // Calculate input position based on block bbox
    const getInputStyle = useCallback(() => {
        if (!editingBlock || !fabricRef.current) return {}

        const canvas = fabricRef.current
        const canvasWidth = canvas.getWidth()
        const canvasHeight = canvas.getHeight()
        const bbox = editingBlock.bbox

        return {
            position: 'absolute',
            left: `${bbox.x}%`,
            top: `${bbox.y}%`,
            width: `${bbox.w}%`,
            minHeight: `${bbox.h}%`,
            fontSize: `${Math.max(12, editingBlock.fontSize * (zoom / 100))}px`,
            padding: '2px 4px',
            border: '2px solid #3b82f6',
            borderRadius: '2px',
            backgroundColor: 'white',
            color: '#333',
            outline: 'none',
            zIndex: 100,
            fontFamily: 'inherit'
        }
    }, [editingBlock, zoom])

    return (
        <div
            ref={containerRef}
            className="fabric-canvas-wrapper"
            style={{
                position: 'relative',
                cursor: editMode === 'pan' ? 'grab' :
                    editMode === 'rectangle' ? 'crosshair' :
                        editMode === 'text' ? 'pointer' : 'default'
            }}
        >
            <canvas ref={canvasRef} />

            {/* Word-like inline text editing overlay */}
            {editMode === 'text' && editingBlock && (
                <input
                    ref={inputRef}
                    type="text"
                    value={editingBlock.text}
                    onChange={(e) => setEditingBlock(prev => ({ ...prev, text: e.target.value }))}
                    onKeyDown={handleTextInputKeyDown}
                    onBlur={() => {
                        if (editingBlock.text !== editingBlock.originalText) {
                            onTextEdit?.(pageIndex, editingBlock.blockIndex, editingBlock.text)
                        }
                        setEditingBlock(null)
                    }}
                    style={getInputStyle()}
                />
            )}
        </div>
    )
})

FabricPDFEditor.displayName = 'FabricPDFEditor'

export default FabricPDFEditor
