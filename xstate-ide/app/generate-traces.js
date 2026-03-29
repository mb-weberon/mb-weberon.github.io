import { Runtime } from './Runtime.js';

/**
 * generate-traces.js
 *
 * Enumerates every possible path through a machine config and either
 * logs them to the console or runs them one after another in the IDE,
 * capturing chat bubbles, final state, final context, and pass/fail.
 *
 * The results drawer is built upfront before any tests run, showing all N paths
 * with live per-row status (pending → running → pass/fail/skipped). Each running
 * row has an inline Skip button. Skipped/failed rows have a ▶ Re-run button that
 * replays in the foreground IDE Runtime so console logs are visible.
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
    // subscription_management_v2
    extend_quota_check:   'extend',
    upgrade_plan_check:   'Pro',
    downgrade_plan_check: 'Starter',
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

// ── Interrupt flags ───────────────────────────────────────────────────────────

let _interrupted            = false;
let _skipCurrent            = false;
let _currentHeadlessRuntime = null;

export function stopAllTraces() {
    _interrupted = true;
    _currentHeadlessRuntime?.actor?.stop();
    console.warn('⛔ Test run interrupted by user');
}

/** Skip only the currently-running path and continue with the next one. */
export function skipCurrentTrace() {
    _skipCurrent = true;
    _currentHeadlessRuntime?.actor?.stop();
    console.warn('⏭ Skipping current path…');
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
// The results drawer is built upfront before any tests run, showing all N rows
// with "pending" status. Each row updates live. The running row shows a Skip
// button; skipped/failed rows show a ▶ Re-run button (foreground, with logs).
//
// Usage:
//   runAllTraces()       — headless, instant (default)
//   runAllTraces(500)    — headless with 500ms pause between paths (for watching)

export async function runAllTracesHeadless(config, services, { pauseMs = 0, servicesSource = null } = {}) {
    _interrupted = false;
    _skipCurrent = false;
    document.getElementById('test-results-drawer')?.remove();
    const diagPane = document.getElementById('diagram-pane');
    if (diagPane) diagPane.style.paddingBottom = '';

    const traces = getAllTraces(config);
    const total  = traces.length;
    const cases  = [];
    const runAt  = new Date().toISOString();

    // ── Build live drawer with all N rows before tests start ──────────────────
    const { summarySpan, tbody, isMobile } =
        _createDrawerShell(config, `Running… 0 / ${total}`, runAt);

    const p  = isMobile ? '8px' : '5px';
    const fs = isMobile ? '13px' : '11px';

    // One DOM ref per path row for live status updates
    const rowRefs = traces.map((expected, i) => {
        const tr = document.createElement('tr');
        tr.style.cssText = `border-bottom:1px solid #2c313a;`;

        const numCell    = _td(String(i + 1), `padding:${p} 8px; color:#666; width:28px;`);
        const statusCell = _td('⬜', `padding:${p} 8px; font-size:${isMobile ? '16px' : '13px'}; width:20px;`);
        const traceCell  = _td(expected.join(' → '), `padding:${p} 8px; color:#555; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:${fs};`);
        traceCell.title  = expected.join(' → ');
        const stateCell  = _td('—', `padding:${p} 8px; color:#555; font-size:${fs};`);
        const actionCell = _td('', `padding:${p} 4px; width:52px;`);

        tr.append(numCell, statusCell, traceCell, stateCell, actionCell);
        tbody.appendChild(tr);
        return { tr, statusCell, stateCell, actionCell, expected };
    });

    function updateRow(i, status, c = null) {
        const { statusCell, stateCell, actionCell, expected: exp } = rowRefs[i];
        const icons  = { pending: '⬜', running: '⏳', pass: '✅', fail: '❌', skipped: '⏭' };
        const colors = { pending: '#555', running: '#61dafb', pass: '#98c379', fail: '#e06c75', skipped: '#e5c07b' };
        statusCell.textContent = icons[status] ?? '?';
        if (c?.finalStateId) {
            stateCell.textContent = c.finalStateId;
            stateCell.style.color = colors[status];
        }
        actionCell.innerHTML = '';
        if (status === 'running') {
            const btn = document.createElement('button');
            btn.textContent = 'Skip';
            btn.title = 'Skip this path and continue with the next';
            btn.style.cssText = `background:#3a3a2a; border:1px solid #666; color:#e5c07b; font-size:10px; padding:2px 6px; border-radius:3px; cursor:pointer;`;
            btn.onclick = (e) => { e.stopPropagation(); window.skipCurrentTrace?.(); };
            actionCell.appendChild(btn);
        } else if (status === 'fail' || status === 'skipped') {
            const btn = document.createElement('button');
            btn.textContent = '▶';
            btn.title = 'Re-run in foreground (logs to console)';
            btn.style.cssText = `background:#2a3a3a; border:1px solid #666; color:#61dafb; font-size:10px; padding:2px 6px; border-radius:3px; cursor:pointer;`;
            btn.onclick = (e) => { e.stopPropagation(); window._replayTrace?.(JSON.stringify(exp), config); };
            actionCell.appendChild(btn);
        }
    }

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
        updateRow(i, 'running');

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
        _currentHeadlessRuntime = runtime;
        await runtime.replay(JSON.stringify(expected));
        _currentHeadlessRuntime = null;

        if (_skipCurrent) {
            _skipCurrent = false;
            runtime.actor.stop();
            console.warn(`  ⏭ SKIP  (skipped by user)`);
            const c = { path: i + 1, passed: false, skipped: true, expected, actual: [], diffs: ['skipped by user'], finalStateId: '—', finalContext: {}, bubbles: [], visitedEdges: [] };
            cases.push(c);
            updateRow(i, 'skipped', c);
            if (pauseMs > 0) await new Promise(r => setTimeout(r, pauseMs));
            continue;
        }

        if (_interrupted) {
            runtime.actor.stop();
            console.warn(`⛔ Stopped after ${i + 1} of ${total} paths`);
            break;
        }

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

        const c = { path: i + 1, passed, skipped: false, expected, actual, diffs, finalStateId, finalContext, bubbles, visitedEdges };
        cases.push(c);
        updateRow(i, passed ? 'pass' : 'fail', c);

        if (pauseMs > 0) await new Promise(r => setTimeout(r, pauseMs));
    }

    const passCount = cases.filter(c => c.passed).length;
    const failCount = cases.filter(c => !c.passed && !c.skipped).length;
    const skipCount = cases.filter(c => c.skipped).length;

    console.log(`\n${'─'.repeat(40)}`);
    if (failCount === 0 && skipCount === 0) {
        console.log(`✅ All ${cases.length} paths passed`);
    } else {
        const parts = [];
        if (failCount) parts.push(`${failCount} failed`);
        if (skipCount) parts.push(`${skipCount} skipped`);
        console.warn(`❌ ${parts.join(', ')} of ${cases.length} paths`);
    }
    console.groupEnd();

    // Finalize drawer header summary
    const passColor = failCount === 0 ? '#98c379' : '#e06c75';
    summarySpan.style.color = passColor;
    let summaryText = `${passCount}/${total} passed`;
    if (skipCount) summaryText += ` · ${skipCount} skipped`;
    summarySpan.textContent = summaryText;

    // Wire up row-click handlers now that all cases are complete
    let selectedRow = null;
    cases.forEach((c, i) => {
        if (c.skipped) return;
        const { tr } = rowRefs[i];
        tr.style.cursor = 'pointer';
        let diffRow = null;
        if (!c.passed) {
            diffRow = document.createElement('tr');
            diffRow.style.cssText = `display:none; background:#2c1e1e;`;
            diffRow.innerHTML = `<td colspan="5" style="padding:5px 12px; color:#e06c75; font-size:10px; line-height:1.6;">${c.diffs.map(d => `⚠ ${d}`).join('<br>')}</td>`;
            tr.after(diffRow);
        }
        tr.onmouseenter = () => { if (tr !== selectedRow) tr.style.background = '#2c313a'; };
        tr.onmouseleave = () => { if (tr !== selectedRow) tr.style.background = ''; };
        tr.onclick = () => {
            if (selectedRow) { selectedRow.style.background = ''; selectedRow.style.outline = ''; }
            selectedRow = tr;
            tr.style.background = '#2d3a4a';
            tr.style.outline    = '1px solid #0084ff';
            if (diffRow) diffRow.style.display = diffRow.style.display === 'none' ? '' : 'none';
            _restoreCase(c, config);
        };
    });

    const results = {
        runAt,
        flowId:  config.id,
        total:   cases.length,
        passed:  passCount,
        failed:  failCount,
        skipped: skipCount,
        config,
        servicesSource,
        cases,
    };

    window._testResults = results;
    hideStatusBadge();

    console.log('💾 Results saved to window._testResults');
    return results;
}

