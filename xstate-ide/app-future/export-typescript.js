/**
 * export-typescript.js
 *
 * Generates a single XState v5 TypeScript file from a loaded machine config,
 * using the setup().createMachine() pattern that Stately expects.
 *
 * Usage (browser console):
 *   window.exportToTypeScript()
 *   window.exportToTypeScript({ nometa: true })  — strip meta for Stately editor
 *
 * Output ZIP:
 *   {id}-machine.ts   — setup().createMachine() with typed stubs + context/event types
 *   package.json      — xstate ^5 + typescript ^5
 *   tsconfig.json
 */

// ── Helpers ────────────────────────────────────────────────────────────────────

function toPascalCase(str) {
    return str.split(/[-_\s]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

const IDENT_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/** Recursively convert a JSON value to a JS object literal string. */
function toLiteral(val, depth = 0) {
    const pad  = '  '.repeat(depth);
    const pad1 = '  '.repeat(depth + 1);

    if (val === undefined)        return 'undefined';
    if (val === null)             return 'null';
    if (typeof val === 'boolean') return String(val);
    if (typeof val === 'number')  return String(val);
    if (typeof val === 'string')  return JSON.stringify(val);
    if (typeof val === 'function') return 'undefined'; // functions not serialisable as literals

    if (Array.isArray(val)) {
        if (val.length === 0) return '[]';
        const items = val.map(v => `${pad1}${toLiteral(v, depth + 1)}`).join(',\n');
        return `[\n${items},\n${pad}]`;
    }

    const keys = Object.keys(val);
    if (keys.length === 0) return '{}';
    const entries = keys.map(k => {
        const key = IDENT_RE.test(k) ? k : JSON.stringify(k);
        return `${pad1}${key}: ${toLiteral(val[k], depth + 1)}`;
    }).join(',\n');
    return `{\n${entries},\n${pad}}`;
}

/** Infer a simple TS type from a JSON value. */
function inferType(val) {
    if (val === null)             return 'null';
    if (typeof val === 'boolean') return 'boolean';
    if (typeof val === 'number')  return 'number';
    if (typeof val === 'string')  return 'string';
    if (Array.isArray(val))       return 'unknown[]';
    return 'Record<string, unknown>';
}

function normBranches(val) {
    if (!val) return [];
    return Array.isArray(val) ? val : [val];
}

/** Collect all event type strings from on:{} across all states. */
function collectEvents(config) {
    const events = new Set();
    for (const s of Object.values(config.states ?? {}))
        for (const e of Object.keys(s.on ?? {}))
            events.add(e);
    return [...events].sort();
}

// Runtime-internal action names — handled automatically, must not appear as stubs.
const RUNTIME_ACTIONS = new Set(['initTrace', 'record', 'recordValidationFailure', 'recordService']);

/** Collect guard names, actor src names, and named action strings. */
function collectImplementations(config) {
    const guards  = new Set();
    const actors  = new Set();
    const actions = new Set();

    function scanActions(val) {
        for (const a of normBranches(val))
            if (typeof a === 'string' && !RUNTIME_ACTIONS.has(a)) actions.add(a);
    }

    function scanBranches(branches) {
        for (const b of branches) {
            if (typeof b.guard === 'string') guards.add(b.guard);
            scanActions(b.actions ?? []);
        }
    }

    scanActions(config.entry ?? []);

    for (const s of Object.values(config.states ?? {})) {
        scanActions(s.entry ?? []);
        scanActions(s.exit  ?? []);
        for (const v of Object.values(s.on ?? {})) scanBranches(normBranches(v));
        scanBranches(normBranches(s.always ?? []));
        if (s.invoke) {
            if (typeof s.invoke.src === 'string') actors.add(s.invoke.src);
            scanBranches(normBranches(s.invoke.onDone  ?? []));
            scanBranches(normBranches(s.invoke.onError ?? []));
        }
    }

    return {
        guards:  [...guards].sort(),
        actors:  [...actors].sort(),
        actions: [...actions].sort(),
    };
}

/** Recursively strip all `meta` keys from a config object. */
function stripMeta(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (k === 'meta') continue;
        out[k] = stripMeta(v);
    }
    return out;
}

/**
 * Extract any declarations that appear before the first `export` keyword in a
 * services source string (e.g. `const validators = { ... }`).  These are helper
 * variables that the exported functions close over — they must be included in the
 * generated .ts so the inlined guard/action/actor bodies can reference them.
 * Returns an empty string when there is no preamble or no source.
 */
function extractServicesPreamble(source) {
    if (!source) return '';
    const exportIdx = source.search(/\bexport\b/);
    if (exportIdx <= 0) return '';
    const preamble = source.slice(0, exportIdx).trimEnd();
    return preamble || '';
}

// ── machine.ts generator ──────────────────────────────────────────────────────

export function generateMachineTs(config, { nometa = false, services = null, servicesSource = null, preamble: inlinedPreamble = null, setupBlock = null } = {}) {
    const name   = toPascalCase(config.id ?? 'machine');
    const events = collectEvents(config);
    const { guards, actors, actions } = collectImplementations(config);

    // Imports — only pull in fromPromise/assign if the machine uses them.
    // When setupBlock is present, scan it for usage rather than checking collected names.
    const imports = ['setup'];
    const needsFromPromise = setupBlock ? setupBlock.includes('fromPromise') : actors.length > 0;
    const needsAssign      = setupBlock ? setupBlock.includes('assign')      : actions.length > 0;
    if (needsFromPromise) imports.push('fromPromise');
    if (needsAssign)      imports.push('assign');
    const importLine = `import { ${imports.join(', ')} } from 'xstate';`;

    // Context type — skip internal trace bookkeeping fields
    const SKIP = new Set(['trace', '_trace']);
    const ctxFields = Object.entries(config.context ?? {})
        .filter(([k]) => !SKIP.has(k))
        .map(([k, v]) => `  ${k}: ${inferType(v)};`)
        .join('\n') || '  // (no context fields)';

    // Events union
    const eventUnion = events.length
        ? events.map(e => `  | { type: '${e}'; value?: string }`).join('\n')
        : `  | { type: string }`;

    // setup() implementations — real functions from services if available, stubs otherwise.
    // fn.toString() on an arrow function returns just the function source, ready to inline.
    const guardImpls = guards.map(g => {
        const fn = services?.guards?.[g];
        const body = (typeof fn === 'function') ? fn.toString() : '() => false';
        return `    ${g}: ${body},`;
    }).join('\n');

    const actorImpls = actors.map(a => {
        const fn = services?.[a];
        let body;
        if (typeof fn === 'function')                              body = fn.toString();
        else if (fn && typeof fn.config === 'function')            body = fn.config.toString(); // pre-built fromPromise logic
        else                                                       body = 'async () => {}';
        return `    ${a}: fromPromise(${body}),`;
    }).join('\n');

    const actionImpls = actions.map(a => {
        const fn = services?.actions?.[a];
        let body;
        if (typeof fn === 'function')                              body = fn.toString();
        else if (fn && typeof fn.params === 'function')            body = fn.params.toString(); // pre-built assign() object
        else                                                       body = '() => ({})';
        return `    ${a}: assign(${body}),`;
    }).join('\n');

    // Machine config — strip types key (moved into setup), optionally strip meta
    const { types: _t, ...cfg } = config;
    const cleanCfg = nometa ? stripMeta(cfg) : cfg;
    const cfgStr   = toLiteral(cleanCfg, 0);

    // Preamble: helper variables the inlined functions close over (e.g. `const validators`).
    // Supplied directly when loaded from .ts (inlinedPreamble); otherwise extracted from
    // servicesSource by finding everything before the first `export` keyword.
    const preamble = inlinedPreamble ?? (services ? extractServicesPreamble(servicesSource) : '');

    // SAMPLE_INPUTS — exported as a named constant so .ts round-trips preserve it.
    const sampleInputs = services?.SAMPLE_INPUTS;
    const sampleBlock = sampleInputs && Object.keys(sampleInputs).length
        ? [
            `// ── Sample Inputs (for IDE test runner) ──────────────────────────────────────`,
            `export const SAMPLE_INPUTS: Record<string, string> = ${JSON.stringify(sampleInputs, null, 2)};`,
            ``,
        ] : [];

    // When a raw setup({...}) block was captured on .ts load, reuse it verbatim.
    // This is more reliable than reconstructing from machine.implementations.
    if (setupBlock) {
        return [
            importLine,
            ``,
            `// ── Types ───────────────────────────────────────────────────────────────────`,
            `export type ${name}Context = {`,
            ctxFields,
            `};`,
            ``,
            `export type ${name}Event =`,
            eventUnion,
            `  ;`,
            ``,
            ...(preamble ? [
                `// ── Helpers ────────────────────────────────────────────────────────────────`,
                preamble,
                ``,
            ] : []),
            `// ── Machine ─────────────────────────────────────────────────────────────────`,
            `export const machine = ${setupBlock}`,
            `.createMachine(${cfgStr});`,
            ``,
            ...sampleBlock,
        ].join('\n');
    }

    const setupParts = [
        `  types: {} as {\n    context: ${name}Context;\n    events: ${name}Event;\n  },`,
        guards.length  ? `  guards: {\n${guardImpls}\n  },`  : '',
        actors.length  ? `  actors: {\n${actorImpls}\n  },`  : '',
        actions.length ? `  actions: {\n${actionImpls}\n  },` : '',
    ].filter(Boolean).join('\n');

    return [
        importLine,
        ``,
        `// ── Types ───────────────────────────────────────────────────────────────────`,
        `export type ${name}Context = {`,
        ctxFields,
        `};`,
        ``,
        `export type ${name}Event =`,
        eventUnion,
        `  ;`,
        ``,
        ...(preamble ? [
            `// ── Helpers (from services.js) ──────────────────────────────────────────────`,
            preamble,
            ``,
        ] : []),
        `// ── Machine ─────────────────────────────────────────────────────────────────`,
        `export const machine = setup({`,
        setupParts,
        `}).createMachine(${cfgStr});`,
        ``,
        ...sampleBlock,
    ].join('\n');
}

// ── Project file generators ───────────────────────────────────────────────────

function generatePackageJson(id) {
    return JSON.stringify({
        name: id.replace(/_/g, '-'),
        version: '1.0.0',
        private: true,
        dependencies: {
            xstate: '^5',
        },
        devDependencies: {
            typescript: '^5',
        },
    }, null, 2) + '\n';
}

function generateTsConfig() {
    return JSON.stringify({
        compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            esModuleInterop: true,
        },
    }, null, 2) + '\n';
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * exportToTypeScript(config, { nometa?, services?, servicesSource? })
 *
 * Downloads {id}-xstate.zip containing:
 *   {id}-machine.ts  — setup().createMachine() with real implementations (if services
 *                       provided) or typed stubs, + context/event types
 *   package.json
 *   tsconfig.json
 *
 * When services is provided, guard/actor/action bodies are inlined via fn.toString()
 * so Stately simulate can run the machine end-to-end without a companion .js file.
 * servicesSource is used to extract helper variable declarations (e.g. validators)
 * that the inlined functions close over.
 */
export async function exportToTypeScript(config, { nometa = false, services = null, servicesSource = null, preamble = null, setupBlock = null } = {}) {
    if (!config?.states) {
        console.warn('⚠️  exportToTypeScript: no machine config loaded');
        return null;
    }

    const id        = config.id ?? 'machine';
    const machineTs = generateMachineTs(config, { nometa, services, servicesSource, preamble, setupBlock });
    const pkgJson   = generatePackageJson(id);
    const tsConfig  = generateTsConfig();

    const { default: JSZip } = await import('https://esm.sh/jszip');
    const zip = new JSZip();
    zip.file(`${id}-machine.ts`, machineTs);
    zip.file('package.json',     pkgJson);
    zip.file('tsconfig.json',    tsConfig);

    const blob = await zip.generateAsync({ type: 'blob' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `${id}-xstate.zip`;
    a.click();
    URL.revokeObjectURL(a.href);

    const implNote = services ? 'real implementations inlined' : 'typed stubs — fill in to run';
    console.group(`📤 TypeScript export: ${id}`);
    console.log(`✅ ${id}-xstate.zip`);
    console.log(`     ${id}-machine.ts  — setup().createMachine() with ${implNote}`);
    console.log(`     package.json      — xstate ^5 + typescript ^5`);
    console.log(`     tsconfig.json`);
    console.log(`\nNext steps:`);
    console.log(`  1. Unzip and run: npm install`);
    console.log(`  2. Open the folder in VS Code with the Stately extension`);
    console.log(`  3. The extension will visualize ${id}-machine.ts automatically`);
    if (!services) console.log(`  4. Fill in the stub implementations in setup() to run the machine`);
    console.groupEnd();

    return { machineTs, pkgJson, tsConfig };
}
