/**
 * ResultsDrawerUI.js
 *
 * Preact component for the test-results drawer.
 * Replaces the imperative _createDrawerShell / showResultsDrawer row-building in
 * generate-traces.js.
 *
 * Usage:
 *   const handle = mountResultsDrawer(config, summaryText, runAt, { onRowSelect, onRerun });
 *   handle.setRows(rows)           — set/replace all rows
 *   handle.updateRow(i, status, c) — update a single row during a live run
 *   handle.setSummary(text, color) — update the header summary span
 *   handle.selectRow(i)            — programmatically select + restore a row
 *   handle.remove()                — tear down and clean up
 *
 * Row shape:
 *   { path: number, status: 'pending'|'running'|'pass'|'fail'|'skipped',
 *     expected: string[], case: null|CaseObject }
 *
 * Callbacks:
 *   onRowSelect(i, row)           — called when user clicks a selectable row
 *   onRerun(i, expected, config)  — called when user clicks the ▶ re-run button
 */

import { html }         from 'htm/preact';
import { render }        from 'preact';
import { useState, useRef, useLayoutEffect } from 'preact/hooks';

// ── Status maps ────────────────────────────────────────────────────────────────

const ICON  = { pending: '⬜', running: '⏳', pass: '✅', fail: '❌', skipped: '⏭' };
const COLOR = { pending: '#555', running: '#61dafb', pass: '#98c379', fail: '#e06c75', skipped: '#e5c07b' };

// ── Trace rows — returns a flat array of <tr> elements ─────────────────────────

function TraceRows({ rows, isMobile, selectedIdx, openDiffIdx, onSelect, onRerun, config }) {
    const p   = isMobile ? '8px' : '5px';
    const fs  = isMobile ? '13px' : '11px';
    const efs = isMobile ? '16px' : '13px';

    return rows.flatMap((row, i) => {
        const { path, status, expected, case: c } = row;
        const isSelected  = selectedIdx === i;
        const isClickable = !!c && !c.skipped;
        const hasDiff     = c && !c.passed && !c.skipped && c.diffs?.length;
        const showDiff    = openDiffIdx === i && hasDiff;

        const trStyle = {
            borderBottom: '1px solid #2c313a',
            cursor:       isClickable ? 'pointer' : undefined,
            background:   isSelected  ? '#2d3a4a' : undefined,
            outline:      isSelected  ? '1px solid #0084ff' : undefined,
            transition:   'background 0.1s',
        };

        const trs = [html`<tr
            key=${i}
            style=${trStyle}
            onClick=${isClickable ? () => onSelect(i) : undefined}
            onMouseEnter=${isClickable && !isSelected
                ? (e) => { e.currentTarget.style.background = '#2c313a'; }
                : undefined}
            onMouseLeave=${isClickable && !isSelected
                ? (e) => { e.currentTarget.style.background = ''; }
                : undefined}
        >
            <td style=${{ padding: `${p} 8px`, color: '#666', width: '28px' }}>${String(path)}</td>
            <td style=${{ padding: `${p} 8px`, fontSize: efs, width: '20px' }}>${ICON[status] ?? '?'}</td>
            <td
                style=${{ padding: `${p} 8px`, color: '#abb2bf', maxWidth: '160px',
                           overflow: 'hidden', textOverflow: 'ellipsis',
                           whiteSpace: 'nowrap', fontSize: fs }}
                title=${expected.join(' → ')}
            >${expected.join(' → ')}</td>
            <td style=${{ padding: `${p} 8px`, color: COLOR[status] ?? '#555', fontSize: fs }}>
                ${c?.finalStateId ?? '—'}
            </td>
            <td style=${{ padding: `${p} 4px`, width: '52px' }}>
                ${status === 'running' && html`<button
                    style=${{ background: '#3a3a2a', border: '1px solid #666', color: '#e5c07b',
                               fontSize: '10px', padding: '2px 6px',
                               borderRadius: '3px', cursor: 'pointer' }}
                    title="Skip this path and continue with the next"
                    onClick=${(e) => { e.stopPropagation(); window.skipCurrentTrace?.(); }}
                >Skip</button>`}
                ${(status === 'fail' || status === 'skipped') && html`<button
                    style=${{ background: '#2a3a3a', border: '1px solid #666', color: '#61dafb',
                               fontSize: '10px', padding: '2px 6px',
                               borderRadius: '3px', cursor: 'pointer' }}
                    title="Re-run in foreground (logs to console)"
                    onClick=${(e) => { e.stopPropagation(); onRerun?.(i, expected, config); }}
                >▶</button>`}
            </td>
        </tr>`];

        if (showDiff) {
            trs.push(html`<tr key=${'d' + i} style=${{ background: '#2c1e1e' }}>
                <td
                    colspan="5"
                    style=${{ padding: '5px 12px', color: '#e06c75', fontSize: '10px', lineHeight: '1.6' }}
                    dangerouslySetInnerHTML=${{ __html: c.diffs.map(d => `⚠ ${d}`).join('<br>') }}
                />
            </tr>`);
        }

        return trs;
    });
}