// ── Drawer helpers ─────────────────────────────────────────────────────────────

function _td(text, cssText) {
    const td = document.createElement('td');
    td.style.cssText = cssText;
    td.textContent   = text;
    return td;
}

/** Restore chat bubbles, context viewer, replay bar, and diagram for a case. */
function _restoreCase(c, config) {
    const replayInput = document.getElementById('replay-input');
    if (replayInput) {
        replayInput.value = JSON.stringify(c.expected);
        const replayBar = document.getElementById('replay-bar');
        if (replayBar) replayBar.classList.add('visible');
        const replayBtn = document.getElementById('replay-go-btn');
        if (replayBtn) replayBtn.onclick = () => window._replayTrace(replayInput.value, config);
    }
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
    const profile      = document.getElementById('profile-view');
    const stateDisplay = document.getElementById('state-id');
    if (profile)      profile.innerText      = JSON.stringify(c.finalContext, null, 2);
    if (stateDisplay) stateDisplay.innerText = `State: ${c.finalStateId}`;
    if (window.renderDiagram) {
        window.renderDiagram(
            config ?? window._config,
            c.finalStateId,
            new Set(c.visitedEdges ?? [])
        ).catch(() => {});
    }
}

/**
 * Create the drawer shell: header, sub-header, table, positioning,
 * collapse/expand, and drag. Appends to document.body.
 * Returns live DOM references needed by callers.
 */
