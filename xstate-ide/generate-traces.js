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

// Per-invoke-state extra delay in ms. Keyed by state id.
// Set to match the simulated network delay in realtor-services.js (or equivalent).
// If a state is not listed here, INVOKE_FALLBACK_MS is used for any invoke state.
const INVOKE_DELAYS = {
    emailTranscript:  800,
    uploadContext:    600,
    send_transcript:  800,
    upload_context:   600,
};
const INVOKE_FALLBACK_MS = 800;
const STEP_MS            = 600;   // Runtime.replay() delay per step
const STARTUP_MS         = 50;    // _replayTrace startup delay
const BUFFER_MS          = 600;   // extra buffer after last step

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
            console.warn(`⚠️  Cycle detected at "${stateId}", stopping this branch.`);
            paths.push([...trace, `[CYCLE:${stateId}]`]);
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
            const target = state.invoke.onDone?.target;
            if (target) walk(target, trace, nextVisited);
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

// ── Duration estimator ────────────────────────────────────────────────────────

/**
 * Estimate how long a replay will take by walking the path the trace takes
 * through the machine and summing up step delays + any invoke state delays.
 */
function estimateDuration(trace, config) {
    let ms       = STARTUP_MS;
    let stateId  = config.initial;

    for (const item of trace) {
        ms += STEP_MS;

        const state = config.states[stateId];
        if (!state) break;

        // Check for invoke on the current state (fires automatically before user can act)
        if (state.invoke) {
            const invId = state.invoke.id ?? stateId;
            ms += INVOKE_DELAYS[invId] ?? INVOKE_DELAYS[stateId] ?? INVOKE_FALLBACK_MS;
        }

        // Advance to next state by following the trace item
        let nextStateId = null;

        if (state.on) {
            for (const [eventType, transition] of Object.entries(state.on)) {
                const isMatch = eventType === 'SUBMIT'
                    ? (SAMPLE_INPUTS[stateId] === item || typeof item === 'string' && eventType === 'SUBMIT')
                    : eventType === item;

                if (isMatch) {
                    const branches = Array.isArray(transition) ? transition : [transition];
                    const branch   = branches.find(b => b?.target);
                    nextStateId    = branch?.target ?? null;
                    break;
                }
            }
        }

        if (!nextStateId) break;
        stateId = nextStateId;

        // Check if the destination state is an invoke-only state (auto-transition)
        const nextState = config.states[stateId];
        if (nextState?.invoke && !nextState?.on) {
            const invId = nextState.invoke.id ?? stateId;
            ms += INVOKE_DELAYS[invId] ?? INVOKE_DELAYS[stateId] ?? INVOKE_FALLBACK_MS;
        }
    }

    return ms + BUFFER_MS;
}

// ── Trace comparison ──────────────────────────────────────────────────────────

function compareTraces(expected, actual) {
    const diffs = [];
    if (expected.length !== actual.length) {
        diffs.push(`length mismatch: expected ${expected.length} steps, got ${actual.length}`);
    }
    const len = Math.max(expected.length, actual.length);
    for (let i = 0; i < len; i++) {
        if (expected[i] !== actual[i]) {
            diffs.push(`step ${i + 1}: expected "${expected[i] ?? '(missing)'}", got "${actual[i] ?? '(missing)'}"`);
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

        const expected       = traces[i];
        const replayDuration = estimateDuration(expected, config);

        showStatusBadge(`Running ${i + 1} / ${total}…`, true);
        console.log(`\n▶ Path ${i + 1} / ${total} (est. ${replayDuration}ms): ${JSON.stringify(expected)}`);

        replayFn(JSON.stringify(expected));
        await new Promise(r => setTimeout(r, replayDuration));

        if (_interrupted) {
            console.warn(`⛔ Stopped after ${i + 1} of ${total} paths`);
            break;
        }

        const actual            = getTrace();
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

// ── Results drawer ────────────────────────────────────────────────────────────

export function showResultsDrawer(results, replayFn) {
    document.getElementById('test-results-drawer')?.remove();

    const { cases, passed, failed, total, runAt, flowId, config } = results;
    replayFn = replayFn ?? window._replayTrace;

    const isMobile   = window.innerWidth <= 700;
    const HEADER_H   = isMobile ? 52 : 36;   // px — height of the title bar
    let   collapsed  = isMobile;              // start collapsed on mobile, open on desktop

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

    const collapseBtn = document.createElement('button');
    collapseBtn.style.cssText = `background:none; border:none; color:#888; font-size:${isMobile ? '18px' : '12px'}; cursor:pointer; padding:0 4px;`;

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
    header.appendChild(collapseBtn);
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

        // Populate replay input and wire ▶ to use saved config
        const replayInput = document.getElementById('replay-input');
        if (replayInput) {
            replayInput.value = JSON.stringify(c.expected);
            const replayBtn = replayInput.nextElementSibling;
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
    function applyCollapsed() {
        if (isMobile) {
            // Slide drawer down until only the header peeks above the bottom edge
            const fullH = drawer.offsetHeight;
            const bodyH = subHeader.offsetHeight + tableWrap.offsetHeight;
            drawer.style.transform = collapsed ? `translateY(${bodyH}px)` : 'translateY(0)';
            collapseBtn.innerText = collapsed ? '▲' : '▼';
            collapseBtn.title     = collapsed ? 'Expand' : 'Collapse';
        } else {
            subHeader.style.display = collapsed ? 'none' : '';
            tableWrap.style.display = collapsed ? 'none' : '';
            collapseBtn.innerText   = collapsed ? '▲' : '▼';
            collapseBtn.title       = collapsed ? 'Expand' : 'Collapse';
        }
    }

    // Need one rAF after append so offsetHeight is populated
    requestAnimationFrame(() => {
        applyCollapsed();
        // Auto-select first row
        if (firstTr && firstCase) selectRow(firstCase, firstTr, null);
    });

    collapseBtn.onclick = (e) => {
        e.stopPropagation();
        collapsed = !collapsed;
        applyCollapsed();
    };
    // On mobile, tapping anywhere on the header also toggles
    if (isMobile) {
        header.onclick = (e) => {
            if (e.target === closeBtn || e.target === collapseBtn) return;
            collapsed = !collapsed;
            applyCollapsed();
        };
    }

    // ── Desktop drag to move ───────────────────────────────────────────────────
    if (!isMobile) {
        let dragging = false, dragOffX = 0, dragOffY = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target === closeBtn || e.target === collapseBtn) return;
            dragging = true;
            const rect = drawer.getBoundingClientRect();
            dragOffX   = e.clientX - rect.left;
            dragOffY   = e.clientY - rect.top;
            header.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            drawer.style.left   = `${e.clientX - dragOffX}px`;
            drawer.style.top    = `${e.clientY - dragOffY}px`;
            drawer.style.right  = 'auto';
            drawer.style.bottom = 'auto';
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
    reader.onload = (e) => {
        try {
            const results = JSON.parse(e.target.result);
            window._testResults = results;
            showResultsDrawer(results, window._replayTrace);
            console.log(`✅ Loaded ${results.cases?.length} test cases from file`);
        } catch (err) {
            console.error('❌ Failed to parse results JSON:', err.message);
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
