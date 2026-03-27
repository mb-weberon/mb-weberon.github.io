import { Runtime } from './Runtime.js';

/**
 * generate-traces.js
 *
 * Enumerates every possible path through a machine config and either
 * logs them to the console or runs them one after another in the IDE,
 * capturing chat bubbles, final state, final context, and pass/fail.
 *
 * After runAllTraces() completes a results drawer appears in the IDE.
 * The drawer is draggable, collapsible, and can be loaded from a saved JSON.
 *
 * Usage (browser console):
 *   generateTraces()          — log all trace arrays
 *   runAllTraces()            — replay every path, self-test, show results drawer
 *   runAllTraces(2000)        — same with 2s pause between paths (default 1500ms)
 *   downloadTestResults()     — save last results as JSON
 *   loadTestResults(file)     — load a saved results JSON into the drawer
 *
 * For text-input states (meta.input === 'text') add a sample value in
 * SAMPLE_INPUTS keyed by state id.
 */

const SAMPLE_INPUTS = {
    // realtor_bot
    ask_email: 'test@example.com',
    ask_phone: '4155550123',
    // ucbs_bot (ask_phone and ask_email reuse the same keys above)
};


// ── Path enumeration ──────────────────────────────────────────────────────────

export function getAllTraces(config) {
    const paths = [];

    function walk(stateId, trace, visited) {
        const state = config.states[stateId];
        if (!state) return;

        if (state.type === 'final') {
            paths.push([...trace]);
            return;
        }

        if (visited.has(stateId)) {
            // Cycle — emit the valid prefix (machines without a final state, e.g. IDE
            // shells, produce only cyclic paths; the prefix is a meaningful test case).
            if (trace.length > 0) paths.push([...trace]);
            return;
        }

        const nextVisited = new Set(visited).add(stateId);

        if (state.always) {
            const branches = Array.isArray(state.always) ? state.always : [state.always];
            branches.forEach(branch => {
                const target = branch.target ?? branch;
                if (target) walk(target, trace, nextVisited);
            });
            return;
        }

        if (state.invoke && !state.on) {
            const onDone = state.invoke.onDone;
            if (Array.isArray(onDone)) {
                // Guarded branches depend on service return values — only the
                // unguarded fallback is reliably reachable with fixed mock services.
                const fallback = onDone.find(b => !b.guard);
                if (fallback?.target) walk(fallback.target, trace, nextVisited);
            } else if (onDone?.target) {
                walk(onDone.target, trace, nextVisited);
            }
            return;
        }

        if (state.on) {
            Object.entries(state.on).forEach(([eventType, transition]) => {
                const branches = Array.isArray(transition) ? transition : [transition];
                const branch   = branches.find(b => b?.target);
                if (!branch?.target) return;

                if (eventType === 'SUBMIT') {
                    const sample = SAMPLE_INPUTS[stateId] ?? 'sample-input';
                    walk(branch.target, [...trace, sample], nextVisited);
                } else {
                    walk(branch.target, [...trace, eventType], nextVisited);
                }
            });
        }
    }

    walk(config.initial, [], new Set());
    return paths;
}

export function generateTraces(config) {
    const traces = getAllTraces(config);
    console.group(`🗺️  All paths (${traces.length} total)`);
    traces.forEach((trace, i) => {
        console.log(`\nPath ${i + 1} of ${traces.length}:`);
        console.log(JSON.stringify(trace));
    });
    console.groupEnd();
    return traces;
}

// ── Trace comparison ──────────────────────────────────────────────────────────

/**
 * Normalise the value returned by runtime.getTrace() into a flat array of
 * step values so it can be compared against the expected flat array produced
 * by getAllTraces().
 *
 * getTrace() now returns the enriched _trace envelope:
 *   { flowId, flowVersion, sessionId, startedAt, steps: [...] }
 *
 * Each step is one of:
 *   { stateId, value, at, ms }                — normal state-advance step  ← KEEP
 *   { stateId, valid: false, value, at, ms }   — validation failure         ← SKIP
 *   { stateId, service, ok, result, at, ms }   — service call result        ← SKIP
 *
 * For the legacy flat-array format (pre-Phase-5) we pass it through as-is.
 */