// ── Main drawer component ──────────────────────────────────────────────────────

function ResultsDrawer({ config, summaryText, summaryColor, rows, runAt, onRowSelect, onRerun, imperativeRef }) {
    const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 700);
    const HEADER_H = isMobile ? 52 : 36;

    const drawerRef    = useRef(null);
    const headerRef    = useRef(null);
    const subHeaderRef = useRef(null);
    const tableWrapRef = useRef(null);

    const [collapsed, setCollapsed] = useState(false);
    const collapsedRef = useRef(false);

    // Keep collapsedRef in sync for event handlers in useEffect
    collapsedRef.current = collapsed;

    const [selection, setSelection] = useState({ selectedIdx: null, openDiffIdx: null });

    // Always-fresh handleSelect stored in a ref so setup-effect can expose it
    const handleSelectRef = useRef(null);
    function handleSelect(i) {
        const row = rows[i];
        if (!row?.case || row.case.skipped) return;
        onRowSelect?.(i, row);
        setSelection(prev => {
            const same = prev.selectedIdx === i;
            return {
                selectedIdx: i,
                openDiffIdx: same
                    ? (prev.openDiffIdx === i ? null : i)
                    : (row.case?.diffs?.length ? i : null),
            };
        });
    }
    handleSelectRef.current = handleSelect;

    // Expose imperative handle methods (updated every render so closures stay fresh)
    if (imperativeRef) {
        imperativeRef.triggerSelect = (i) => handleSelectRef.current(i);
        imperativeRef.forceExpand   = () => setCollapsed(false);
    }

    // ── Collapse visual effect — runs synchronously before paint ────────────────
    useLayoutEffect(() => {
        const drawer    = drawerRef.current;
        const subHeader = subHeaderRef.current;
        const tableWrap = tableWrapRef.current;
        const header    = headerRef.current;
        if (!drawer || !subHeader || !tableWrap) return;

        if (isMobile) {
            // Clear any stale desktop styles before applying mobile transform
            drawer.style.bottom   = '0';
            drawer.style.height   = '';
            drawer.style.overflow = '';
            drawer.style.transform = collapsed
                ? `translateY(calc(100% - ${HEADER_H}px))`
                : 'translateY(0)';
        } else {
            // Clear any stale mobile transform before applying desktop clip
            drawer.style.transform = '';
            const headerH = header?.offsetHeight ?? HEADER_H;
            drawer.style.bottom   = '0';
            drawer.style.height   = collapsed ? (headerH + 'px') : '';
            drawer.style.overflow = collapsed ? 'hidden' : '';
        }

        window._fitDiagramAboveDrawer?.(drawer);
    }, [collapsed, isMobile]);

    // ── One-time setup: positioning, drag, resize observer ─────────────────────
    useLayoutEffect(() => {
        const drawer    = drawerRef.current;
        const header    = headerRef.current;
        const tableWrap = tableWrapRef.current;
        if (!drawer || !header) return;

        // Apply transition after mount to avoid animating the initial position
        drawer.style.transition = 'transform 0.3s ease';

        // Set initial tableWrap max-height imperatively (excluded from style obj)
        if (tableWrap) tableWrap.style.maxHeight = isMobile ? '50vh' : '40vh';

        function _toolbarClearance() {
            const tb = document.getElementById('toolbar');
            return tb ? tb.offsetHeight : 0;
        }

        function _fitTodiagramPane() {
            const landscape = window.innerWidth > window.innerHeight;
            const mobileLay = document.body.classList.contains('force-mobile-layout') || window.innerWidth <= 700;
            const dp = document.getElementById('diagram-pane');

            if (!landscape) {
                drawer.style.left     = '0';
                drawer.style.right    = '0';
                drawer.style.width    = '';
                drawer.style.minWidth = '';
                if (dp) dp.style.paddingBottom = `${HEADER_H}px`;
                return;
            }

            if (dp) dp.style.paddingBottom = '';
            const rp = document.getElementById('right-pane');
            if (!rp) return;
            const rpRect = rp.getBoundingClientRect();
            drawer.style.left     = '0';
            drawer.style.right    = (window.innerWidth - rpRect.left) + 'px';
            drawer.style.width    = '';
            drawer.style.minWidth = mobileLay ? '' : Math.max(rpRect.left, 360) + 'px';
        }

        _fitTodiagramPane();

        let rpObserver = null;
        const rp_el = document.getElementById('right-pane');
        if (rp_el && window.ResizeObserver) {
            rpObserver = new ResizeObserver(_fitTodiagramPane);
            rpObserver.observe(rp_el);
        }
        function _onResize() {
            _fitTodiagramPane();
            setIsMobile(window.innerWidth <= 700);
        }
        window.addEventListener('resize', _onResize);
        window._onPanOffsetChange = _fitTodiagramPane;

        // ── Touch drag (mobile) ─────────────────────────────────────────────────
        let _headerDragOccurred = false;
        let _touchDragStartY    = 0;
        let _touchDragStartMaxH = 0;

        const onTouchStart = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            _headerDragOccurred = false;
            _touchDragStartY    = e.touches[0].clientY;
            _touchDragStartMaxH = tableWrap?.offsetHeight || parseInt(tableWrap?.style.maxHeight) || 0;
            drawer.style.transition = 'none';
            e.stopPropagation();
        };

        const onTouchMove = (e) => {
            const dy = _touchDragStartY - e.touches[0].clientY;
            if (Math.abs(dy) < 6) return;
            _headerDragOccurred = true;
            if (collapsedRef.current) {
                drawer.style.transition = 'none';
                setCollapsed(false);
            }
            if (tableWrap) {
                const maxAllowed = window.innerHeight * 0.9 - header.offsetHeight - _toolbarClearance();
                const newH = Math.max(40, Math.min(maxAllowed, _touchDragStartMaxH + dy));
                tableWrap.style.maxHeight = newH + 'px';
            }
            e.stopPropagation();
        };

        const onTouchEnd = (e) => {
            drawer.style.transition = '';
            if (tableWrap && parseInt(tableWrap.style.maxHeight) < 30) {
                setCollapsed(true);
            }
            e.stopPropagation();
        };

        header.addEventListener('touchstart', onTouchStart, { passive: true });
        header.addEventListener('touchmove',  onTouchMove,  { passive: true });
        header.addEventListener('touchend',   onTouchEnd,   { passive: true });

        // ── Header click (collapse toggle) ──────────────────────────────────────
        const onHeaderClick = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            if (_headerDragOccurred) { _headerDragOccurred = false; return; }
            setCollapsed(prev => !prev);
            requestAnimationFrame(() => window._fitDiagramAboveDrawer?.(drawer));
            drawer.addEventListener('transitionend',
                () => window._fitDiagramAboveDrawer?.(drawer),
                { once: true });
        };
        header.addEventListener('click', onHeaderClick);

        // ── Desktop drag-to-move ────────────────────────────────────────────────
        let dragging = false, dragOffX = 0, dragOffY = 0;
        let _pendingDrag = false, _pendingX = 0, _pendingY = 0, _pendingRect = null;
        const DRAG_THRESHOLD = 5;

        const onMouseDown = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            if (collapsedRef.current) return; // tap on collapsed header = expand, not drag
            _pendingDrag = true;
            _pendingX    = e.clientX;
            _pendingY    = e.clientY;
            _pendingRect = drawer.getBoundingClientRect();
            e.preventDefault();
        };

        const onMouseMove = (e) => {
            if (_pendingDrag) {
                const dx = Math.abs(e.clientX - _pendingX);
                const dy = Math.abs(e.clientY - _pendingY);
                if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
                    _pendingDrag = false;
                    dragging     = true;
                    const rect   = _pendingRect;
                    dragOffX     = _pendingX - rect.left;
                    dragOffY     = _pendingY - rect.top;
                    drawer.style.top    = `${rect.top}px`;
                    drawer.style.left   = `${rect.left}px`;
                    drawer.style.right  = 'auto';
                    drawer.style.bottom = 'auto';
                    header.style.cursor = 'grabbing';
                    _headerDragOccurred = true;
                }
            }
            if (!dragging) return;
            drawer.style.left = `${e.clientX - dragOffX}px`;
            drawer.style.top  = `${e.clientY - dragOffY}px`;
        };

        const onMouseUp = () => {
            _pendingDrag = false;
            if (!dragging) return;
            dragging = false;
            header.style.cursor = 'grab';
            drawer.style.top  = '';
            drawer.style.left = '';
            _fitTodiagramPane();
            drawer.style.bottom = '0';
        };

        if (!isMobile) {
            header.addEventListener('mousedown', onMouseDown);
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup',   onMouseUp);
        }

        return () => {
            rpObserver?.disconnect();
            window.removeEventListener('resize', _onResize);
            if (window._onPanOffsetChange === _fitTodiagramPane) window._onPanOffsetChange = null;
            header.removeEventListener('touchstart', onTouchStart);
            header.removeEventListener('touchmove',  onTouchMove);
            header.removeEventListener('touchend',   onTouchEnd);
            header.removeEventListener('click', onHeaderClick);
            if (!isMobile) {
                header.removeEventListener('mousedown', onMouseDown);
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup',   onMouseUp);
            }
            const dp = document.getElementById('diagram-pane');
            if (dp) dp.style.paddingBottom = '';
        };
    }, []);

    // ── Render ─────────────────────────────────────────────────────────────────
    const p   = isMobile ? '14px 16px' : '7px 10px';
    const hfs = isMobile ? '14px' : '11px';
    const thp = `${isMobile ? '8px' : '5px'} 8px`;

    return html`<div
        id="test-results-drawer"
        ref=${drawerRef}
        style=${{
            position:      'fixed',
            background:    '#1c1e21',
            color:         '#abb2bf',
            fontFamily:    "'Courier New', monospace",
            fontSize:      '12px',
            border:        '2px solid #444',
            borderBottom:  'none',
            display:       'flex',
            flexDirection: 'column',
            zIndex:        1000,
            boxShadow:     '-4px -4px 16px rgba(0,0,0,0.4)',
            borderRadius:  '6px 6px 0 0',
        }}
    >
        <div
            ref=${headerRef}
            style=${{
                padding:      p,
                background:   '#282c34',
                borderBottom: '1px solid #444',
                display:      'flex',
                alignItems:   'center',
                gap:          '8px',
                cursor:       isMobile ? 'pointer' : 'grab',
                borderRadius: '4px 4px 0 0',
                flexShrink:   0,
                userSelect:   'none',
                minHeight:    HEADER_H + 'px',
                boxSizing:    'border-box',
            }}
        >
            <span style=${{ color: '#61dafb', fontWeight: 'bold', flex: 1, fontSize: hfs }}>🧪 ${config.id}</span>
            <span style=${{ color: summaryColor, fontWeight: 'bold', fontSize: hfs }}>${summaryText}</span>
            <span style=${{ color: '#888', fontSize: hfs, padding: '0 2px', pointerEvents: 'none' }}>${collapsed ? '▼' : '▲'}</span>
        </div>

        <div
            ref=${subHeaderRef}
            style=${{
                padding:        '3px 10px',
                background:     '#282c34',
                borderBottom:   '1px solid #333',
                display:        'flex',
                justifyContent: 'space-between',
                alignItems:     'center',
                flexShrink:     0,
                fontSize:       '10px',
                color:          '#666',
            }}
        >
            <span>Run at ${new Date(runAt).toLocaleTimeString()}</span>
        </div>

        <div
            ref=${tableWrapRef}
            style=${{ overflowY: 'auto', flex: 1 }}
        >
            <table style=${{ width: '100%', borderCollapse: 'collapse', fontSize: isMobile ? '13px' : '11px' }}>
                <thead>
                    <tr style=${{ background: '#2c313a', color: '#61dafb', textAlign: 'left', position: 'sticky', top: 0 }}>
                        <th style=${{ padding: thp, width: '28px' }}>#</th>
                        <th style=${{ padding: thp, width: '20px' }}></th>
                        <th style=${{ padding: thp }}>Trace</th>
                        <th style=${{ padding: thp, width: '90px' }}>Final state</th>
                        <th style=${{ padding: thp, width: '52px' }}></th>
                    </tr>
                </thead>
                <tbody>
                    <${TraceRows}
                        rows=${rows}
                        isMobile=${isMobile}
                        selectedIdx=${selection.selectedIdx}
                        openDiffIdx=${selection.openDiffIdx}
                        onSelect=${handleSelect}
                        onRerun=${onRerun}
                        config=${config}
                    />
                </tbody>
            </table>
        </div>
    </div>`;
}

