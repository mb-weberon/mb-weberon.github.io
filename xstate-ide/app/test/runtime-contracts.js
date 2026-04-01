/**
 * runtime-contracts.js
 *
 * Runs the Runtime through known paths and checks that the snapshot
 * sequence (stateId, input type, choices, message presence) has not regressed.
 *
 * Two suites:
 *   inline  — minimal inline machine; isolates Runtime's core mechanics
 *             (text input, guard validation, choice events, updateContext, final state)
 *   realtor — realtor-machine.json + realtor-services.js; covers async service
 *             invocations (fromPromise), transient always-states, onDone/onError,
 *             recordService, and multi-step guard validation
 *
 * Usage (browser console):
 *   await window.runtime_contracts()           — auto: check if baseline exists, else capture
 *   await window.runtime_contracts('capture')  — force capture baseline
 *   await window.runtime_contracts('check')    — force check against baseline
 *
 * Workflow (first time / after Runtime or machine changes):
 *   1. await window.runtime_contracts('capture')
 *      Runs all paths, downloads runtime-baseline.json.
 *      Commit the file alongside this one.
 *   2. Before/after every change:
 *      await window.runtime_contracts()
 *      Runs all paths, compares against saved baseline.
 */

import { Runtime } from '../Runtime.js';

// ── Inline test machine ───────────────────────────────────────────────────────
//
// Kept inline so this suite has no dependency on flow files that may change
// independently of Runtime itself.

const INLINE_MACHINE = {
    id: 'rt_test',
    initial: 'ask_name',
    context: {
        name:        null,
        inputError:  null,
    },
    states: {
        ask_name: {
            meta: { text: 'What is your name?', input: 'text', placeholder: 'Enter your name' },
            on: {
                SUBMIT: [
                    {
                        target:  'ask_path',
                        guard:   'isValidText',
                        actions: [{ type: 'record' }, { type: 'updateContext', params: { mapValueTo: 'name' } }],
                    },
                    {
                        actions: [
                            { type: 'recordValidationFailure' },
                            { type: 'updateContext', params: { mapValueTo: 'inputError', fromEvent: 'value' } },
                        ],
                    },
                ],
            },
        },
        ask_path: {
            meta: { text: 'Choose a path:' },
            on: {
                PATH_A: { target: 'done_a', actions: [{ type: 'record' }] },
                PATH_B: { target: 'done_b', actions: [{ type: 'record' }] },
            },
        },
        done_a: {
            meta: { text: 'Path A complete.' },
            type: 'final',
        },
        done_b: {
            meta: { text: 'Path B complete.' },
            type: 'final',
        },
    },
};

const INLINE_SERVICES = {
    guards: {
        isValidText: ({ event }) => !!event.value && event.value.trim().length > 0,
    },
};

// ── Inline paths ──────────────────────────────────────────────────────────────

const INLINE_PATHS = [
    {
        name: 'inline_happy_path_a',
        steps: [
            { submit: 'Alice' },
            { send:   'PATH_A' },
        ],
    },
    {
        name: 'inline_happy_path_b',
        steps: [
            { submit: 'Bob' },
            { send:   'PATH_B' },
        ],
    },
    {
        name: 'inline_validation_then_recover',
        steps: [
            { submit: '' },         // fails guard — stays in ask_name with error
            { submit: 'Carol' },    // passes guard — moves to ask_path
            { send:   'PATH_A' },
        ],
    },
];

// ── Realtor paths ─────────────────────────────────────────────────────────────
//
// Two paths through realtor-machine.json covering distinct branches:
//
//   realtor_soon_rent_transcript:
//     ask_email → ask_status → ask_timing (RENT skips ask_order) →
//     ask_phone → route_by_timing [transient] → closing_soon →
//     send_transcript [async] → upload_context [async] → finish_screen
//
//   realtor_later_own_no_transcript:
//     ask_email → ask_status → ask_order → ask_timing →
//     ask_phone → route_by_timing [transient] → closing_later →
//     upload_context [async] → finish_screen

const REALTOR_PATHS = [
    {
        name: 'realtor_soon_rent_transcript',
        steps: [
            { submit: 'test@example.com' },
            { send:   'RENT' },
            { send:   'SOON' },
            { submit: '4155550123' },
            // route_by_timing (always-transient) — no step needed, settled by wait
            { send:   'YES' },
            // send_transcript + upload_context (async services) — settled by wait
        ],
    },
    {
        name: 'realtor_later_own_no_transcript',
        steps: [
            { submit: 'test@example.com' },
            { send:   'OWN' },
            { send:   'SELL_FIRST' },
            { send:   'LATER' },
            { submit: '4155550123' },
            // route_by_timing (always-transient) — settled by wait
            { send:   'NO' },
            // upload_context (async service) — settled by wait
        ],
    },
];

// ── Realtor fixture loader ────────────────────────────────────────────────────

const REALTOR_MACHINE_URL  = new URL('./realtor-machine.json',  import.meta.url).href;
const REALTOR_SERVICES_URL = new URL('./realtor-services.js',   import.meta.url).href;

let _realtorMachine   = null;
let _realtorServices  = null;

