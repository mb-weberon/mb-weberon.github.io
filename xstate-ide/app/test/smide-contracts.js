/**
 * smide-contracts.js
 *
 * Three suites covering the smide state machine and supporting utilities.
 *
 * Suite 1 — getAllTraces (unit):
 *   Structural checks on getAllTraces(smide-machine) output: non-empty result,
 *   all paths are arrays of strings, no duplicates. Path count is
 *   capture/compare so regressions in the enumeration algorithm surface here.
 *
 * Suite 2 — Runtime + smide-machine (integration):
 *   Drives Runtime through eight named boot/interaction paths using inline
 *   service definitions so guard branches are deterministic regardless of
 *   which constants happen to be set in smide-services.js. Snapshot sequences
 *   are captured/compared against a baseline, same pattern as runtime-contracts.
 *
 * Suite 3 — Structure (static, no baseline):
 *   Asserts that every state, transition target, and guard referenced in the
 *   machine actually exists — a pre-flight check before live wiring in task 5.
 *   Runs on every invocation; failures are always reported regardless of mode.
 *
 * Usage (browser console):
 *   await window.contracts.smide()           — auto: check if baseline exists, else capture
 *   await window.contracts.smide('capture')  — force capture baseline
 *   await window.contracts.smide('check')    — force check against baseline
 *
 * Workflow (first time / after machine or getAllTraces changes):
 *   1. await window.contracts.smide('capture')
 *      Downloads smide-baseline.json. Commit it alongside this file.
 *   2. Before/after every change:
 *      await window.contracts.smide()
 *      Compares against saved baseline.
 */

import { Runtime }     from '../Runtime.js';
import { getAllTraces } from '../generate-traces.js';

// ── Fixture loader ─────────────────────────────────────────────────────────────

const SMIDE_MACHINE_URL  = new URL('./smide-machine.json', import.meta.url).href;
const SMIDE_SERVICES_URL = new URL('./smide-services.js',  import.meta.url).href;

let _smideMachine  = null;
let _smideServices = null;

async function loadSmideFixture() {
    if (!_smideMachine) {
        const [machine, mod] = await Promise.all([
            fetch(SMIDE_MACHINE_URL, { cache: 'no-store' }).then(r => r.json()),
            import(SMIDE_SERVICES_URL),
        ]);
        _smideMachine  = machine;
        _smideServices = mod.smideServices;
    }
    return { machine: _smideMachine, services: _smideServices };
}

// ── Inline service factory ────────────────────────────────────────────────────
//
// Each test path gets its own services object built from explicit parameters.
// This makes guard branches deterministic regardless of the module-level
// HAS_FLOW / BOOT_FAILS / etc. constants in smide-services.js.

function makeServices({ bootFails = false, hasFlow = false, restoreFails = false, hasResults = false, hasSession = false } = {}) {
    return {
        checkPersistedState: async () => {
            if (bootFails) throw new Error('Simulated boot failure');
            return { hasFlow, hasResults, hasSession };
        },
        restorePersistedState: async () => {
            if (restoreFails) throw new Error('Simulated restore failure');
            return { hasResults, hasSession };
        },
        guards: {
            hasPersistedFlow:    ({ event }) => event.output?.hasFlow    === true,
            hasPersistedResults: ({ event }) => event.output?.hasResults === true,
            hasPersistedSession: ({ event }) => event.output?.hasSession === true,
        },
    };
}

// ── Test paths ────────────────────────────────────────────────────────────────
//
// Eight paths covering every boot scenario and the key interaction branches.
//
// All paths start at render_ui (always-transient → booting → invoke).
// The initial wait(0) in runPath() settles these before the first step is sent.
//
//   fresh start:        booting.checkPersistedState returns hasFlow=false → no_flow
//   boot error:         checkPersistedState throws                        → load_error
//   returning user:     checkPersistedState returns hasFlow=true          → prompt_restore
//     START_FRESH:      prompt_restore → no_flow (guard not taken)
//     RESTORE → idle:   restoring_flow → flow_idle (no results, no session)
//     RESTORE → results:restoring_flow → results_ready  (hasPersistedResults guard)
//     RESTORE → session:restoring_flow → session_active (hasPersistedSession guard)
//     restore fails:    restorePersistedState throws   → load_error

