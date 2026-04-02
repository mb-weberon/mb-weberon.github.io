import { Runtime }             from './Runtime.js';
import { mountResultsDrawer } from './ResultsDrawerUI.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

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
 * For text-input states (meta.input === 'text') add a sample value keyed by
 * state id inside the services file: SAMPLE_INPUTS: { stateId: 'value', ... }
 * as a property of the services object. Tests will not start until all
 * text-input states have a sample value.
 */


// ── Results cache (Cache API) ─────────────────────────────────────────────────
const _RESULTS_CACHE = 'xstate-ide-v1';
const _RESULTS_URL   = '/xstate-ide/results';

export async function cacheResults(results) {
    try {
        const cache = await caches.open(_RESULTS_CACHE);
        await cache.put(_RESULTS_URL, new Response(JSON.stringify(results), {
            headers: { 'Content-Type': 'application/json' },
        }));
    } catch (e) {
        console.warn('⚠️  Could not cache results:', e.message);
    }
}

export async function loadResultsFromCache() {
    try {
        const cache = await caches.open(_RESULTS_CACHE);
        const resp  = await cache.match(_RESULTS_URL);
        return resp ? await resp.json() : null;
    } catch (_) { return null; }
}

export async function clearResultsCache() {
    try {
        const cache = await caches.open(_RESULTS_CACHE);
        await cache.delete(_RESULTS_URL);
    } catch (_) {}
}


// ── Sample inputs modal ───────────────────────────────────────────────────────

function _showSampleInputsModal(missingIds, onSubmit, noServices) {
    const existing = document.getElementById('smide-sample-inputs-dialog');
    if (existing) existing.remove();

    const note = noServices
        ? '<p style="margin:0 0 12px;font-size:12px;color:#b08800;background:#fffbe6;border-radius:4px;padding:6px 10px;">No services file loaded — guards will not run. You can still test states that only need sample inputs.</p>'
        : '';

    const fields = missingIds.map(id => `
        <div style="margin-bottom:10px;">
            <label style="display:block;font-size:12px;font-weight:600;color:#555;margin-bottom:3px;">${id}</label>
            <input data-state="${id}" type="text" placeholder="sample value for ${id}" style="
                width:100%;box-sizing:border-box;
                font-family:monospace;font-size:13px;
                border:1px solid #ccc;border-radius:4px;padding:6px 8px;
            ">
        </div>`).join('');

    const dialog = document.createElement('dialog');
    dialog.id = 'smide-sample-inputs-dialog';
    dialog.style.cssText = `
        border:none; border-radius:8px; padding:0;
        box-shadow:0 8px 32px rgba(0,0,0,0.25);
        max-width:420px; width:100%;
        font-family:'Segoe UI', sans-serif;
    `;

    dialog.innerHTML = `
        <div style="padding:20px 24px 0;">
            <h3 style="margin:0 0 8px;font-size:15px;color:#1c1e21;">Sample inputs needed</h3>
            <p style="margin:0 0 12px;font-size:13px;color:#444;">
                Enter a sample value for each text-input state.
                These are used by the test runner to simulate user input and are applied for this session only.
            </p>
            ${note}
            ${fields}
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 24px 16px;">
            <button id="smide-snippet-run" style="
                padding:6px 14px;border-radius:5px;border:none;cursor:pointer;
                background:#0084ff;color:#fff;font-size:13px;
            ">Run Tests</button>
            <button id="smide-snippet-close" style="
                padding:6px 14px;border-radius:5px;border:1px solid #ddd;cursor:pointer;
                background:#fff;color:#333;font-size:13px;
            ">Cancel</button>
        </div>
    `;

    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector('input')?.focus();

    dialog.querySelector('#smide-snippet-run').onclick = () => {
        const inputs = {};
        dialog.querySelectorAll('input[data-state]').forEach(el => {
            if (el.value.trim()) inputs[el.dataset.state] = el.value.trim();
        });
        const stillMissing = missingIds.filter(id => !inputs[id]);
        if (stillMissing.length > 0) {
            dialog.querySelectorAll('input[data-state]').forEach(el => {
                el.style.borderColor = stillMissing.includes(el.dataset.state) ? '#e00' : '#ccc';
            });
            return;
        }
        dialog.close();
        onSubmit(inputs);
    };
    dialog.querySelector('#smide-snippet-close').onclick = () => dialog.close();
    dialog.addEventListener('close', () => dialog.remove());
}

// ── Path enumeration ──────────────────────────────────────────────────────────