function _createDrawerShell(config, summaryText, runAt) {
    const isMobile = window.innerWidth <= 700;
    const HEADER_H = isMobile ? 52 : 36;
    let collapsed  = false;

    // ── Drawer container ──────────────────────────────────────────────────────
    const drawer = document.createElement('div');
    drawer.id = 'test-results-drawer';
    drawer.style.cssText = `
        position: fixed;
        bottom: 0;
        ${isMobile ? 'left:0; right:0; width:100%;' : 'width:400px;'}
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

    const titleSpan = document.createElement('span');
    titleSpan.style.cssText = `color:#61dafb; font-weight:bold; flex:1; font-size:${isMobile ? '14px' : '11px'};`;
    titleSpan.innerText = `🧪 ${config.id}`;

    const summarySpan = document.createElement('span');
    summarySpan.style.cssText = `color:#888; font-weight:bold; font-size:${isMobile ? '14px' : '11px'};`;
    summarySpan.innerText = summaryText;

    const collapseArrow = document.createElement('span');
    collapseArrow.style.cssText = `color:#888; font-size:${isMobile ? '14px' : '11px'}; padding:0 2px; pointer-events:none;`;
    collapseArrow.textContent = '▲';

    header.appendChild(titleSpan);
    header.appendChild(summarySpan);
    header.appendChild(collapseArrow);

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

    // ── Table ─────────────────────────────────────────────────────────────────
    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = `overflow-y:auto; flex:1; max-height:${isMobile ? '50vh' : '40vh'};`;

    const table = document.createElement('table');
    table.style.cssText = `width:100%; border-collapse:collapse; font-size:${isMobile ? '13px' : '11px'};`;
    table.innerHTML = `
        <thead>
            <tr style="background:#2c313a; color:#61dafb; text-align:left; position:sticky; top:0;">
                <th style="padding:${isMobile ? '8px' : '5px'} 8px; width:28px;">#</th>
                <th style="padding:${isMobile ? '8px' : '5px'} 8px; width:20px;"></th>
                <th style="padding:${isMobile ? '8px' : '5px'} 8px;">Trace</th>
                <th style="padding:${isMobile ? '8px' : '5px'} 8px; width:90px;">Final state</th>
                <th style="padding:${isMobile ? '8px' : '5px'} 8px; width:52px;"></th>
            </tr>
        </thead>
    `;

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    tableWrap.appendChild(table);

    drawer.appendChild(header);
    drawer.appendChild(subHeader);
    drawer.appendChild(tableWrap);
    document.body.appendChild(drawer);

    // ── Pin drawer to diagram area ────────────────────────────────────────────
    let _rpObserver = null;
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
        const rpRect  = rp.getBoundingClientRect();
        const diagW   = rpRect.left;

        drawer.style.left     = '0';
        drawer.style.right    = (window.innerWidth - rpRect.left) + 'px';
        drawer.style.width    = '';
        drawer.style.minWidth = mobileLay ? '' : Math.max(diagW, 360) + 'px';
    }
    _fitTodiagramPane();
    const rp_el = document.getElementById('right-pane');
    if (rp_el && window.ResizeObserver) {
        _rpObserver = new ResizeObserver(_fitTodiagramPane);
        _rpObserver.observe(rp_el);
    }
    window.addEventListener('resize', _fitTodiagramPane);
    window._onPanOffsetChange = _fitTodiagramPane;

    const _origRemove = drawer.remove.bind(drawer);
    drawer.remove = () => {
        _rpObserver?.disconnect();
        window.removeEventListener('resize', _fitTodiagramPane);
        if (window._onPanOffsetChange === _fitTodiagramPane) window._onPanOffsetChange = null;
        _origRemove();
    };

    // ── Collapse / expand ─────────────────────────────────────────────────────
    function _toolbarClearance() {
        const toolbar = document.getElementById('toolbar');
        return toolbar ? toolbar.offsetHeight : 0;
    }

    function applyCollapsed() {
        collapseArrow.textContent = collapsed ? '▼' : '▲';
        if (isMobile) {
            drawer.style.bottom    = '0';
            drawer.style.transform = collapsed
                ? `translateY(calc(100% - ${HEADER_H}px))`
                : 'translateY(0)';
        } else {
            if (collapsed) {
                const fullH   = drawer.scrollHeight;
                const headerH = header.offsetHeight;
                drawer.style.height    = fullH + 'px';
                drawer.style.bottom    = (headerH - fullH) + 'px';
                drawer.style.transform = '';
                subHeader.style.display = 'none';
                tableWrap.style.display = 'none';
            } else {
                subHeader.style.display = '';
                tableWrap.style.display = '';
                drawer.style.height    = '';
                drawer.style.bottom    = '0';
                drawer.style.transform = '';
            }
        }
    }

    requestAnimationFrame(() => applyCollapsed());

    // ── Header tap/drag ───────────────────────────────────────────────────────
    let _headerDragOccurred = false;
    let _touchDragStartY    = 0;
    let _touchDragStartMaxH = 0;

    header.addEventListener('touchstart', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        _headerDragOccurred = false;
        _touchDragStartY    = e.touches[0].clientY;
        _touchDragStartMaxH = tableWrap.offsetHeight || parseInt(tableWrap.style.maxHeight) || 0;
        drawer.style.transition = 'none';
        e.stopPropagation();
    }, { passive: true });

    header.addEventListener('touchmove', (e) => {
        const dy = _touchDragStartY - e.touches[0].clientY;
        if (Math.abs(dy) < 6) return;
        _headerDragOccurred = true;
        if (collapsed) {
            collapsed = false;
            drawer.style.transition = 'none';
            applyCollapsed();
        }
        const maxAllowed = window.innerHeight * 0.9 - header.offsetHeight - _toolbarClearance();
        const minAllowed = 40;
        const newH = Math.max(minAllowed, Math.min(maxAllowed, _touchDragStartMaxH + dy));
        tableWrap.style.maxHeight = newH + 'px';
        e.stopPropagation();
    }, { passive: true });

    header.addEventListener('touchend', (e) => {
        drawer.style.transition = '';
        if (!collapsed && parseInt(tableWrap.style.maxHeight) < 30) {
            collapsed = true;
            applyCollapsed();
        }
        e.stopPropagation();
    }, { passive: true });

    header.onclick = (e) => {
        if (e.target.tagName === 'BUTTON') return;
        if (_headerDragOccurred) { _headerDragOccurred = false; return; }
        collapsed = !collapsed;
        applyCollapsed();
        requestAnimationFrame(() => window._fitDiagramAboveDrawer?.(drawer));
        drawer.addEventListener('transitionend',
            () => window._fitDiagramAboveDrawer?.(drawer),
            { once: true });
    };

    // ── Desktop drag to move ──────────────────────────────────────────────────
    if (!isMobile) {
        let dragging = false, dragOffX = 0, dragOffY = 0;
        let _pendingDrag = false, _pendingX = 0, _pendingY = 0, _pendingRect = null;
        const DRAG_THRESHOLD = 5;

        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            _pendingDrag = true;
            _pendingX = e.clientX;
            _pendingY = e.clientY;
            _pendingRect = drawer.getBoundingClientRect();
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (_pendingDrag) {
                const dx = Math.abs(e.clientX - _pendingX);
                const dy = Math.abs(e.clientY - _pendingY);
                if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
                    _pendingDrag = false;
                    dragging = true;
                    const rect = _pendingRect;
                    dragOffX = _pendingX - rect.left;
                    dragOffY = _pendingY - rect.top;
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
        });

        document.addEventListener('mouseup', () => {
            _pendingDrag = false;
            if (!dragging) return;
            dragging = false;
            header.style.cursor = 'grab';
            const rect = drawer.getBoundingClientRect();
            drawer.style.top  = '';
            drawer.style.left = '';
            _fitTodiagramPane();
            const snapBottom = window.innerHeight - rect.bottom;
            const minBottom  = _toolbarClearance() + header.offsetHeight - drawer.scrollHeight;
            drawer.style.bottom = Math.min(0, Math.max(minBottom, snapBottom)) + 'px';
        });
    }

    return { drawer, titleSpan, summarySpan, subHeader, tableWrap, tbody, isMobile, HEADER_H };
}