function normaliseActualTrace(raw) {
    if (Array.isArray(raw)) return raw;           // legacy flat array
    if (Array.isArray(raw?.steps)) {
        return raw.steps
            .filter(s => s.valid !== false && !s.service)
            .map(s => s.value);
    }
    return [];   // unrecognised — fail gracefully
}

function compareTraces(expected, actual) {
    const actualValues = normaliseActualTrace(actual);
    const diffs = [];
    if (expected.length !== actualValues.length) {
        diffs.push(`length mismatch: expected ${expected.length} steps, got ${actualValues.length}`);
    }
    const len = Math.max(expected.length, actualValues.length);
    for (let i = 0; i < len; i++) {
        if (expected[i] !== actualValues[i]) {
            diffs.push(`step ${i + 1}: expected "${expected[i] ?? '(missing)'}", got "${actualValues[i] ?? '(missing)'}"`);
        }
    }
    return { passed: diffs.length === 0, diffs };
}

function captureBubbles() {
    const msgs = document.getElementById('messages');
    if (!msgs) return [];
    return Array.from(msgs.querySelectorAll('.msg')).map(el => ({
        side: el.classList.contains('bot') ? 'bot' : 'user',
        text: el.innerText,
    }));
}

// ── Interrupt flag ────────────────────────────────────────────────────────────

let _interrupted = false;

