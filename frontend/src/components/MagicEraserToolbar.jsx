import { Eraser, Hash, DollarSign, User, Mail, Phone, Trash2 } from 'lucide-react'

/**
 * Magic Eraser Toolbar
 * Auto-detect and redact sensitive data patterns
 */

const MagicEraserToolbar = ({
    onDetectPattern,
    onClearAll,
    highlightCount = 0,
    detecting = false,
}) => {
    const tools = [
        { id: 'pesel', label: 'PESEL', icon: Hash, color: '#ef4444' },
        { id: 'money', label: 'Kwoty', icon: DollarSign, color: '#f59e0b' },
        { id: 'names', label: 'Nazwiska', icon: User, color: '#8b5cf6' },
        { id: 'email', label: 'Email', icon: Mail, color: '#3b82f6' },
        { id: 'phone', label: 'Telefon', icon: Phone, color: '#10b981' },
    ]

    return (
        <div className="magic-eraser-toolbar">
            <div className="toolbar-section">
                <span className="toolbar-label">
                    <Eraser size={16} />
                    Magiczna Gumka
                </span>
                <div className="toolbar-buttons">
                    {tools.map(tool => (
                        <button
                            key={tool.id}
                            className="btn btn-sm magic-btn"
                            onClick={() => onDetectPattern?.(tool.id)}
                            disabled={detecting}
                            title={`Wykryj i zaznacz wszystkie ${tool.label}`}
                            style={{ '--accent-color': tool.color }}
                        >
                            <tool.icon size={14} />
                            {tool.label}
                        </button>
                    ))}
                </div>
            </div>

            {highlightCount > 0 && (
                <div className="toolbar-section">
                    <span className="highlight-count">
                        {highlightCount} zaznaczonych
                    </span>
                    <button
                        className="btn btn-sm btn-danger"
                        onClick={onClearAll}
                        title="Usuń wszystkie zaznaczenia"
                    >
                        <Trash2 size={14} />
                        Wyczyść
                    </button>
                </div>
            )}

            <style>{`
                .magic-eraser-toolbar {
                    display: flex;
                    align-items: center;
                    gap: 24px;
                    padding: 12px 16px;
                    background: var(--bg-secondary);
                    border-bottom: 1px solid var(--border-color);
                }
                
                .toolbar-section {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                
                .toolbar-label {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-weight: 500;
                    color: var(--text-secondary);
                    font-size: 0.85rem;
                }
                
                .toolbar-buttons {
                    display: flex;
                    gap: 6px;
                }
                
                .magic-btn {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    padding: 6px 10px;
                    border-radius: 6px;
                    font-size: 0.8rem;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--border-color);
                    transition: all 0.15s;
                }
                
                .magic-btn:hover {
                    background: var(--accent-color, var(--color-accent));
                    color: white;
                    border-color: var(--accent-color, var(--color-accent));
                }
                
                .highlight-count {
                    font-size: 0.85rem;
                    color: var(--text-secondary);
                    background: var(--bg-tertiary);
                    padding: 4px 10px;
                    border-radius: 12px;
                }
                
                .btn-danger {
                    background: #ef4444;
                    color: white;
                    border: none;
                }
                
                .btn-danger:hover {
                    background: #dc2626;
                }
            `}</style>
        </div>
    )
}

export default MagicEraserToolbar