export function getAllTraces(config, sampleInputs = {}) {
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
                    const sample = sampleInputs[stateId] ?? 'sample-input';
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
let _drawerHandle           = null;

function _dismissDrawer() {
    if (_drawerHandle) {
        _drawerHandle.remove();
        _drawerHandle = null;
    }
    // Fallback: remove any leftover drawer DOM (e.g. from a previous session)
    document.getElementById('test-results-drawer')?.remove();
}

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
        runAt:     new Date().toISOString(),
        flowId:    config.id,
        pathCount: total,
        total:     cases.length,
        passed:    passCount,
        failed:    failCount,
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

export async function runAllTracesHeadless(config, services, { pauseMs = 0, servicesSource = null, priorResults = null } = {}) {
    _interrupted = false;
    _skipCurrent = false;
    _dismissDrawer();

    // ── Pre-flight: check that all text-input states have a sample value ───────
    const sampleInputs = services.SAMPLE_INPUTS ?? {};
    const missingInputs = Object.entries(config.states)
        .filter(([id, s]) => s.meta?.input === 'text' && !sampleInputs[id])
        .map(([id]) => id);
    if (missingInputs.length > 0) {
        console.warn('⚠️  Tests blocked — no sample input for:', missingInputs.join(', '));
        _showSampleInputsModal(missingInputs, (extraInputs) => {
            services.SAMPLE_INPUTS = { ...sampleInputs, ...extraInputs };
            runAllTracesHeadless(config, services, { pauseMs, servicesSource, priorResults });
        }, !servicesSource);
        return;
    }

    const traces = getAllTraces(config, sampleInputs);
    const total  = traces.length;
    const runAt  = new Date().toISOString();

    // Resume mode: prior partial results for the same flow that have pending rows
    const isResume = !!(priorResults &&
        priorResults.flowId === config.id &&
        priorResults.allPaths &&
        priorResults.total < priorResults.pathCount);
    const cases   = isResume ? [...priorResults.cases] : [];
    const caseMap = new Map(cases.map(c => [c.path - 1, c]));

    // ── Build live Preact drawer with all N rows before tests start ───────────
    // onRerun uses drawerHandle, so declare it before the mount call.
    let drawerHandle;
    const onRerun = (i, expected, cfg) => {
        window._replayTrace?.(JSON.stringify(expected), cfg, 350);
        // Hook onReplayDone at 100ms — after _replayTrace's own setTimeout(50)
        // has already called replay(), so there is no race on the assignment.
        setTimeout(() => {
            const rt = window.currentRuntime;
            if (!rt) return;
            const prev = rt.onReplayDone;
            rt.onReplayDone = () => {
                if (prev) prev();
                const snap         = rt.actor.getSnapshot();
                const finalStateId = typeof snap.value === 'string' ? snap.value : Object.keys(snap.value)[0];
                const actual       = normaliseActualTrace(rt.getTrace());
                const { passed, diffs } = compareTraces(expected, actual);
                drawerHandle.updateRow(i, passed ? 'pass' : 'fail', {
                    passed, skipped: false, diffs, finalStateId,
                    finalContext: snap.context, expected, bubbles: [], visitedEdges: [],
                });
            };
        }, 100);
    };

    const pendingCount = total - caseMap.size;
    const initSummary  = isResume
        ? `Resuming… ${caseMap.size} / ${total} done`
        : `Running… 0 / ${total}`;

    drawerHandle = mountResultsDrawer(config, initSummary, runAt, {
        onRowSelect: (i, row) => _restoreCase(row.case, config),
        onRerun,
    });
    _drawerHandle = drawerHandle;

    drawerHandle.setRows(traces.map((expected, i) => {
        const c = caseMap.get(i);
        if (c) return {
            path:   i + 1,
            status: c.skipped ? 'skipped' : (c.passed ? 'pass' : 'fail'),
            expected,
            case:   c,
        };
        return { path: i + 1, status: 'pending', expected, case: null };
    }));

    showStatusBadge(isResume ? `Resuming… ${pendingCount} remaining` : `Running 0 / ${total}…`, true);
    console.group(`▶▶ ${isResume ? 'Resuming' : 'Running all'} ${total} paths (headless)`);

    for (let i = 0; i < total; i++) {
        if (caseMap.has(i)) continue; // already completed — skip in resume mode

        if (_interrupted) {
            console.warn(`⛔ Stopped after ${cases.length} of ${total} paths`);
            break;
        }

        const expected = traces[i];
        showStatusBadge(`Running ${cases.length + 1} / ${total}…`, true);
        console.log(`\n▶ Path ${i + 1} / ${total}: ${JSON.stringify(expected)}`);
        drawerHandle.updateRow(i, 'running', null);

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
            drawerHandle.updateRow(i, 'skipped', c);
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
        drawerHandle.updateRow(i, passed ? 'pass' : 'fail', c);

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
    const notRunCount = total - cases.length;
    const passColor   = failCount === 0 ? '#98c379' : '#e06c75';
    let summaryText   = `${passCount}/${total} passed`;
    if (skipCount)       summaryText += ` · ${skipCount} skipped`;
    if (notRunCount > 0) summaryText += ` · ${notRunCount} not run`;
    drawerHandle.setSummary(summaryText, passColor);

    const results = {
        runAt,
        flowId:    config.id,
        pathCount: total,
        total:     cases.length,
        passed:    passCount,
        failed:    failCount,
        skipped:   skipCount,
        config,
        servicesSource,
        allPaths:  traces,
        cases,
    };

    window._testResults = results;
    cacheResults(results);
    hideStatusBadge();

    console.log('💾 Results saved to window._testResults');
    return results;
}

// ── Drawer helpers ─────────────────────────────────────────────────────────────

/** Restore chat bubbles, profile view, replay bar, and diagram for a case. */
function _restoreCase(c, config) {
    // _activeReplayConfig carries the per-case config so the Preact replay button
    // calls _replayTrace with the right machine config even when loaded results
    // differ from the currently-open flow.
    window._activeReplayConfig = config ?? null;
    window._showReplayBar?.(JSON.stringify(c.expected));
    window._setChatMessages?.(c.bubbles ?? []);
    window._restoreStateView?.({
        profileText: JSON.stringify(c.finalContext, null, 2),
        stateId:     `State: ${c.finalStateId}`,
    });
    if (window.renderDiagram) {
        window.renderDiagram(
            config ?? window._config,
            c.finalStateId,
            new Set(c.visitedEdges ?? [])
        ).catch(() => {});
    }
}

// ── Results drawer ────────────────────────────────────────────────────────────
// Used when loading saved results from file (Load Results button).

export function showResultsDrawer(results, replayFn) {
    _dismissDrawer();

    const { cases, passed, failed, total, pathCount, allPaths, runAt, flowId, config } = results;
    replayFn = replayFn ?? window._replayTrace;

    const effectiveTotal = pathCount ?? total;
    const notRunCount    = effectiveTotal - cases.length;
    const passColor      = failed === 0 ? '#98c379' : '#e06c75';
    const skipCount      = cases.filter(c => c.skipped).length;
    let   summaryStr     = `${passed}/${effectiveTotal} passed`;
    if (skipCount)    summaryStr += ` · ${skipCount} skipped`;
    if (notRunCount > 0) summaryStr += ` · ${notRunCount} not run`;

    // Build index → case map so pending rows can be interleaved correctly
    const caseMap = new Map(cases.map(c => [c.path - 1, c]));

    let drawerHandle;
    const onRerun = (i, expected, cfg) => {
        replayFn?.(JSON.stringify(expected), cfg, 350);
        setTimeout(() => {
            const rt = window.currentRuntime;
            if (!rt) return;
            const prev = rt.onReplayDone;
            rt.onReplayDone = () => {
                if (prev) prev();
                const snap         = rt.actor.getSnapshot();
                const finalStateId = typeof snap.value === 'string' ? snap.value : Object.keys(snap.value)[0];
                const actual       = normaliseActualTrace(rt.getTrace());
                const { passed: p, diffs } = compareTraces(expected, actual);
                drawerHandle.updateRow(i, p ? 'pass' : 'fail', {
                    ...caseMap.get(i), passed: p, diffs, finalStateId, finalContext: snap.context,
                });
            };
        }, 100);
    };

    drawerHandle = mountResultsDrawer({ id: flowId }, summaryStr, runAt, {
        onRowSelect: (i, row) => _restoreCase(row.case, config),
        onRerun,
    });
    _drawerHandle = drawerHandle;

    drawerHandle.setSummary(summaryStr, passColor);

    const rowCount = allPaths ? allPaths.length : cases.length;
    drawerHandle.setRows(
        Array.from({ length: rowCount }, (_, i) => {
            const c = caseMap.get(i);
            if (c) return {
                path:     c.path ?? i + 1,
                status:   c.skipped ? 'skipped' : (c.passed ? 'pass' : 'fail'),
                expected: c.expected,
                case:     c,
            };
            return {
                path:     i + 1,
                status:   'pending',
                expected: allPaths[i],
                case:     null,
            };
        }),
        config
    );

    // Auto-select first completed row to restore its chat/profile view
    const firstCompleted = Array.from({ length: rowCount }, (_, i) => i).find(i => caseMap.has(i));
    if (firstCompleted != null) {
        requestAnimationFrame(() => {
            drawerHandle.selectRow(firstCompleted);
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

async function _applyLoadedResults(results) {
    window._testResults = results;
    cacheResults(results);
    if (results.servicesSource && window._reloadServicesFromSource) {
        await window._reloadServicesFromSource(results.servicesSource, `${results.flowId}-services.js`);
    }
    if (results.config && typeof window._restartRuntime === 'function') {
        window._restartRuntime(results.config);
    }
    showResultsDrawer(results, window._replayTrace);
    window._setSmideState?.('results_ready');
    console.log(`✅ Loaded ${results.cases?.length} test cases from file`);
}

// Accepts a results ZIP (.zip containing results.json) or a plain results JSON
// for backward compatibility.
export function loadTestResults(file) {
    if (!file) { console.warn('Pass a File object via the Load button.'); return; }

    if (file.name.endsWith('.zip')) {
        file.arrayBuffer().then(buf => {
            const unzipped = unzipSync(new Uint8Array(buf));
            if (!Object.keys(unzipped).includes('results.json')) {
                const m = 'ZIP contains no results.json';
                console.error('❌', m); window.showToast?.(m); return;
            }
            try {
                return _applyLoadedResults(JSON.parse(strFromU8(unzipped['results.json'])));
            } catch (err) {
                const m = `Invalid results JSON in ZIP: ${err.message}`;
                console.error('❌', m); window.showToast?.(m);
            }
        }).catch(err => {
            const m = `Could not read ZIP: ${err.message}`;
            console.error('❌', m); window.showToast?.(m);
        });
        return;
    }

    // Plain JSON — backward compat
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            await _applyLoadedResults(JSON.parse(e.target.result));
        } catch (err) {
            const m = `Invalid results JSON: ${err.message}`;
            console.error('❌', m); window.showToast?.(m);
        }
    };
    reader.readAsText(file);
}

// ── Debug helpers ─────────────────────────────────────────────────────────────

/**
 * Force the results drawer to a canonical visible state:
 *   - expanded (not collapsed)
 *   - anchored at bottom:0, left:0
 *   - right edge = left edge of #right-pane (so it spans only the diagram pane)
 *   - full-width if right-pane is covering nearly the whole screen
 * If the drawer DOM node is missing but results are available, recreates it.
 */
export function drawerReset() {
    let drawer = document.getElementById('test-results-drawer');
    if (!drawer) {
        if (window._testResults) {
            showResultsDrawer(window._testResults, window._replayTrace);
            drawer = document.getElementById('test-results-drawer');
        }
        if (!drawer) {
            console.warn('drawerReset: no test results available — run tests or load a results file first');
            return;
        }
    }

    _drawerHandle?.forceExpand?.();

    const rp     = document.getElementById('right-pane');
    const rpLeft = rp ? Math.max(0, rp.getBoundingClientRect().left) : 0;
    const fullWidth = rpLeft < 50; // right-pane covers nearly the whole screen

    drawer.style.position  = 'fixed';
    drawer.style.bottom    = '0';
    drawer.style.top       = '';
    drawer.style.left      = '0';
    drawer.style.right     = fullWidth ? '0' : (window.innerWidth - rpLeft) + 'px';
    drawer.style.width     = '';
    drawer.style.minWidth  = '';
    drawer.style.height    = '';
    drawer.style.overflow  = '';
    drawer.style.transform = '';
    drawer.style.zIndex    = '1000';
    console.log('✅ drawerReset complete');
}

// ── Download helper ───────────────────────────────────────────────────────────

export async function downloadTestResults() {
    const results = window._testResults;
    if (!results) { console.warn('No test results. Run runAllTraces() first.'); return false; }
    const filename  = `test-results-${results.flowId}-${results.runAt.slice(0, 10)}.zip`;
    const zipFiles  = { 'results.json': strToU8(JSON.stringify(results, null, 2)) };
    if (results.config)
        zipFiles[`${results.flowId}-machine.json`] = strToU8(JSON.stringify(results.config, null, 2));
    if (results.servicesSource)
        zipFiles[`${results.flowId}-services.js`] = strToU8(results.servicesSource);
    const zipped = zipSync(zipFiles);
    const blob     = new Blob([zipped], { type: 'application/zip' });

    if ('showSaveFilePicker' in window) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            console.log('💾 Saved test results ZIP via FSA:', filename);
            return true;
        } catch (e) {
            if (e.name !== 'AbortError') console.error('❌ Save failed:', e);
            else console.log('💾 Save cancelled');
            return false;
        }
    } else {
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        console.log('💾 Saved test results ZIP (blob fallback):', filename);
        return true;
    }
}
