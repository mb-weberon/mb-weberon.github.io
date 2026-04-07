/**
 * ts-roundtrip-contracts.js
 *
 * Tests the full TypeScript round-trip scenario:
 *   1. Load realtor JSON+JS fixture
 *   2. Generate TS export
 *   3. Load the TS back (simulating xstate.zip load)
 *   4. Verify config, services, SAMPLE_INPUTS survived
 *   5. Extract derived services.js from setup block
 *   6. Reload with just machine.json + derived services.js
 *   7. Verify SAMPLE_INPUTS present, guards work, tests can run
 *
 * Usage:
 *   await window.contracts.tsRoundtrip()
 */

const MACHINE_URL  = new URL('../fixtures/realtor-machine.json', import.meta.url).href;
const SERVICES_URL = new URL('../fixtures/realtor-services.js',  import.meta.url).href;

const waitMs = (ms) => new Promise(r => setTimeout(r, ms));

// ── Suite 1: TS export → TS load round-trip ──────────────────────────────────

async function suiteExportAndReload() {
    const issues = [];

    // Step 1: Load the realtor JSON+JS fixture
    await window._loadFlowFromUrl(MACHINE_URL, SERVICES_URL);
    await waitMs(300);

    const origId = window._config?.id;
    if (!origId) { issues.push('1a: No config after loading fixture'); return issues; }

    const origSampleInputs = window.currentRuntime?.services?.SAMPLE_INPUTS;
    if (!origSampleInputs) { issues.push('1b: No SAMPLE_INPUTS in loaded fixture'); return issues; }

    // Step 2: Generate TS source (same as exportToTypeScript but without downloading)
    const exportModule = await import('../../export-typescript.js');
    const services       = window.currentRuntime?.services ?? null;
    const servicesSource = window._loadedServicesSource ?? null;
    const preamble       = window._loadedTsPreamble ?? null;
    const setupBlock     = window._loadedTsSetupBlock ?? null;
    const tsSource = exportModule.generateMachineTs(window._config, { services, servicesSource, preamble, setupBlock });

    if (!tsSource) { issues.push('2a: generateMachineTs returned null'); return issues; }
    if (!tsSource.includes('export const machine')) {
        issues.push('2b: TS source missing "export const machine"');
    }
    if (!tsSource.includes('SAMPLE_INPUTS')) {
        issues.push('2c: TS source missing SAMPLE_INPUTS export');
    }

    // Step 3: Load the TS source back (simulates loading xstate.zip with .ts inside)
    // Use the internal loadAndActivateTsFlow path via loadPair with a .ts File
    const tsFile = new File([tsSource], `${origId}-machine.ts`, { type: 'text/plain' });
    await window.loadPair([tsFile]);
    await waitMs(500);

    // Step 4: Verify config survived
    if (window._config?.id !== origId) {
        issues.push(`4a: Config id mismatch after TS load — expected '${origId}', got '${window._config?.id}'`);
    }
    if (!window._loadedPrebuiltMachine) {
        issues.push('4b: _loadedPrebuiltMachine not set after TS load');
    }

    // Step 5: Verify SAMPLE_INPUTS survived into activeServices
    const tsServices = window.currentRuntime?.services;
    if (!tsServices?.SAMPLE_INPUTS) {
        issues.push('5a: SAMPLE_INPUTS missing after TS load');
    } else {
        for (const [key, val] of Object.entries(origSampleInputs)) {
            if (tsServices.SAMPLE_INPUTS[key] !== val) {
                issues.push(`5b: SAMPLE_INPUTS['${key}'] mismatch — expected '${val}', got '${tsServices.SAMPLE_INPUTS[key]}'`);
            }
        }
    }

    return issues;
}

// ── Suite 2: Derived services.js from TS ─────────────────────────────────────
// After Suite 1, the IDE has a TS-loaded flow. This suite extracts the derived
// services.js, reloads it as a plain JSON+JS flow, and verifies everything works.

