/**
 * load-contracts.js
 *
 * Automated tests for the Task 8 unified load/save format.
 * All suites are deterministic assertions — no baseline file needed.
 *
 * Suite 1 — Toolbar DOM structure (structural, always runs):
 *   Verifies load-btn is present, load-flow-btn and load-results-btn are absent,
 *   and save-results-btn is present. Checks enabled/hidden states in flow_idle.
 *
 * Suite 2 — Load routing (functional, always runs):
 *   Constructs each file type as a File object and passes it directly to
 *   window.loadPair(). No file picker involved. Checks the routing outcome:
 *     a) Results ZIP  → window._testResults.flowId matches
 *     b) Results JSON → backward compat, same check
 *     c) Flow ZIP     → window._config.id matches
 *     d) Machine JSON → window._config.id matches
 *     e) Services JS  → window._loadedServicesSource contains test marker
 *
 * Suite 3 — Results ZIP round-trip (functional, always runs):
 *   Builds a results ZIP the same way downloadTestResults() does, loads it via
 *   loadPair(), verifies window._testResults is fully restored.
 *
 * Usage:
 *   await window.contracts.load()
 */

import { zipSync, strToU8 } from 'fflate';

const MACHINE_URL  = new URL('../fixtures/realtor-machine.json', import.meta.url).href;
const SERVICES_URL = new URL('../fixtures/realtor-services.js',  import.meta.url).href;

const waitMs = (ms) => new Promise(r => setTimeout(r, ms));

// Minimal results object — null config/servicesSource so _applyLoadedResults
// does not trigger _restartRuntime or _reloadServicesFromSource.
// path must be a 1-based number so showResultsDrawer's caseMap keys correctly
// (caseMap uses c.path - 1 as key; a non-numeric path gives NaN, misses the
// map lookup, and falls through to allPaths[i] which is null[0] → TypeError).
function makeFakeResults(flowId) {
    return {
        flowId,
        runAt:     '2026-04-01T00:00:00.000Z',
        pathCount: 1,
        total:     1,
        passed:    1,
        failed:    0,
        allPaths:  null,
        cases:     [{ id: 0, path: 1, status: 'pass', passed: true, skipped: false, expected: [], actual: [] }],
        config:    null,
        servicesSource: null,
    };
}

// ── Suite 1: Toolbar DOM structure ────────────────────────────────────────────

async function suiteToolbarDOM() {
    const issues = [];

    // Load realtor flow to get to a known flow_idle state.
    await window._loadFlowFromUrl(MACHINE_URL, SERVICES_URL);
    await waitMs(150);

    const checks = [
        ['load-btn present',                    () => !!document.getElementById('load-btn')],
        ['load-flow-btn absent',                () => !document.getElementById('load-flow-btn')],
        ['load-results-btn absent',             () => !document.getElementById('load-results-btn')],
        ['save-results-btn present',            () => !!document.getElementById('save-results-btn')],
        ['load-btn enabled in flow_idle',       () => !document.getElementById('load-btn')?.disabled],
        ['save-results-btn disabled in flow_idle', () => document.getElementById('save-results-btn')?.disabled === true],
        ['save-flow-btn hidden in flow_idle',   () => document.getElementById('save-flow-btn')?.style.display === 'none'],
    ];

    for (const [label, check] of checks) {
        try {
            if (!check()) issues.push(label);
        } catch (e) {
            issues.push(`${label} (threw: ${e.message})`);
        }
    }

    return issues;
}

// ── Suite 2: Load routing ─────────────────────────────────────────────────────