const SMIDE_PATHS = [
    {
        name: 'fresh_start_load_flow_run_tests_save',
        services: makeServices({ hasFlow: false }),
        steps: [
            { send: 'LOAD_FLOW' },          // no_flow → flow_idle
            { send: 'RUN_TESTS' },          // flow_idle → tests_running
            { send: 'TESTS_COMPLETE' },     // tests_running → results_unsaved
            { send: 'SAVE_RESULTS' },       // results_unsaved → results_saved
        ],
    },
    {
        name: 'boot_error_dismiss',
        services: makeServices({ bootFails: true }),
        steps: [
            // render_ui → booting → load_error  (checkPersistedState throws)
            { send: 'DISMISS' },            // load_error → no_flow
        ],
    },
    {
        name: 'fresh_start_load_results_replay_restart',
        services: makeServices({ hasFlow: false }),
        steps: [
            { send: 'LOAD_RESULTS' },       // no_flow → results_ready
            { send: 'REPLAY' },             // results_ready → session_active
            { send: 'RESTART' },            // session_active → flow_idle
        ],
    },
    {
        name: 'returning_user_start_fresh',
        services: makeServices({ hasFlow: true }),
        steps: [
            // booting → prompt_restore  (hasPersistedFlow guard matches)
            { send: 'START_FRESH' },        // prompt_restore → no_flow
            { send: 'LOAD_FLOW' },          // no_flow → flow_idle
        ],
    },
    {
        name: 'restore_with_results',
        services: makeServices({ hasFlow: true, hasResults: true }),
        steps: [
            // prompt_restore
            { send: 'RESTORE' },            // → restoring_flow → results_ready  (hasPersistedResults)
            { send: 'RUN_TESTS' },          // results_ready → tests_running
            { send: 'TESTS_STOP' },         // tests_running → results_unsaved
        ],
    },
    {
        name: 'restore_with_session_then_test',
        services: makeServices({ hasFlow: true, hasSession: true }),
        steps: [
            // prompt_restore
            { send: 'RESTORE' },            // → restoring_flow → session_active  (hasPersistedSession)
            { send: 'CHAT_INPUT' },         // session_active → session_active  (self)
            { send: 'RUN_TESTS' },          // → tests_running
            { send: 'TESTS_COMPLETE' },     // → results_unsaved
        ],
    },
    {
        name: 'restore_to_flow_idle',
        services: makeServices({ hasFlow: true, hasResults: false, hasSession: false }),
        steps: [
            // prompt_restore
            { send: 'RESTORE' },            // → restoring_flow → flow_idle  (fallback branch)
            { send: 'CHAT_INPUT' },         // flow_idle → session_active
        ],
    },
    {
        name: 'restore_fails',
        services: makeServices({ hasFlow: true, restoreFails: true }),
        steps: [
            // prompt_restore
            { send: 'RESTORE' },            // → restoring_flow → load_error  (restorePersistedState throws)
            { send: 'DISMISS' },            // load_error → no_flow
        ],
    },
];

// ── Runner ────────────────────────────────────────────────────────────────────

const wait = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Drive a single test path against the given machine.
 * Returns an array of snapshot records — one per onSnapshot call.
 * Async mock services (no internal awaits) resolve after a single event-loop
 * turn, so wait(0) after start() and wait(50) after each step are sufficient.
 */
async function runPath(path, machine) {
    const snapshots = [];
    const rt = new Runtime(machine, path.services, undefined, { headless: true });
    rt.onSnapshot = (snap) => {
        snapshots.push({
            stateId:    snap.stateId,
            input:      snap.input   ?? null,
            choices:    [...snap.choices].sort(),
            hasMessage: !!snap.message,
            hasError:   !!snap.error,
        });
    };
    rt.start();
    await wait(0);   // settle always-transitions + first async invoke

    for (const step of path.steps) {
        if (step.submit !== undefined) {
            rt.submit(step.submit);
        } else if (step.send) {
            rt.send(step.send);
        }
        await wait(50);   // settle any async invoke triggered by this event
    }

    rt.actor?.stop();
    return snapshots;
}