async function loadRealtorFixture() {
    if (!_realtorMachine) {
        const [machine, mod] = await Promise.all([
            fetch(REALTOR_MACHINE_URL, { cache: 'no-store' }).then(r => r.json()),
            import(REALTOR_SERVICES_URL),
        ]);
        _realtorMachine  = machine;
        _realtorServices = mod.realtorServices;
    }
    return { machine: _realtorMachine, services: _realtorServices };
}

// ── Runner ────────────────────────────────────────────────────────────────────

const wait = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Run a single test path against the given machine + services.
 * Returns an array of snapshot records — one pushed per onSnapshot call,
 * so transient states and async service states appear in the sequence.
 */
async function runPath(path, machine, services) {
    const snapshots = [];

    const rt = new Runtime(machine, services);
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
    await wait(0);   // allow initial subscription snapshot to fire

    for (const step of path.steps) {
        if (step.submit !== undefined) {
            rt.submit(step.submit);
        } else if (step.send) {
            rt.send(step.send);
        }
        // 50ms: enough for always-transients (sync) and 0ms mock services (one tick)
        await wait(50);
    }

    return snapshots;
}

/**
 * Run all suites and return the full result set.
 */
async function runAll() {
    const timestamp  = new Date().toISOString();
    const appVersion = window._appVersion ?? null;
    const results    = [];

    // Inline suite
    for (const path of INLINE_PATHS) {
        const snapshots = await runPath(path, INLINE_MACHINE, INLINE_SERVICES);
        results.push({ name: path.name, snapshots });
    }

    // Realtor suite
    let realtorFixture;
    try {
        realtorFixture = await loadRealtorFixture();
    } catch (e) {
        console.warn(`⚠️  Could not load realtor fixture — skipping realtor suite: ${e.message}`);
        realtorFixture = null;
    }

    if (realtorFixture) {
        for (const path of REALTOR_PATHS) {
            const snapshots = await runPath(path, realtorFixture.machine, realtorFixture.services);
            results.push({ name: path.name, snapshots });
        }
    }

    return { timestamp, appVersion, results };
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

    const baseMap = Object.fromEntries(baseline.results.map(r => [r.name, r]));
    const currMap = Object.fromEntries(current.results.map(r => [r.name, r]));

    for (const name of Object.keys(baseMap)) {
        if (!currMap[name]) missingPaths.push(name);
    }

    for (const name of Object.keys(currMap)) {
        if (!baseMap[name]) { newPaths.push(name); continue; }

        const baseSnaps = baseMap[name].snapshots;
        const currSnaps = currMap[name].snapshots;

        if (currSnaps.length !== baseSnaps.length) {
            failures.push({
                path:     name,
                reason:   `snapshot count changed: baseline ${baseSnaps.length}, now ${currSnaps.length}`,
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

function report(comparison) {
    const { failures, warnings, passed, newPaths, missingPaths } = comparison;
    const allPassed = failures.length === 0;

    console.group(
        `%c🧪 Runtime Contracts — ${allPassed ? '✅ PASSED' : '❌ FAILED'} ` +
        `(${passed.length} passed, ${failures.length} failed, ${warnings.length} warnings)`,
        `color:${allPassed ? '#98c379' : '#e06c75'}; font-weight:bold; font-size:13px;`
    );

    if (failures.length) {
        console.group(`❌ Failures (${failures.length})`);
        failures.forEach(f => {
            const loc = f.step !== undefined ? ` step ${f.step}` : '';
            console.error(
                `  ❌ [${f.path}]${loc} ${f.field ?? ''}: ${f.reason}` +
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

const BASELINE_URL = './test/runtime-baseline.json';

async function runtime_contracts(mode) {
    if (!mode) {
        try {
            const res = await fetch(BASELINE_URL, { cache: 'no-store' });
            mode = res.ok ? 'check' : 'capture';
        } catch {
            mode = 'capture';
        }
        if (mode === 'capture') {
            console.info(
                '📋 Runtime Contracts — no baseline found.\n' +
                '   Run: await window.runtime_contracts(\'capture\')  to create one.\n' +
                '   Commit runtime-baseline.json alongside this file.'
            );
        }
    }

    console.group(`🧪 Runtime Contracts [${mode}]`);

    if (mode === 'capture') {
        console.log('▶ Running all suites (inline + realtor)…');
        const data = await runAll();

        const json     = JSON.stringify(data, null, 2);
        const filename = 'runtime-baseline.json';
        console.log('%c✅ Baseline captured. Commit runtime-baseline.json.', 'color:#98c379; font-weight:bold;');

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
            console.info(`   Run: await window.runtime_contracts('capture')  to create one.`);
            console.groupEnd();
            return null;
        }

        console.log('▶ Running all suites (inline + realtor)…');
        const current    = await runAll();
        const comparison = compareToBaseline(current, baseline);
        const allPassed  = report(comparison);

        console.groupEnd();
        return { allPassed, comparison, current, baseline };
    }
}

// ── Expose on window ──────────────────────────────────────────────────────────

window.runtime_contracts = runtime_contracts;