export function stopAllTraces() {
    _interrupted = true;
    console.warn('⛔ Test run interrupted by user');
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function runAllTraces(config, replayFn, getTrace, getStateId, pauseMs = 1500) {
    _interrupted = false;
    // Remove any existing results drawer so the UI is clean while tests run
    document.getElementById('test-results-drawer')?.remove();
    const diagPane = document.getElementById('diagram-pane');
    if (diagPane) diagPane.style.paddingBottom = '';
    const traces = getAllTraces(config);
    const total  = traces.length;
    const cases  = [];

    showStatusBadge(`Running 0 / ${total}…`, true);
    console.group(`▶▶ Running all ${total} paths`);

    for (let i = 0; i < total; i++) {
        if (_interrupted) {
            console.warn(`⛔ Stopped after ${i} of ${total} paths`);
            break;
        }

        const expected = traces[i];

        showStatusBadge(`Running ${i + 1} / ${total}…`, true);
        console.log(`\n▶ Path ${i + 1} / ${total}: ${JSON.stringify(expected)}`);

        // Wait for replay to signal completion via onReplayDone instead of
        // using a hardcoded timer. This eliminates all timing-based flakiness.
        await new Promise(resolve => {
            window.currentRuntime.onReplayDone = resolve;
            replayFn(JSON.stringify(expected));
        });
        // Clear the hook so stray calls from manual replays don't fire
        window.currentRuntime.onReplayDone = null;

        if (_interrupted) {
            console.warn(`⛔ Stopped after ${i + 1} of ${total} paths`);
            break;
        }

        const actual            = normaliseActualTrace(getTrace());
        const finalStateId      = getStateId();
        const finalContext      = { ...window.currentRuntime.actor.getSnapshot().context };
        const bubbles           = captureBubbles();
        const visitedEdges      = window._visitedEdges ? [...window._visitedEdges] : [];
        const { passed, diffs } = compareTraces(expected, actual);

        if (passed) {
            console.log(`  ✅ PASS  (final state: ${finalStateId})`);
        } else {
            console.warn(`  ❌ FAIL  (final state: ${finalStateId})`);
            diffs.forEach(d => console.warn(`     ${d}`));
        }

        cases.push({ path: i + 1, passed, expected, actual, diffs, finalStateId, finalContext, bubbles, visitedEdges });

        await new Promise(r => setTimeout(r, pauseMs));
    }

    const passCount = cases.filter(c => c.passed).length;
    const failCount = cases.filter(c => !c.passed).length;

    console.log(`\n${'─'.repeat(40)}`);
    if (failCount === 0) {
        console.log(`✅ All ${cases.length} paths passed`);
    } else {
        console.warn(`❌ ${failCount} of ${cases.length} paths failed`);
    }
    console.groupEnd();

    const results = {
        runAt:   new Date().toISOString(),
        flowId:  config.id,
        total:   cases.length,
        passed:  passCount,
        failed:  failCount,
        config,
        cases,
    };

    window._testResults = results;
    hideStatusBadge();
    showResultsDrawer(results, replayFn);

    console.log('💾 Results saved to window._testResults');

    return results;
}

// ── Headless runner ───────────────────────────────────────────────────────────
//
// Runs all paths without touching the DOM during replay — no ChatUI rendering,
// no inter-path delays. One fresh Runtime per path, keyboard listeners skipped.
// Significantly faster than runAllTraces for machines with many paths.
//
// Usage:
//   runAllTraces()       — headless, instant (default)
//   runAllTraces(500)    — headless with 500ms pause between paths (for watching)

export async function runAllTracesHeadless(config, services, { pauseMs = 0, servicesSource = null } = {}) {
    _interrupted = false;
    document.getElementById('test-results-drawer')?.remove();
    const diagPane = document.getElementById('diagram-pane');
    if (diagPane) diagPane.style.paddingBottom = '';

    const traces = getAllTraces(config);
    const total  = traces.length;
    const cases  = [];

    showStatusBadge(`Running 0 / ${total}…`, true);
    console.group(`▶▶ Running all ${total} paths (headless)`);

    for (let i = 0; i < total; i++) {
        if (_interrupted) {
            console.warn(`⛔ Stopped after ${i} of ${total} paths`);
            break;
        }

        const expected = traces[i];
        showStatusBadge(`Running ${i + 1} / ${total}…`, true);
        console.log(`\n▶ Path ${i + 1} / ${total}: ${JSON.stringify(expected)}`);

        const runtime      = new Runtime(config, services, undefined, { headless: true });
        const bubbles      = [];
        const visitedEdges = [];
        let   _lastStateId = null;

        runtime.onSnapshot = (snap) => {
            if (snap.message) bubbles.push({ side: 'bot', text: snap.message });
            if (_lastStateId && _lastStateId !== snap.stateId) {
                const trace = snap.context?.trace ?? [];
                if (trace.length) visitedEdges.push(`${_lastStateId}|${trace[trace.length - 1]}`);
            }
            _lastStateId = snap.stateId;
        };
        runtime.onReplayStep = (item) => bubbles.push({ side: 'user', text: item });

        runtime.start();
        await runtime.replay(JSON.stringify(expected));

        const snap         = runtime.actor.getSnapshot();
        const finalStateId = typeof snap.value === 'string' ? snap.value : Object.keys(snap.value)[0];
        const finalContext = { ...snap.context };
        const actual       = normaliseActualTrace(runtime.getTrace());
        const { passed, diffs } = compareTraces(expected, actual);

        runtime.actor.stop();

        if (passed) {
            console.log(`  ✅ PASS  (final state: ${finalStateId})`);
        } else {
            console.warn(`  ❌ FAIL  (final state: ${finalStateId})`);
            diffs.forEach(d => console.warn(`     ${d}`));
        }

        cases.push({ path: i + 1, passed, expected, actual, diffs, finalStateId, finalContext, bubbles, visitedEdges });

        if (pauseMs > 0) await new Promise(r => setTimeout(r, pauseMs));
    }

    const passCount = cases.filter(c => c.passed).length;
    const failCount = cases.filter(c => !c.passed).length;

    console.log(`\n${'─'.repeat(40)}`);
    if (failCount === 0) {
        console.log(`✅ All ${cases.length} paths passed`);
    } else {
        console.warn(`❌ ${failCount} of ${cases.length} paths failed`);
    }
    console.groupEnd();

    const results = {
        runAt:   new Date().toISOString(),
        flowId:  config.id,
        total:   cases.length,
        passed:  passCount,
        failed:  failCount,
        config,
        servicesSource,
        cases,
    };

    window._testResults = results;
    hideStatusBadge();
    showResultsDrawer(results);

    console.log('💾 Results saved to window._testResults');
    return results;
}

// ── Results drawer ────────────────────────────────────────────────────────────

export function showResultsDrawer(results, replayFn) {
    document.getElementById('test-results-drawer')?.remove();

    const { cases, passed, failed, total, runAt, flowId, config } = results;
    replayFn = replayFn ?? window._replayTrace;

    const isMobile   = window.innerWidth <= 700;
    const HEADER_H   = isMobile ? 52 : 36;   // px — height of the title bar
    let   collapsed  = isMobile ? true : false;               // always start collapsed

    // ── Drawer shell ──────────────────────────────────────────────────────────
    const drawer = document.createElement('div');
    drawer.id = 'test-results-drawer';
    drawer.style.cssText = `
        position: fixed;
        bottom: 0;
        ${isMobile ? 'left:0; right:0; width:100%;' : 'right:420px; width:400px;'}
        background: #1c1e21;
        color: #abb2bf;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        border: 2px solid #444;
        border-bottom: none;
        display: flex;
        flex-direction: column;
        z-index: 1000;
        box-shadow: -4px -4px 16px rgba(0,0,0,0.4);
        border-radius: 6px 6px 0 0;
        transition: transform 0.3s ease;
    `;

    // ── Header ────────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = `
        padding: ${isMobile ? '14px 16px' : '7px 10px'};
        background: #282c34;
        border-bottom: 1px solid #444;
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: ${isMobile ? 'pointer' : 'grab'};
        border-radius: 4px 4px 0 0;
        flex-shrink: 0;
        user-select: none;
        min-height: ${HEADER_H}px;
        box-sizing: border-box;
    `;

    const passColor  = failed === 0 ? '#98c379' : '#e06c75';

    const titleSpan = document.createElement('span');
    titleSpan.style.cssText = `color:#61dafb; font-weight:bold; flex:1; font-size:${isMobile ? '14px' : '11px'};`;
    titleSpan.innerText = `🧪 ${flowId}`;

    const summarySpan = document.createElement('span');
    summarySpan.style.cssText = `color:${passColor}; font-weight:bold; font-size:${isMobile ? '14px' : '11px'};`;
    summarySpan.innerText = `${passed}/${total} passed`;

    const closeBtn = document.createElement('button');
    closeBtn.innerText = '✕';
    closeBtn.title = 'Close';
    closeBtn.style.cssText = `background:none; border:none; color:#888; font-size:${isMobile ? '18px' : '12px'}; cursor:pointer; padding:0 4px;`;
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        drawer.remove();
        reserveBottomSpace(0);
    };

    header.appendChild(titleSpan);
    header.appendChild(summarySpan);
    header.appendChild(closeBtn);

    // ── Sub-header ────────────────────────────────────────────────────────────
    const subHeader = document.createElement('div');
    subHeader.style.cssText = `
        padding: 3px 10px;
        background: #282c34;
        border-bottom: 1px solid #333;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
        font-size: 10px;
        color: #666;
    `;
    subHeader.innerHTML = `<span>Run at ${new Date(runAt).toLocaleTimeString()}</span>`;

    const dlBtn = document.createElement('button');
    dlBtn.innerText = '💾 Download JSON';
    dlBtn.style.cssText = `background:#333; border:none; color:#abb2bf; font-size:10px; padding:2px 6px; border-radius:3px; cursor:pointer;`;
    dlBtn.onclick = () => window.downloadTestResults?.();
    subHeader.appendChild(dlBtn);

    // ── Table ─────────────────────────────────────────────────────────────────
    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = `overflow-y:auto; flex:1; max-height:${isMobile ? '50vh' : '40vh'};`;

    const table = document.createElement('table');
    table.style.cssText = `width:100%; border-collapse:collapse; font-size:${isMobile ? '13px' : '11px'};`;
    table.innerHTML = `
        <thead>
            <tr style="background:#2c313a; color:#61dafb; text-align:left; position:sticky; top:0;">
                <th style="padding:${isMobile ? '8px' : '5px'} 8px; width:28px;">#</th>
                <th style="padding:${isMobile ? '8px' : '5px'} 8px; width:36px;"></th>
                <th style="padding:${isMobile ? '8px' : '5px'} 8px;">Trace</th>
                <th style="padding:${isMobile ? '8px' : '5px'} 8px; width:90px;">Final state</th>
            </tr>
        </thead>
    `;

    const tbody     = document.createElement('tbody');
    let selectedRow = null;

    // ── Row click handler (extracted so we can call it programmatically) ───────
    const selectRow = (c, tr, diffRow) => {
        if (selectedRow) { selectedRow.style.background = ''; selectedRow.style.outline = ''; }
        selectedRow = tr;
        tr.style.background = '#2d3a4a';
        tr.style.outline    = '1px solid #0084ff';
        if (diffRow) diffRow.style.display = diffRow.style.display === 'none' ? '' : 'none';

        // Populate replay bar and wire ▶ to use saved config
        const replayInput = document.getElementById('replay-input');
        if (replayInput) {
            replayInput.value = JSON.stringify(c.expected);
            // Show the replay bar (it is hidden by default)
            const replayBar = document.getElementById('replay-bar');
            if (replayBar) replayBar.classList.add('visible');
            // ▶ button is the first child of replay-bar (order: ▶, ✕, input)
            const replayBtn = document.getElementById('replay-go-btn');
            if (replayBtn) replayBtn.onclick = () => window._replayTrace(replayInput.value, config);
        }

        // Restore chat bubbles
        const messages = document.getElementById('messages');
        if (messages && c.bubbles?.length) {
            messages.innerHTML = '';
            c.bubbles.forEach(b => {
                const d     = document.createElement('div');
                d.className = `msg ${b.side}`;
                d.innerText = b.text;
                messages.appendChild(d);
            });
            messages.scrollTop = messages.scrollHeight;
        }

        // Restore context viewer
        const profile      = document.getElementById('profile-view');
        const stateDisplay = document.getElementById('state-id');
        if (profile)      profile.innerText      = JSON.stringify(c.finalContext, null, 2);
        if (stateDisplay) stateDisplay.innerText = `State: ${c.finalStateId}`;

        // Re-render diagram with captured visited edges and saved config
        if (window.renderDiagram) {
            window.renderDiagram(
                config ?? window._config,
                c.finalStateId,
                new Set(c.visitedEdges ?? [])
            ).catch(() => {});
        }
    };

    let firstTr = null, firstCase = null;

    cases.forEach((c) => {
        const tr = document.createElement('tr');
        tr.style.cssText = `cursor:pointer; border-bottom:1px solid #2c313a; transition:background 0.1s;`;
        tr.innerHTML = `
            <td style="padding:${isMobile ? '8px' : '5px'} 8px; color:#666;">${c.path}</td>
            <td style="padding:${isMobile ? '8px' : '5px'} 8px; font-size:${isMobile ? '16px' : '13px'};">${c.passed ? '✅' : '❌'}</td>
            <td style="padding:${isMobile ? '8px' : '5px'} 8px; color:#abb2bf; max-width:160px; overflow:hidden;
                text-overflow:ellipsis; white-space:nowrap;"
                title="${c.expected.join(' → ')}">${c.expected.join(' → ')}</td>
            <td style="padding:${isMobile ? '8px' : '5px'} 8px; color:${c.passed ? '#98c379' : '#e06c75'};">${c.finalStateId}</td>
        `;

        let diffRow = null;
        if (!c.passed) {
            diffRow = document.createElement('tr');
            diffRow.style.cssText = `display:none; background:#2c1e1e;`;
            diffRow.innerHTML = `
                <td colspan="4" style="padding:5px 12px; color:#e06c75; font-size:10px; line-height:1.6;">
                    ${c.diffs.map(d => `⚠ ${d}`).join('<br>')}
                </td>
            `;
        }

        tr.onmouseenter = () => { if (tr !== selectedRow) tr.style.background = '#2c313a'; };
        tr.onmouseleave = () => { if (tr !== selectedRow) tr.style.background = ''; };
        tr.onclick = () => selectRow(c, tr, diffRow);

        if (!firstTr) { firstTr = tr; firstCase = c; }

        tbody.appendChild(tr);
        if (diffRow) tbody.appendChild(diffRow);
    });

    table.appendChild(tbody);
    tableWrap.appendChild(table);

    // Start collapsed: hide body sections immediately so the drawer never
    // flashes open before applyCollapsed() runs in the rAF below.
    subHeader.style.display = 'none';
    tableWrap.style.display = 'none';

    drawer.appendChild(header);
    drawer.appendChild(subHeader);
    drawer.appendChild(tableWrap);
    document.body.appendChild(drawer);

    // ── Reserve bottom space in diagram pane ──────────────────────────────────
    function reserveBottomSpace(px) {
        const dp = document.getElementById('diagram-pane');
        if (dp) dp.style.paddingBottom = px ? `${px}px` : '';
    }
    if (isMobile) reserveBottomSpace(HEADER_H);

    // ── Collapse / expand ─────────────────────────────────────────────────────
    //
    // Both mobile and desktop use bottom-positioning (not translateY) so the
    // drawer always stays anchored above the toolbar.
    // Mobile gets an additional touch-drag handle on the header so the user
    // can drag the drawer to any height between HEADER_H and ~90vh.
    //
 
    function _toolbarClearance() {
        const toolbar = document.getElementById('toolbar');
        return toolbar ? toolbar.offsetHeight : 0;
    }

    function applyCollapsed() {
        if (collapsed) {
            // Slide drawer below viewport so only the header strip sits above toolbar.
            const fullH     = drawer.scrollHeight;
            const headerH   = header.offsetHeight;
            const clearance = _toolbarClearance();
            drawer.style.bottom    = (clearance + headerH - fullH) + 'px';
            drawer.style.transform = '';
        } else {
            drawer.style.bottom    = '0';
            drawer.style.transform = '';
        }
        // Show/hide body sections (same on both mobile and desktop)
        subHeader.style.display = collapsed ? 'none' : '';
        tableWrap.style.display = collapsed ? 'none' : '';
    }

    // Need one rAF after append so offsetHeight is populated
    requestAnimationFrame(() => {
        applyCollapsed();
        // Auto-select first row
        if (firstTr && firstCase) selectRow(firstCase, firstTr, null);
    });

    // ── Header tap/drag: toggle collapse on tap, resize on drag ─────────────
    // Shared between mobile and desktop (desktop also gets mouse drag below).
    // A "tap" is a touch/click with < 6px movement. A drag suppresses the
    // click event so the two don't fight each other.

    let _headerDragOccurred = false;

    header.addEventListener('touchstart', (e) => {
        if (e.target === closeBtn) return;
        _headerDragOccurred = false;
        _touchDragStartY    = e.touches[0].clientY;
        _touchDragStartMaxH = tableWrap.offsetHeight || parseInt(tableWrap.style.maxHeight) || 0;
        drawer.style.transition = 'none';
        e.stopPropagation();
    }, { passive: true });

    let _touchDragStartY    = 0;
    let _touchDragStartMaxH = 0;

    header.addEventListener('touchmove', (e) => {
        const dy = _touchDragStartY - e.touches[0].clientY; // up = positive = taller
        if (Math.abs(dy) < 6) return;

        _headerDragOccurred = true;

        // Expand the drawer when dragging up from collapsed
        if (collapsed) {
            collapsed = false;
            subHeader.style.display = '';
            tableWrap.style.display = '';
            drawer.style.bottom = '0';
        }

        const maxAllowed = window.innerHeight * 0.9 - header.offsetHeight - _toolbarClearance();
        const minAllowed = 40;
        const newH = Math.max(minAllowed, Math.min(maxAllowed, _touchDragStartMaxH + dy));
        tableWrap.style.maxHeight = newH + 'px';
        e.stopPropagation();
    }, { passive: true });

    header.addEventListener('touchend', (e) => {
        drawer.style.transition = '';
        // Snap fully collapsed if dragged to nearly nothing
        if (!collapsed && parseInt(tableWrap.style.maxHeight) < 30) {
            collapsed = true;
            applyCollapsed();
        }
        e.stopPropagation();
    }, { passive: true });

    // Tap (no drag): toggle collapsed state.
    // Suppressed when a drag just occurred so they don't fight.
    header.onclick = (e) => {
        if (e.target === closeBtn) return;
        if (_headerDragOccurred) { _headerDragOccurred = false; return; }
        collapsed = !collapsed;
        applyCollapsed();
    };

    // ── Desktop drag to move ───────────────────────────────────────────────────
    if (!isMobile) {
        let dragging = false, dragOffX = 0, dragOffY = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target === closeBtn) return;
            dragging = true;
            // Snapshot position now (before clearing bottom/right) so offsets are correct
            const rect = drawer.getBoundingClientRect();
            dragOffX   = e.clientX - rect.left;
            dragOffY   = e.clientY - rect.top;
            // Switch from bottom-anchored to top/left free positioning
            drawer.style.top    = `${rect.top}px`;
            drawer.style.left   = `${rect.left}px`;
            drawer.style.right  = 'auto';
            drawer.style.bottom = 'auto';
            header.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            _headerDragOccurred = true;
            drawer.style.left = `${e.clientX - dragOffX}px`;
            drawer.style.top  = `${e.clientY - dragOffY}px`;
        });

        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            header.style.cursor = 'grab';
        });
    }
}