// ── Results drawer ────────────────────────────────────────────────────────────
// Used when loading saved results from file (Load Results button).

export function showResultsDrawer(results, replayFn) {
    document.getElementById('test-results-drawer')?.remove();

    const { cases, passed, failed, total, runAt, flowId, config } = results;
    replayFn = replayFn ?? window._replayTrace;

    const passColor = failed === 0 ? '#98c379' : '#e06c75';
    const summary   = `${passed}/${total} passed`;
    const skipCount = cases.filter(c => c.skipped).length;
    const summaryWithSkip = skipCount ? `${summary} · ${skipCount} skipped` : summary;

    const { summarySpan, tbody, isMobile } =
        _createDrawerShell({ id: flowId }, summaryWithSkip, runAt);
    summarySpan.style.color = passColor;

    const p  = isMobile ? '8px' : '5px';
    const fs = isMobile ? '13px' : '11px';

    let selectedRow = null;

    const selectRow = (c, tr, diffRow) => {
        if (selectedRow) { selectedRow.style.background = ''; selectedRow.style.outline = ''; }
        selectedRow = tr;
        tr.style.background = '#2d3a4a';
        tr.style.outline    = '1px solid #0084ff';
        if (diffRow) diffRow.style.display = diffRow.style.display === 'none' ? '' : 'none';
        _restoreCase(c, config);
    };

    let firstTr = null, firstCase = null;

    cases.forEach((c) => {
        const statusIcon = c.skipped ? '⏭' : (c.passed ? '✅' : '❌');
        const stateColor = c.skipped ? '#e5c07b' : (c.passed ? '#98c379' : '#e06c75');

        const tr = document.createElement('tr');
        tr.style.cssText = `cursor:pointer; border-bottom:1px solid #2c313a; transition:background 0.1s;`;

        const numCell    = _td(String(c.path), `padding:${p} 8px; color:#666; width:28px;`);
        const statusCell = _td(statusIcon, `padding:${p} 8px; font-size:${isMobile ? '16px' : '13px'}; width:20px;`);
        const traceCell  = _td(c.expected.join(' → '), `padding:${p} 8px; color:#abb2bf; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:${fs};`);
        traceCell.title  = c.expected.join(' → ');
        const stateCell  = _td(c.finalStateId, `padding:${p} 8px; color:${stateColor}; font-size:${fs};`);
        const actionCell = _td('', `padding:${p} 4px; width:52px;`);

        if (!c.passed || c.skipped) {
            const btn = document.createElement('button');
            btn.textContent = '▶';
            btn.title = 'Re-run in foreground (logs to console)';
            btn.style.cssText = `background:#2a3a3a; border:1px solid #666; color:#61dafb; font-size:10px; padding:2px 6px; border-radius:3px; cursor:pointer;`;
            btn.onclick = (e) => { e.stopPropagation(); window._replayTrace?.(JSON.stringify(c.expected), config); };
            actionCell.appendChild(btn);
        }

        tr.append(numCell, statusCell, traceCell, stateCell, actionCell);

        let diffRow = null;
        if (!c.passed && !c.skipped) {
            diffRow = document.createElement('tr');
            diffRow.style.cssText = `display:none; background:#2c1e1e;`;
            diffRow.innerHTML = `
                <td colspan="5" style="padding:5px 12px; color:#e06c75; font-size:10px; line-height:1.6;">
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

    requestAnimationFrame(() => {
        if (firstTr && firstCase) selectRow(firstCase, firstTr, null);
    });
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
            window._setSmideState?.('results_ready');  // results loaded from file — Load Results stays, Load Flow enabled
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