async function suiteDerivedServices() {
    const issues = [];

    if (!window._loadedPrebuiltMachine) {
        issues.push('Pre: Not in TS-loaded state (run Suite 1 first)');
        return issues;
    }

    const origId = window._config?.id;
    const setupBlock = window._loadedTsSetupBlock;
    if (!setupBlock) { issues.push('1a: No setupBlock available'); return issues; }

    // Step 1: Build derived services.js (same logic as getSourceData)
    const services = window.currentRuntime?.services ?? null;
    const preamble = window._loadedTsPreamble ?? null;
    const inner = setupBlock.replace(/^setup\s*\(\s*/, '').replace(/\s*\)\s*$/, '');

    const sampleInputs = services?.SAMPLE_INPUTS;
    const sampleStr = sampleInputs && Object.keys(sampleInputs).length
        ? `\n  SAMPLE_INPUTS: ${JSON.stringify(sampleInputs, null, 2).replace(/\n/g, '\n  ')},`
        : '';

    const xstateImports = [];
    if (inner.includes('assign'))      xstateImports.push('assign');
    if (inner.includes('fromPromise')) xstateImports.push('fromPromise');
    const importLine = xstateImports.length
        ? `import { ${xstateImports.join(', ')} } from 'xstate';\n\n`
        : '';

    const preambleStr = preamble ? preamble + '\n\n' : '';

    let obj = inner;
    if (sampleStr) {
        const lastBrace = obj.lastIndexOf('}');
        if (lastBrace !== -1) {
            obj = obj.slice(0, lastBrace) + sampleStr + '\n' + obj.slice(lastBrace);
        }
    }

    const derivedSource = `${importLine}${preambleStr}export default ${obj};\n`;

    // Step 2: Verify derived source has expected content
    if (!derivedSource.includes('guards')) {
        issues.push('2a: Derived services.js missing guards');
    }
    if (!derivedSource.includes('SAMPLE_INPUTS')) {
        issues.push('2b: Derived services.js missing SAMPLE_INPUTS');
    }
    if (xstateImports.length && !derivedSource.includes('from \'xstate\'')) {
        issues.push('2c: Derived services.js missing xstate import');
    }

    // Step 3: Load machine.json + derived services.js as a plain JSON+JS flow
    const machineJson = JSON.stringify(window._config, null, 2);
    const machineFile = new File([machineJson], `${origId}-machine.json`, { type: 'application/json' });
    const servicesFile = new File([derivedSource], `${origId}-services.js`, { type: 'text/javascript' });

    await window.loadPair([machineFile, servicesFile]);
    await waitMs(500);

    // Step 4: Verify it loaded as a JSON+JS flow (not TS)
    if (window._config?.id !== origId) {
        issues.push(`4a: Config id mismatch after JSON+JS reload — expected '${origId}', got '${window._config?.id}'`);
    }
    if (window._loadedPrebuiltMachine) {
        issues.push('4b: _loadedPrebuiltMachine should be null after JSON+JS load');
    }
    if (!window._loadedServicesSource) {
        issues.push('4c: _loadedServicesSource should be set after JSON+JS load');
    }

    // Step 5: Verify SAMPLE_INPUTS present in reloaded services
    const reloadedServices = window.currentRuntime?.services;
    if (!reloadedServices?.SAMPLE_INPUTS) {
        issues.push('5a: SAMPLE_INPUTS missing after JSON+JS reload');
    } else {
        if (sampleInputs) {
            for (const [key, val] of Object.entries(sampleInputs)) {
                if (reloadedServices.SAMPLE_INPUTS[key] !== val) {
                    issues.push(`5b: SAMPLE_INPUTS['${key}'] mismatch after reload — expected '${val}', got '${reloadedServices.SAMPLE_INPUTS[key]}'`);
                }
            }
        }
    }

    // Step 6: Verify guards are functional
    const guards = reloadedServices?.guards;
    if (!guards) {
        issues.push('6a: No guards in reloaded services');
    } else {
        if (typeof guards.isValidEmail !== 'function') {
            issues.push('6b: isValidEmail guard is not a function');
        } else {
            const validResult = guards.isValidEmail({ event: { value: 'test@example.com' } });
            if (!validResult) issues.push('6c: isValidEmail guard returned false for valid email');
            const invalidResult = guards.isValidEmail({ event: { value: 'bad' } });
            if (invalidResult) issues.push('6d: isValidEmail guard returned true for invalid email');
        }
    }

    // Step 7: Verify actors are present
    const hasActors = reloadedServices?.actors
        ? Object.keys(reloadedServices.actors).length > 0
        : Object.keys(reloadedServices ?? {}).some(k =>
            !['guards', 'actions', 'actors', 'types', 'SAMPLE_INPUTS'].includes(k));
    if (!hasActors) {
        issues.push('7a: No actors found in reloaded services');
    }

    return issues;
}

