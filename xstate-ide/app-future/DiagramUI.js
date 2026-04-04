/**
 * DiagramUI.js
 *
 * Preact component for the diagram pane (left panel).
 * Handles mermaid diagram rendering, pan/zoom, and graph direction toggle.
 *
 * Usage:
 *   mountDiagramPane(el)   — call once from boot(); el is #diagram-mount
 *
 * After mount, these window globals are available (for main.js and index.html):
 *   window.renderDiagram(config, current, visitedEdges)
 *   window.toggleGraphDir()
 *   window.diagramZoom(delta)
 *   window.diagramReset()
 */

import mermaid from 'mermaid';
import { html }                        from 'htm/preact';
import { render }                      from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';

mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
console.log('✅ Mermaid initialised');

// ── Module-level bridge — component populates these on every render ───────────
// Allows window globals (set up in mountDiagramPane) to reach component internals
// without prop-drilling or re-mounting.
const _imp = {
    graphDir:  () => 'TD',
    zoom:      (_delta) => {},
    reset:     () => {},
    toggleDir: () => {},
    setDir:    (_dir) => {},
    // Stable ref — .current is updated by window.renderDiagram
    lastRenderArgs: { current: null },
};

// ── Pure helper: auto direction from viewport/orientation ─────────────────────
function _computeAutoDir() {
    const mobile    = window.innerWidth <= 700 || document.body.classList.contains('force-mobile-layout');
    const landscape = window.innerWidth > window.innerHeight;
    return (mobile && landscape) ? 'LR' : 'TD';
}

// ── Core render (module-level; called by window.renderDiagram + toggleDir) ────
async function _doRenderDiagram(config, current, visitedEdges = new Set(), dirHint) {
    const dir = dirHint ?? _imp.graphDir();
    let graph = `graph ${dir}\n`;

    Object.keys(config.states).forEach(id => {
        const style = id === current ? `:::activeNode` : '';
        graph += `  ${id}["${id}"]${style}\n`;

        if (config.states[id].on) {
            Object.entries(config.states[id].on).forEach(([ev, transition]) => {
                const entries = Array.isArray(transition) ? transition : [transition];
                const targets = new Set();
                entries.forEach(t => {
                    const tId = typeof t === 'string' ? t : t?.target;
                    if (tId && tId !== id) targets.add(tId);
                });
                targets.forEach(tId => {
                    const visited = visitedEdges.has(`${id}|${ev}`);
                    graph += `  ${id} -- "${visited ? '✅ ' : ''}${ev}" --> ${tId}\n`;
                });
            });
        }

        if (config.states[id].always) {
            const targets = Array.isArray(config.states[id].always)
                ? config.states[id].always : [config.states[id].always];
            targets.forEach(t => {
                const tId = t.target || t;
                graph += `  ${id} -- "${visitedEdges.has(`${id}|auto`) ? '✅ ' : ''}auto" --> ${tId}\n`;
            });
        }

        if (config.states[id].invoke) {
            const inv = config.states[id].invoke;
            const onDones = Array.isArray(inv.onDone) ? inv.onDone : (inv.onDone ? [inv.onDone] : []);
            onDones.forEach(branch => {
                if (!branch?.target) return;
                const visited = visitedEdges.has(`${id}|done`);
                graph += `  ${id} -. "${visited ? '✅ ' : ''}done" .-> ${branch.target}\n`;
            });
            if (inv.onError?.target) {
                const visited = visitedEdges.has(`${id}|error`);
                graph += `  ${id} -. "${visited ? '✅ ' : ''}error" .-> ${inv.onError.target}\n`;
            }
        }
    });

    graph += `\nclassDef activeNode fill:#0084ff,stroke:#0051ff,stroke-width:4px,color:#fff;`;
    console.log('🗺️  Mermaid source:\n' + graph);

    try {
        const { svg } = await mermaid.render('mermaid-svg-' + Date.now(), graph);
        document.getElementById('mermaid-container').innerHTML = svg;
        console.log('✅ Diagram rendered');
    } catch (e) {
        console.error('❌ mermaid.render() threw:', e.message);
        document.getElementById('mermaid-container').innerHTML =
            `<pre style="color:red;font-size:11px;">Diagram error:\n${e.message}</pre>`;
    }
}

// ── DiagramPane component ─────────────────────────────────────────────────────