// ── Suite 1: getAllTraces checks ───────────────────────────────────────────────

function runGetAllTracesChecks(machine) {
    const issues = [];
    const traces = getAllTraces(machine);

    if (!Array.isArray(traces)) {
        return { pathCount: 0, issues: ['getAllTraces did not return an array'] };
    }
    if (traces.length === 0) {
        return { pathCount: 0, issues: ['getAllTraces returned 0 paths'] };
    }

    const seen = new Set();
    traces.forEach((path, i) => {
        if (!Array.isArray(path)) {
            issues.push(`path[${i}] is not an array`);
            return;
        }
        if (path.length === 0) {
            issues.push(`path[${i}] is an empty array`);
        }
        path.forEach((step, j) => {
            if (typeof step !== 'string') {
                issues.push(`path[${i}][${j}] is not a string: ${JSON.stringify(step)}`);
            }
        });
        const key = JSON.stringify(path);
        if (seen.has(key)) {
            issues.push(`path[${i}] is a duplicate of an earlier path`);
        }
        seen.add(key);
    });

    return { pathCount: traces.length, issues };
}

// ── Suite 3: structure checks ─────────────────────────────────────────────────

function runStructureChecks(machine, services) {
    const issues   = [];
    const stateIds = new Set(Object.keys(machine.states));
    const guards   = services?.guards ?? {};

    if (!stateIds.has(machine.initial)) {
        issues.push(`Initial state "${machine.initial}" not found in states`);
    }

    for (const [sid, state] of Object.entries(machine.states)) {
        const hasExit = state.on || state.always || state.invoke || state.type === 'final';
        if (!hasExit) {
            issues.push(`${sid}: no transitions and not final (dead end)`);
        }

        if (state.always) {
            const branches = Array.isArray(state.always) ? state.always : [state.always];
            branches.forEach(b => {
                const target = typeof b === 'string' ? b : b.target;
                if (target && !stateIds.has(target)) {
                    issues.push(`${sid}.always → "${target}" (state not found)`);
                }
            });
        }

        if (state.on) {
            for (const [evt, transition] of Object.entries(state.on)) {
                const list = Array.isArray(transition) ? transition : [transition];
                list.forEach(t => {
                    if (!t) return;
                    if (t.target && !stateIds.has(t.target)) {
                        issues.push(`${sid}.on.${evt} → "${t.target}" (state not found)`);
                    }
                    if (t.guard) {
                        const name = typeof t.guard === 'string' ? t.guard : t.guard?.type;
                        if (name && !guards[name]) {
                            issues.push(`${sid}.on.${evt} guard "${name}" not in services.guards`);
                        }
                    }
                });
            }
        }

        if (state.invoke) {
            const { onDone, onError } = state.invoke;
            if (onDone) {
                const list = Array.isArray(onDone) ? onDone : [onDone];
                list.forEach(b => {
                    if (b?.target && !stateIds.has(b.target)) {
                        issues.push(`${sid}.invoke.onDone → "${b.target}" (state not found)`);
                    }
                    if (b?.guard) {
                        const name = typeof b.guard === 'string' ? b.guard : b.guard?.type;
                        if (name && !guards[name]) {
                            issues.push(`${sid}.invoke.onDone guard "${name}" not in services.guards`);
                        }
                    }
                });
            }
            if (onError?.target && !stateIds.has(onError.target)) {
                issues.push(`${sid}.invoke.onError → "${onError.target}" (state not found)`);
            }
        }
    }

    return issues;
}

// ── Run all suites ────────────────────────────────────────────────────────────