// ── Suite 3: Bare specifier resolution ───────────────────────────────────────
// Verifies that `import { assign } from 'xstate'` works in services loaded via blob URL.

async function suiteBareSpecifiers() {
    const issues = [];

    const testSource = `
import { assign, fromPromise } from 'xstate';

export default {
    guards: {
        alwaysTrue: () => true,
    },
    actors: {
        mockService: fromPromise(async () => ({ ok: true })),
    },
    actions: {
        setFlag: assign({ flag: () => true }),
    },
    SAMPLE_INPUTS: {
        test_state: 'hello',
    },
};
`;

    // Load a minimal machine that references these
    const machineJson = JSON.stringify({
        id: 'specifier_test',
        initial: 'start',
        context: { flag: false },
        states: {
            start: {
                meta: { text: 'Start', input: 'text' },
                on: { SUBMIT: { target: 'done', guard: 'alwaysTrue', actions: 'setFlag' } },
            },
            done: { type: 'final', meta: { text: 'Done' } },
        },
    });

    const machineFile = new File([machineJson], 'specifier_test-machine.json', { type: 'application/json' });
    const servicesFile = new File([testSource], 'specifier_test-services.js', { type: 'text/javascript' });

    await window.loadPair([machineFile, servicesFile]);
    await waitMs(500);

    if (window._config?.id !== 'specifier_test') {
        issues.push(`1a: Config id mismatch — got '${window._config?.id}'`);
        return issues;
    }

    const svc = window.currentRuntime?.services;
    if (!svc) { issues.push('2a: No services loaded'); return issues; }

    // Verify SAMPLE_INPUTS
    if (svc.SAMPLE_INPUTS?.test_state !== 'hello') {
        issues.push(`3a: SAMPLE_INPUTS.test_state — expected 'hello', got '${svc.SAMPLE_INPUTS?.test_state}'`);
    }

    // Verify guard works
    if (typeof svc.guards?.alwaysTrue !== 'function') {
        issues.push('4a: alwaysTrue guard not a function');
    } else if (!svc.guards.alwaysTrue()) {
        issues.push('4b: alwaysTrue guard returned false');
    }

    // Verify assign action was loaded (it's an XState action object, not a plain function)
    const setFlag = svc.actions?.setFlag;
    if (!setFlag) {
        issues.push('5a: setFlag action not found');
    } else if (typeof setFlag === 'function') {
        // Plain function — old format, also fine
    } else if (typeof setFlag !== 'object') {
        issues.push('5b: setFlag action is neither function nor object');
    }

    // Verify fromPromise actor was loaded
    const mockService = svc.actors?.mockService ?? svc.mockService;
    if (!mockService) {
        issues.push('6a: mockService actor not found');
    }

    return issues;
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

async function restoreCleanState() {
    window._setSmideState?.('no_flow');
    await waitMs(150);
    window._regressionTestMode = false;
    localStorage.removeItem('xstate-ide:regression-flow');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function tsRoundtrip_contracts() {
    window._regressionTestMode = true;
    console.group('📋 TS Round-trip Contracts');
    let totalIssues = 0;

    const suites = [
        ['Suite 1 — TS export → TS load',         suiteExportAndReload],
        ['Suite 2 — Derived services.js from TS',  suiteDerivedServices],
        ['Suite 3 — Bare specifier resolution',    suiteBareSpecifiers],
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
        console.log('%c📋 TS Round-trip Contracts — ✅ PASSED', 'color:#98c379; font-weight:bold; font-size:13px;');
    } else {
        console.log(`%c📋 TS Round-trip Contracts — ❌ FAILED (${totalIssues} issue(s))`, 'color:#e06c75; font-weight:bold; font-size:13px;');
    }

    console.groupEnd();
    return totalIssues === 0;
}

// ── Expose on window ─────────────────────────────────────────────────────────

window.contracts = window.contracts || {};
window.contracts.tsRoundtrip = tsRoundtrip_contracts;