// ── Status badge ──────────────────────────────────────────────────────────────

function showStatusBadge(text, showStop = false) {
    let badge = document.getElementById('test-status-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'test-status-badge';
        badge.style.cssText = `
            position:fixed; bottom:16px; right:16px;
            background:#282c34; color:#61dafb;
            font-family:'Courier New',monospace; font-size:12px;
            padding:6px 14px; border-radius:6px; border:1px solid #444;
            z-index:999; box-shadow:0 2px 8px rgba(0,0,0,0.4);
            display:flex; align-items:center; gap:10px;
        `;
        document.body.appendChild(badge);
    }
    badge.innerHTML = '';
    const label = document.createElement('span');
    label.innerText = text;
    badge.appendChild(label);

    if (showStop) {
        const stopBtn = document.createElement('button');
        stopBtn.innerText = '⛔ Stop';
        stopBtn.style.cssText = `background:#e06c75; border:none; color:#fff; font-size:11px; padding:2px 8px; border-radius:4px; cursor:pointer;`;
        stopBtn.onclick = () => window.stopAllTraces?.();
        badge.appendChild(stopBtn);
    }
}

function hideStatusBadge() {
    document.getElementById('test-status-badge')?.remove();
}

// ── Load results from file ────────────────────────────────────────────────────

export function loadTestResults(file) {
    if (!file) { console.warn('Pass a File object via the Load Results button.'); return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const results = JSON.parse(e.target.result);
            window._testResults = results;
            // Restore services so re-runs work
            if (results.servicesSource && window._reloadServicesFromSource) {
                await window._reloadServicesFromSource(results.servicesSource, `${results.flowId}-services.js`);
            }
            // Restore config so re-runs and diagram use the saved machine
            if (results.config && typeof window._restartRuntime === 'function') {
                window._restartRuntime(results.config);
            }
            showResultsDrawer(results, window._replayTrace);
            console.log(`✅ Loaded ${results.cases?.length} test cases from file`);
        } catch (err) {
            const m = `Invalid results JSON: ${err.message}`;
            console.error('❌', m);
            window.showToast?.(m);
        }
    };
    reader.readAsText(file);
}

// ── Download helper ───────────────────────────────────────────────────────────

export function downloadTestResults() {
    const results = window._testResults;
    if (!results) { console.warn('No test results. Run runAllTraces() first.'); return; }
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `test-results-${results.flowId}-${results.runAt.slice(0, 10)}.json`;
    a.click();
}
