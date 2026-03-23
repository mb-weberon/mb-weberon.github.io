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
 *   loadTestResults(file)     — load a saved results JSON file into the drawer
 *   downloadTestResults()     — save last results as JSON
 */

const SAMPLE_INPUTS = {
    ask_email: 'test@example.com',
    ask_phone: '4155550123',
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
        const replayDuration = 50 + (expected.length * 600) + 400;

        showStatusBadge(`Running ${i + 1} / ${total}…`, true);
        console.log(`\n▶ Path ${i + 1} / ${total}: ${JSON.stringify(expected)}`);

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
        const { passed, diffs } = compareTraces(expected, actual);

        if (passed) {
            console.log(`  ✅ PASS  (final state: ${finalStateId})`);
        } else {
            console.warn(`  ❌ FAIL  (final state: ${finalStateId})`);
            diffs.forEach(d => console.warn(`     ${d}`));
        }

        cases.push({ path: i + 1, passed, expected, actual, diffs, finalStateId, finalContext, bubbles });

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

    const { cases, passed, failed, total, runAt, flowId } = results;
    replayFn = replayFn ?? window._replayTrace;

    let collapsed = false;

    const drawer = document.createElement('div');
    drawer.id = 'test-results-drawer';
    drawer.style.cssText = `
        position: fixed;
        bottom: 0;
        right: 420px;
        width: 400px;
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
    `;

    // ── Header (drag handle) ──────────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = `
        padding: 7px 10px;
        background: #282c34;
        border-bottom: 1px solid #444;
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: grab;
        border-radius: 4px 4px 0 0;
        flex-shrink: 0;
        user-select: none;
    `;

    const passColor = failed === 0 ? '#98c379' : '#e06c75';
    const titleSpan = document.createElement('span');
    titleSpan.style.cssText = `color:#61dafb; font-weight:bold; flex:1; font-size:11px;`;
    titleSpan.innerText = `🧪 ${flowId}`;

    const summarySpan = document.createElement('span');
    summarySpan.style.cssText = `color:${passColor}; font-weight:bold; font-size:11px;`;
    summarySpan.innerText = `${passed}/${total} passed`;

    const collapseBtn = document.createElement('button');
    collapseBtn.innerText = '▼';
    collapseBtn.title = 'Collapse';
    collapseBtn.style.cssText = `background:none; border:none; color:#888; font-size:12px; cursor:pointer; padding:0 2px;`;

    const closeBtn = document.createElement('button');
    closeBtn.innerText = '✕';
    closeBtn.title = 'Close';
    closeBtn.style.cssText = `background:none; border:none; color:#888; font-size:12px; cursor:pointer; padding:0 2px;`;
    closeBtn.onclick = () => drawer.remove();

    header.appendChild(titleSpan);
    header.appendChild(summarySpan);
    header.appendChild(collapseBtn);
    header.appendChild(closeBtn);

    // ── Sub-header: run time + download ──────────────────────────────────────
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
    tableWrap.style.cssText = `overflow-y:auto; flex:1; max-height:40vh;`;

    const table = document.createElement('table');
    table.style.cssText = `width:100%; border-collapse:collapse; font-size:11px;`;
    table.innerHTML = `
        <thead>
            <tr style="background:#2c313a; color:#61dafb; text-align:left; position:sticky; top:0;">
                <th style="padding:5px 8px; width:28px;">#</th>
                <th style="padding:5px 8px; width:36px;"></th>
                <th style="padding:5px 8px;">Trace</th>
                <th style="padding:5px 8px; width:90px;">Final state</th>
            </tr>
        </thead>
    `;

    const tbody = document.createElement('tbody');
    let selectedRow = null;

    cases.forEach((c) => {
        const tr = document.createElement('tr');
        tr.style.cssText = `cursor:pointer; border-bottom:1px solid #2c313a; transition:background 0.1s;`;
        tr.innerHTML = `
            <td style="padding:5px 8px; color:#666;">${c.path}</td>
            <td style="padding:5px 8px; font-size:13px;">${c.passed ? '✅' : '❌'}</td>
            <td style="padding:5px 8px; color:#abb2bf; max-width:160px; overflow:hidden;
                text-overflow:ellipsis; white-space:nowrap;"
                title="${c.expected.join(' → ')}">${c.expected.join(' → ')}</td>
            <td style="padding:5px 8px; color:${c.passed ? '#98c379' : '#e06c75'};">${c.finalStateId}</td>
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

        tr.onclick = () => {
            if (selectedRow) { selectedRow.style.background = ''; selectedRow.style.outline = ''; }
            selectedRow = tr;
            tr.style.background = '#2d3a4a';
            tr.style.outline = '1px solid #0084ff';
            if (diffRow) diffRow.style.display = diffRow.style.display === 'none' ? '' : 'none';
            replayFn(JSON.stringify(c.expected));
        };

        tbody.appendChild(tr);
        if (diffRow) tbody.appendChild(diffRow);
    });

    table.appendChild(tbody);
    tableWrap.appendChild(table);

    drawer.appendChild(header);
    drawer.appendChild(subHeader);
    drawer.appendChild(tableWrap);
    document.body.appendChild(drawer);

    // ── Collapse / expand ─────────────────────────────────────────────────────
    collapseBtn.onclick = () => {
        collapsed = !collapsed;
        subHeader.style.display  = collapsed ? 'none' : '';
        tableWrap.style.display  = collapsed ? 'none' : '';
        collapseBtn.innerText    = collapsed ? '▲' : '▼';
        collapseBtn.title        = collapsed ? 'Expand' : 'Collapse';
    };

    // ── Drag to move ──────────────────────────────────────────────────────────
    let dragging = false, dragOffX = 0, dragOffY = 0;

    header.addEventListener('mousedown', (e) => {
        if (e.target === closeBtn || e.target === collapseBtn) return;
        dragging = true;
        const rect = drawer.getBoundingClientRect();
        dragOffX = e.clientX - rect.left;
        dragOffY = e.clientY - rect.top;
        header.style.cursor = 'grabbing';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const x = e.clientX - dragOffX;
        const y = e.clientY - dragOffY;
        drawer.style.left   = `${x}px`;
        drawer.style.top    = `${y}px`;
        drawer.style.right  = 'auto';
        drawer.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        header.style.cursor = 'grab';
    });
}

// ── Load results from file ────────────────────────────────────────────────────

export function loadTestResults(file) {
    if (!file) { console.warn('Pass a File object. Usage: loadTestResults(file)'); return; }
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