// ── Mount function ─────────────────────────────────────────────────────────────

export function mountResultsDrawer(config, summaryText, runAt, { onRowSelect, onRerun } = {}) {
    const container    = document.createElement('div');
    const imperativeRef = { triggerSelect: null };
    document.body.appendChild(container);

    const state = { config, summaryText, summaryColor: '#888', rows: [], runAt };

    function rerender() {
        render(html`<${ResultsDrawer}
            config=${state.config}
            summaryText=${state.summaryText}
            summaryColor=${state.summaryColor}
            rows=${state.rows}
            runAt=${state.runAt}
            onRowSelect=${onRowSelect}
            onRerun=${onRerun}
            imperativeRef=${imperativeRef}
        />`, container);
    }

    function update(patch) { Object.assign(state, patch); rerender(); }

    rerender();

    return {
        updateRow(i, status, c) {
            update({ rows: state.rows.map((r, idx) => idx === i ? { ...r, status, case: c } : r) });
        },
        setSummary(text, color) { update({ summaryText: text, summaryColor: color }); },
        setRows(newRows, newConfig) {
            update(newConfig ? { rows: newRows, config: newConfig } : { rows: newRows });
        },
        selectRow(i)  { imperativeRef.triggerSelect?.(i); },
        forceExpand() { imperativeRef.forceExpand?.(); },
        remove()      { render(null, container); container.remove(); },
    };
}