function DiagramPane() {
    const [dirOverride, setDirOverride] = useState(null); // null | 'LR' | 'TD'

    const viewportRef = useRef(null);
    const canvasRef   = useRef(null);
    const scaleRef    = useRef(1);
    const txRef       = useRef(0);
    const tyRef       = useRef(0);

    const applyTransform = () => {
        const c = canvasRef.current;
        if (c) c.style.transform = `translate(${txRef.current}px, ${tyRef.current}px) scale(${scaleRef.current})`;
    };

    const graphDir  = () => dirOverride ?? _computeAutoDir();
    const zoom      = (delta) => {
        scaleRef.current = Math.min(4, Math.max(0.2, scaleRef.current + delta));
        applyTransform();
    };
    const reset     = () => {
        scaleRef.current = 1; txRef.current = 0; tyRef.current = 0;
        const c = canvasRef.current;
        if (c) c.style.transform = '';
    };
    const toggleDir = () => {
        const newOverride = graphDir() === 'LR' ? 'TD' : 'LR';
        setDirOverride(newOverride);
        const args = _imp.lastRenderArgs.current;
        if (args) {
            _doRenderDiagram(args.config, args.current, args.visitedEdges, newOverride).catch(() => {});
        }
    };

    // Keep _imp bridge current — safe in render body (no state/subscription side effects)
    _imp.graphDir  = graphDir;
    _imp.zoom      = zoom;
    _imp.reset     = reset;
    _imp.toggleDir = toggleDir;
    _imp.setDir    = (dir) => setDirOverride(dir ?? null);

    // ── Pan/zoom event listeners — set up once on mount ───────────────────────
    useEffect(() => {
        const vp = viewportRef.current;
        if (!vp) return;

        // Mouse pan
        let panning = false, px = 0, py = 0;
        const onMouseDown = (e) => {
            if (e.button !== 0) return;
            panning = true;
            px = e.clientX - txRef.current;
            py = e.clientY - tyRef.current;
            vp.style.cursor = 'grabbing';
        };
        const onMouseMove = (e) => {
            if (!panning) return;
            txRef.current = e.clientX - px;
            tyRef.current = e.clientY - py;
            applyTransform();
        };
        const onMouseUp = () => {
            if (!panning) return;
            panning = false;
            vp.style.cursor = 'grab';
        };
        vp.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup',   onMouseUp);

        // Touch pan + pinch-zoom
        let tpanning = false, tpx = 0, tpy = 0;
        let pinching = false, pinchDist0 = 0, pinchScale0 = 1;
        const _touchDist = (e) => Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
        const onTouchStart = (e) => {
            if (e.touches.length === 2) {
                tpanning = false; pinching = true;
                pinchDist0 = _touchDist(e); pinchScale0 = scaleRef.current;
            } else if (e.touches.length === 1) {
                pinching = false; tpanning = true;
                tpx = e.touches[0].clientX - txRef.current;
                tpy = e.touches[0].clientY - tyRef.current;
            }
        };
        const onTouchMove = (e) => {
            if (pinching && e.touches.length === 2) {
                scaleRef.current = Math.min(4, Math.max(0.2, pinchScale0 * (_touchDist(e) / pinchDist0)));
                applyTransform();
            } else if (tpanning && e.touches.length === 1) {
                txRef.current = e.touches[0].clientX - tpx;
                tyRef.current = e.touches[0].clientY - tpy;
                applyTransform();
            }
        };
        const onTouchEnd = () => { tpanning = false; pinching = false; };
        const onWheel = (e) => {
            e.preventDefault();
            scaleRef.current = Math.min(4, Math.max(0.2, scaleRef.current - e.deltaY * 0.001));
            applyTransform();
        };
        vp.addEventListener('touchstart', onTouchStart, { passive: true });
        vp.addEventListener('touchmove',  onTouchMove,  { passive: true });
        vp.addEventListener('touchend',   onTouchEnd,   { passive: true });
        vp.addEventListener('wheel',      onWheel,      { passive: false });

        return () => {
            vp.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup',   onMouseUp);
            vp.removeEventListener('touchstart', onTouchStart);
            vp.removeEventListener('touchmove',  onTouchMove);
            vp.removeEventListener('touchend',   onTouchEnd);
            vp.removeEventListener('wheel',      onWheel);
        };
    }, []);

    const currentDir = dirOverride ?? _computeAutoDir();

    return html`<div id="diagram-pane">
        <h2>Live State Machine
            <button id="dir-toggle" title="Toggle graph direction" onClick=${toggleDir}>
                ${currentDir === 'LR' ? '↕' : '⇄'}
            </button>
        </h2>
        <div id="diagram-viewport" ref=${viewportRef}>
            <div id="diagram-canvas" ref=${canvasRef}>
                <div id="mermaid-container"></div>
            </div>
            <div id="zoom-controls">
                <button onClick=${() => zoom(0.2)}  title="Zoom in">+</button>
                <button onClick=${() => zoom(-0.2)} title="Zoom out">−</button>
                <button onClick=${reset}            title="Reset zoom" style="font-size:11px;">⊙</button>
            </div>
        </div>
    </div>`;
}

// ── Mount function ────────────────────────────────────────────────────────────

export function mountDiagramPane(el) {
    render(html`<${DiagramPane} />`, el);

    // Window globals — delegate to _imp (populated synchronously by the render above)
    window.diagramZoom    = (delta) => _imp.zoom(delta);
    window.diagramReset   = ()      => _imp.reset();
    window.toggleGraphDir = ()      => _imp.toggleDir();
    window.getDiagramDir  = ()      => _imp.graphDir();
    window.setDiagramDir  = (dir)   => _imp.setDir(dir);

    window.renderDiagram = async (config, current, visitedEdges = new Set()) => {
        _imp.lastRenderArgs.current = { config, current, visitedEdges };
        await _doRenderDiagram(config, current, visitedEdges);
    };

    // Reset pan and re-render on device orientation change
    screen.orientation?.addEventListener('change', () => {
        _imp.reset();
        const args = _imp.lastRenderArgs.current;
        if (args) {
            window.renderDiagram(args.config, args.current, args.visitedEdges).catch(() => {});
        }
    });
}
