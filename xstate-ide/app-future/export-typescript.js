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

// ── machine.ts generator ──────────────────────────────────────────────────────

export function generateMachineTs(config, { nometa = false } = {}) {
    const name   = toPascalCase(config.id ?? 'machine');
    const events = collectEvents(config);
    const { guards, actors, actions } = collectImplementations(config);

    // Imports — only pull in fromPromise/assign if the machine uses them
    const imports = ['setup'];
    if (actors.length)  imports.push('fromPromise');
    if (actions.length) imports.push('assign');
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

    // setup() stubs
    const guardStubs = guards.map(g =>
        `    ${g}: () => false,`
    ).join('\n');

    const actorStubs = actors.map(a =>
        `    ${a}: fromPromise(async () => {}),`
    ).join('\n');

    const actionStubs = actions.map(a =>
        `    ${a}: assign(() => ({})),`
    ).join('\n');

    const setupParts = [
        `  types: {} as {\n    context: ${name}Context;\n    events: ${name}Event;\n  },`,
        guards.length  ? `  guards: {\n${guardStubs}\n  },`  : '',
        actors.length  ? `  actors: {\n${actorStubs}\n  },`  : '',
        actions.length ? `  actions: {\n${actionStubs}\n  },` : '',
    ].filter(Boolean).join('\n');

    // Machine config — strip types key (moved into setup), optionally strip meta
    const { types: _t, ...cfg } = config;
    const cleanCfg = nometa ? stripMeta(cfg) : cfg;
    const cfgStr   = toLiteral(cleanCfg, 0);

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
        `// ── Machine ─────────────────────────────────────────────────────────────────`,
        `export const machine = setup({`,
        setupParts,
        `}).createMachine(${cfgStr});`,
        ``,
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
 * exportToTypeScript(config, { nometa? })
 *
 * Downloads {id}-xstate.zip containing:
 *   {id}-machine.ts  — setup().createMachine() with stubs + context/event types
 *   package.json
 *   tsconfig.json
 */
export async function exportToTypeScript(config, { nometa = false } = {}) {
    if (!config?.states) {
        console.warn('⚠️  exportToTypeScript: no machine config loaded');
        return null;
    }

    const id        = config.id ?? 'machine';
    const machineTs = generateMachineTs(config, { nometa });
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

    console.group(`📤 TypeScript export: ${id}`);
    console.log(`✅ ${id}-xstate.zip`);
    console.log(`     ${id}-machine.ts  — setup().createMachine() with typed stubs`);
    console.log(`     package.json      — xstate ^5 + typescript ^5`);
    console.log(`     tsconfig.json`);
    console.log(`\nNext steps:`);
    console.log(`  1. Unzip and run: npm install`);
    console.log(`  2. Open the folder in VS Code with the Stately extension`);
    console.log(`  3. The extension will visualize ${id}-machine.ts automatically`);
    console.log(`  4. Fill in the stub implementations in setup() to run the machine`);
    console.groupEnd();

    return { machineTs, pkgJson, tsConfig };
}