async function suiteLoadRouting() {
    const issues = [];

    // 2a — Results ZIP
    {
        const results = makeFakeResults('zip_routed');
        const zipped  = zipSync({ 'results.json': strToU8(JSON.stringify(results)) });
        const file    = new File([zipped], 'test-results-zip_routed-2026-04-01.zip', { type: 'application/zip' });
        window._testResults = null;
        await window.loadPair([file]);
        await waitMs(300);   // arrayBuffer + _applyLoadedResults settle
        if (window._testResults?.flowId !== 'zip_routed') {
            issues.push(`2a Results ZIP: expected flowId 'zip_routed', got '${window._testResults?.flowId}'`);
        }
    }

    // 2b — Results JSON (backward compat)
    {
        const results = makeFakeResults('json_routed');
        const file    = new File([JSON.stringify(results)], 'test-results-json_routed-2026-04-01.json', { type: 'application/json' });
        window._testResults = null;
        await window.loadPair([file]);
        await waitMs(300);   // FileReader settle
        if (window._testResults?.flowId !== 'json_routed') {
            issues.push(`2b Results JSON: expected flowId 'json_routed', got '${window._testResults?.flowId}'`);
        }
    }

    // 2c — Flow ZIP
    {
        const [machineText, servicesText] = await Promise.all([
            fetch(MACHINE_URL).then(r => r.text()),
            fetch(SERVICES_URL).then(r => r.text()),
        ]);
        const id     = JSON.parse(machineText).id;
        const zipped = zipSync({
            [`${id}-machine.json`]: strToU8(machineText),
            [`${id}-services.js`]:  strToU8(servicesText),
        });
        const file = new File([zipped], `${id}.zip`, { type: 'application/zip' });
        await window.loadPair([file]);
        await waitMs(200);
        if (window._config?.id !== id) {
            issues.push(`2c Flow ZIP: expected config.id '${id}', got '${window._config?.id}'`);
        }
    }

    // 2d — Machine JSON alone (resets services)
    {
        const machineText = await fetch(MACHINE_URL).then(r => r.text());
        const id   = JSON.parse(machineText).id;
        const file = new File([machineText], `${id}-machine.json`, { type: 'application/json' });
        await window.loadPair([file]);
        await waitMs(200);
        if (window._config?.id !== id) {
            issues.push(`2d Machine JSON: expected config.id '${id}', got '${window._config?.id}'`);
        }
    }

    // 2e — Services JS (hot-patch onto current flow)
    {
        const MARKER = '// load-contracts-services-test-marker';
        const file = new File([MARKER], 'test-services.js', { type: 'text/javascript' });
        await window.loadPair([file]);
        await waitMs(200);
        if (!window._loadedServicesSource?.includes(MARKER)) {
            issues.push(`2e Services JS: _loadedServicesSource does not contain the test marker`);
        }
    }

    return issues;
}

// ── Suite 3: Results ZIP round-trip ───────────────────────────────────────────

async function suiteResultsRoundTrip() {
    const issues = [];

    const original = makeFakeResults('roundtrip');
    // Construct the ZIP exactly as downloadTestResults() does.
    const zipped   = zipSync({ 'results.json': strToU8(JSON.stringify(original, null, 2)) });
    const file     = new File([zipped], 'test-results-roundtrip-2026-04-01.zip', { type: 'application/zip' });

    window._testResults = null;
    await window.loadPair([file]);
    await waitMs(300);

    const loaded = window._testResults;
    if (!loaded) {
        issues.push('Round-trip: window._testResults is null after loading ZIP');
    } else {
        if (loaded.flowId         !== original.flowId)         issues.push(`Round-trip: flowId mismatch — '${loaded.flowId}' vs '${original.flowId}'`);
        if (loaded.runAt          !== original.runAt)          issues.push(`Round-trip: runAt mismatch`);
        if (loaded.cases?.length  !== original.cases.length)   issues.push(`Round-trip: cases.length mismatch — ${loaded.cases?.length} vs ${original.cases.length}`);
    }

    return issues;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
// Reload the realtor flow so the IDE is in a clean state after the suite.

async function restoreCleanState() {
    window._setSmideState?.('no_flow');
    await waitMs(150);
    window._regressionTestMode = false;
    localStorage.removeItem('xstate-ide:regression-flow');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function load_contracts() {
    window._regressionTestMode = true;
    console.group('📋 Load Contracts');
    let totalIssues = 0;

    const suites = [
        ['Suite 1 — Toolbar DOM structure', suiteToolbarDOM],
        ['Suite 2 — Load routing',          suiteLoadRouting],
        ['Suite 3 — Results ZIP round-trip', suiteResultsRoundTrip],
    ];

    for (const [name, fn] of suites) {
        console.group(name);
        try {
            const issues = await fn();
            if (issues.length === 0) {
                console.log('✅ All checks passed');
            } else {
                issues.forEach(m => console.error('❌', m));
                totalIssues += issues.length;
            }
        } catch (e) {
            console.error('❌ Suite threw:', e);
            totalIssues++;
        }
        console.groupEnd();
    }

    await restoreCleanState();

    if (totalIssues === 0) {
        console.log('%c📋 Load Contracts — ✅ PASSED', 'color:#98c379; font-weight:bold; font-size:13px;');
    } else {
        console.log(`%c📋 Load Contracts — ❌ FAILED (${totalIssues} issue(s))`, 'color:#e06c75; font-weight:bold; font-size:13px;');
    }

    console.groupEnd();
    return totalIssues === 0;
}

// ── Expose on window ──────────────────────────────────────────────────────────

window.contracts       = window.contracts       || {};
window.contracts.load  = load_contracts;
window.contracts.clear = () => {
    localStorage.removeItem('xstate-ide:regression-flow');
    console.log('🧹 Regression session cleared — user restore state is unaffected');
};

// Run all contracts except ui (no fixed viewport required).
window.contracts.all = async () => {
    await window.contracts.runtime();
    await window.contracts.smide();
    await window.contracts.load();
};