async function runAll(machine, services) {
    const timestamp  = new Date().toISOString();
    const appVersion = window._appVersion ?? null;

    // Suite 1: getAllTraces checks
    const { pathCount, issues: traceIssues } = runGetAllTracesChecks(machine);

    // Suite 2: Runtime paths
    const runtimePaths = [];
    for (const path of SMIDE_PATHS) {
        const snapshots = await runPath(path, machine);
        runtimePaths.push({ name: path.name, snapshots });
    }

    return { timestamp, appVersion, allTracesCount: pathCount, traceIssues, runtimePaths };
}

// ── Comparison ────────────────────────────────────────────────────────────────

function compareToBaseline(current, baseline) {
    const failures     = [];
    const warnings     = [];
    const passed       = [];
    const newPaths     = [];
    const missingPaths = [];

    const cv = current.appVersion  ?? '(unknown)';
    const bv = baseline.appVersion ?? '(unknown)';
    if (cv !== bv) {
        warnings.push(`app version changed: baseline at ${bv}, running ${cv}`);
    }

    // Suite 1: path count
    if (current.allTracesCount !== baseline.allTracesCount) {
        failures.push({
            suite:  'getAllTraces',
            reason: `path count changed: baseline ${baseline.allTracesCount}, now ${current.allTracesCount}`,
        });
    } else {
        passed.push(`getAllTraces: path count = ${current.allTracesCount}`);
    }

    // Suite 1: assertion issues (structural — fail immediately if present)
    (current.traceIssues ?? []).forEach(issue => {
        failures.push({ suite: 'getAllTraces', reason: issue });
    });

    // Suite 2: runtime paths
    const baseMap = Object.fromEntries(baseline.runtimePaths.map(r => [r.name, r]));
    const currMap = Object.fromEntries(current.runtimePaths.map(r => [r.name, r]));

    for (const name of Object.keys(baseMap)) {
        if (!currMap[name]) missingPaths.push(name);
    }
    for (const name of Object.keys(currMap)) {
        if (!baseMap[name]) { newPaths.push(name); continue; }

        const baseSnaps = baseMap[name].snapshots;
        const currSnaps = currMap[name].snapshots;

        if (currSnaps.length !== baseSnaps.length) {
            failures.push({
                path:   name,
                reason: `snapshot count changed: baseline ${baseSnaps.length}, now ${currSnaps.length}`,
            });
            continue;
        }

        for (let i = 0; i < baseSnaps.length; i++) {
            const b = baseSnaps[i];
            const c = currSnaps[i];

            for (const key of ['stateId', 'input', 'hasMessage', 'hasError']) {
                if (b[key] !== c[key]) {
                    failures.push({ path: name, step: i, field: key,
                        reason: `${key} changed`, baseline: b[key], current: c[key] });
                }
            }

            if (JSON.stringify(b.choices) !== JSON.stringify(c.choices)) {
                failures.push({ path: name, step: i, field: 'choices',
                    reason: 'choices changed', baseline: b.choices, current: c.choices });
            }

            if (!failures.some(f => f.path === name && f.step === i)) {
                passed.push(`${name}[${i}] (${c.stateId})`);
            }
        }
    }

    return { failures, warnings, passed, newPaths, missingPaths };
}

// ── Reporting ─────────────────────────────────────────────────────────────────

function reportStructure(structureIssues) {
    if (structureIssues.length === 0) {
        console.log('%c  ✅ Structure: all state references and guards valid.', 'color:#98c379;');
        return true;
    }
    console.group(`❌ Structure issues (${structureIssues.length})`);
    structureIssues.forEach(issue => console.error(`  ❌ ${issue}`));
    console.groupEnd();
    return false;
}

function report(comparison, structureIssues) {
    const { failures, warnings, passed, newPaths, missingPaths } = comparison;
    const structureOk = structureIssues.length === 0;
    const allPassed   = failures.length === 0 && structureOk;

    console.group(
        `%c🧪 Smide Contracts — ${allPassed ? '✅ PASSED' : '❌ FAILED'} ` +
        `(${passed.length} passed, ${failures.length} failed, ${warnings.length} warnings)`,
        `color:${allPassed ? '#98c379' : '#e06c75'}; font-weight:bold; font-size:13px;`
    );

    reportStructure(structureIssues);

    if (failures.length) {
        console.group(`❌ Failures (${failures.length})`);
        failures.forEach(f => {
            const loc = f.step !== undefined ? ` step ${f.step}` : '';
            const ctx = f.path ? `[${f.path}]${loc}` : `[${f.suite ?? '?'}]`;
            console.error(
                `  ❌ ${ctx} ${f.field ?? ''}: ${f.reason}` +
                (f.baseline !== undefined
                    ? `\n     baseline: ${JSON.stringify(f.baseline)}, now: ${JSON.stringify(f.current)}`
                    : '')
            );
        });
        console.groupEnd();
    }

    if (warnings.length) {
        console.group(`⚠️  Warnings (${warnings.length})`);
        warnings.forEach(w => console.warn(`  ⚠️  ${w}`));
        console.groupEnd();
    }

    if (newPaths.length) {
        console.group(`🆕 New paths (not in baseline — run capture to update)`);
        newPaths.forEach(p => console.log(`  + ${p}`));
        console.groupEnd();
    }

    if (missingPaths.length) {
        console.group(`🗑️  Removed paths (were in baseline, now gone)`);
        missingPaths.forEach(p => console.log(`  - ${p}`));
        console.groupEnd();
    }

    if (allPassed && !warnings.length) {
        console.log('%c  No regressions detected.', 'color:#98c379;');
    }

    console.groupEnd();
    return allPassed;
}

// ── Entry point ───────────────────────────────────────────────────────────────

const BASELINE_URL = './test/smide-baseline.json';

async function smide_contracts(mode) {
    let fixture;
    try {
        fixture = await loadSmideFixture();
    } catch (e) {
        console.error(`❌ Could not load smide fixture: ${e.message}`);
        return null;
    }
    const { machine, services } = fixture;

    if (!mode) {
        try {
            const res = await fetch(BASELINE_URL, { cache: 'no-store' });
            mode = res.ok ? 'check' : 'capture';
        } catch {
            mode = 'capture';
        }
        if (mode === 'capture') {
            console.info(
                '📋 Smide Contracts — no baseline found.\n' +
                '   Run: await window.contracts.smide(\'capture\')  to create one.\n' +
                '   Commit smide-baseline.json alongside this file.'
            );
        }
    }

    console.group(`🧪 Smide Contracts [${mode}]`);

    // Suite 3 always runs — structural failures are reported regardless of mode
    const structureIssues = runStructureChecks(machine, services);

    if (mode === 'capture') {
        console.log('▶ Running suite 1 (getAllTraces) + suite 2 (Runtime paths)…');
        const data = await runAll(machine, services);

        if (data.traceIssues?.length) {
            console.warn('⚠️  getAllTraces assertion failures — fix before committing baseline:');
            data.traceIssues.forEach(i => console.warn(`  ⚠️  ${i}`));
        }
        reportStructure(structureIssues);

        const json     = JSON.stringify(data, null, 2);
        const filename = 'smide-baseline.json';
        console.log('%c✅ Baseline captured. Commit smide-baseline.json.', 'color:#98c379; font-weight:bold;');

        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        console.log(`💾 Downloading ${filename}…`);

        console.groupEnd();
        return data;

    } else {
        let baseline;
        try {
            const res = await fetch(BASELINE_URL, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            baseline = await res.json();
        } catch (e) {
            console.error(`❌ Could not load baseline: ${e.message}`);
            console.info(`   Run: await window.contracts.smide('capture')  to create one.`);
            console.groupEnd();
            return null;
        }

        console.log('▶ Running suite 1 (getAllTraces) + suite 2 (Runtime paths)…');
        const current    = await runAll(machine, services);
        const comparison = compareToBaseline(current, baseline);
        const allPassed  = report(comparison, structureIssues);

        console.groupEnd();
        return { allPassed, comparison, current, baseline };
    }
}

// ── Expose on window ──────────────────────────────────────────────────────────

window.contracts       = window.contracts       || {};
window.contracts.smide = smide_contracts;
