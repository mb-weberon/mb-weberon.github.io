/**
 * export-typescript.js
 *
 * Generates XState v5 TypeScript source files from a loaded machine config
 * and services source. Produces files that work with the Stately VS Code
 * extension for visual editing.
 *
 * Usage (browser console):
 *   window.exportToTypeScript()
 *
 * Output:
 *   {id}-machine.ts   — createMachine() config with inferred context/event types
 *   {id}-services.ts  — typed implementations scaffold (or wrapped existing JS)
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

    if (val === null)             return 'null';
    if (typeof val === 'boolean') return String(val);
    if (typeof val === 'number')  return String(val);
    if (typeof val === 'string')  return JSON.stringify(val);

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

/** Collect guard names, actor src names, and named action strings. */
function collectImplementations(config) {
    const guards  = new Set();
    const actors  = new Set();
    const actions = new Set();

    function scanActions(val) {
        for (const a of normBranches(val))
            if (typeof a === 'string') actions.add(a);
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

    // Context type — skip internal trace bookkeeping fields
    const SKIP = new Set(['trace', '_trace']);
    const ctxFields = Object.entries(config.context ?? {})
        .filter(([k]) => !SKIP.has(k))
        .map(([k, v]) => `  ${k}: ${inferType(v)};`)
        .join('\n') || '  // (no context fields)';

    // Events union — include a value field as optional since many flows pass input text
    const eventUnion = events.length
        ? events.map(e => `  | { type: '${e}'; value?: string }`).join('\n')
        : `  | { type: string }`;

    // Config as JS literal, strip internal types field if present
    const { types: _t, ...cfg } = config;
    const cfgStr = toLiteral(nometa ? stripMeta(cfg) : cfg, 0);

    // Inject types as first property inside the config object
    const typesBlock =
        `\n  types: {} as {\n` +
        `    context: ${name}Context;\n` +
        `    events: ${name}Event;\n` +
        `  },`;
    const machineConfig = cfgStr.replace(/^\{/, '{' + typesBlock);

    // Implementation summary comment
    const implNotes = [
        guards.length  ? `//   Guards:  ${guards.join(', ')}`  : '',
        actors.length  ? `//   Actors:  ${actors.join(', ')}`  : '',
        actions.length ? `//   Actions: ${actions.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    return [
        `import { createMachine } from 'xstate';`,
        ``,
        `// ── Context ──────────────────────────────────────────────────────────────────`,
        `export type ${name}Context = {`,
        ctxFields,
        `};`,
        ``,
        `// ── Events ───────────────────────────────────────────────────────────────────`,
        `export type ${name}Event =`,
        eventUnion,
        `  ;`,
        ``,
        `// ── Machine ──────────────────────────────────────────────────────────────────`,
        implNotes ? `// Implementations needed:\n${implNotes}` : '',
        `export const machine = createMachine(${machineConfig});`,
        ``,
    ].filter(l => l !== undefined).join('\n');
}

// ── services.ts generator ─────────────────────────────────────────────────────

export function generateServicesTs(config, servicesSource) {
    const { guards, actors, actions } = collectImplementations(config);
    const id = config.id ?? 'machine';

    const header = [
        `import { createActor, fromPromise } from 'xstate';`,
        `import { machine } from './${id}-machine';`,
        ``,
        `// Derive implementation types directly from the machine`,
        `type Impl = Parameters<typeof machine.provide>[0];`,
        `type GuardArgs   = Parameters<NonNullable<Impl['guards']  >[string]>[0];`,
        `type ActionArgs  = Parameters<NonNullable<Impl['actions'] >[string]>[0];`,
        ``,
    ].join('\n');

    if (servicesSource) {
        // Wrap the existing JS with the TS header — user adds type annotations as needed
        return [
            header,
            `// ── Converted from ${id}-services.js ─────────────────────────────────────────`,
            `// Add ': Impl' annotation to the export and type individual functions as needed.`,
            ``,
            servicesSource.trim(),
            ``,
        ].join('\n');
    }

    // No services loaded — generate typed stubs
    const guardStubs = guards.map(g =>
        `    ${g}(_args: GuardArgs): boolean {\n      return true; // TODO\n    },`
    ).join('\n');

    const actorStubs = actors.map(a =>
        `    ${a}: fromPromise(async () => {\n      throw new Error('${a}: not implemented');\n    }),`
    ).join('\n');

    const actionStubs = actions.map(a =>
        `    ${a}(_args: ActionArgs): void {\n      // TODO\n    },`
    ).join('\n');

    const implBody = [
        guards.length  ? `  guards: {\n${guardStubs}\n  },`  : '',
        actors.length  ? `  actors: {\n${actorStubs}\n  },`  : '',
        actions.length ? `  actions: {\n${actionStubs}\n  },` : '',
    ].filter(Boolean).join('\n');

    return [
        header,
        `export const implementations: Impl = {`,
        implBody,
        `};`,
        ``,
        `// Wire up:`,
        `// const actor = createActor(machine.provide(implementations));`,
        `// actor.start();`,
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
 * exportToTypeScript(config, servicesSource?, { nometa? })
 *
 * Downloads {id}-xstate.zip containing:
 *   {id}-machine.ts, {id}-services.ts, package.json, tsconfig.json
 *
 * Call via window.exportToTypeScript() in the browser console.
 */
export async function exportToTypeScript(config, servicesSource = null, { nometa = false } = {}) {
    if (!config?.states) {
        console.warn('⚠️  exportToTypeScript: no machine config loaded');
        return null;
    }

    const id         = config.id ?? 'machine';
    const machineTs  = generateMachineTs(config, { nometa });
    const servicesTs = generateServicesTs(config, servicesSource);
    const pkgJson    = generatePackageJson(id);
    const tsConfig   = generateTsConfig();

    const { default: JSZip } = await import('https://esm.sh/jszip');
    const zip = new JSZip();
    zip.file(`${id}-machine.ts`,  machineTs);
    zip.file(`${id}-services.ts`, servicesTs);
    zip.file('package.json',      pkgJson);
    zip.file('tsconfig.json',     tsConfig);

    const blob = await zip.generateAsync({ type: 'blob' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `${id}-xstate.zip`;
    a.click();
    URL.revokeObjectURL(a.href);

    console.group(`📤 TypeScript export: ${id}`);
    console.log(`✅ ${id}-xstate.zip`);
    console.log(`     ${id}-machine.ts   — createMachine() config + context/event types`);
    console.log(`     ${id}-services.ts  — ${servicesSource ? 'wrapped existing services' : 'typed implementation stubs'}`);
    console.log(`     package.json       — xstate ^5 + typescript ^5`);
    console.log(`     tsconfig.json      — ES2020 / moduleResolution bundler`);
    console.log(`\nNext steps:`);
    console.log(`  1. Unzip and run: npm install`);
    console.log(`  2. Open the folder in VS Code with the Stately extension`);
    console.log(`  3. The extension will visualize ${id}-machine.ts automatically`);
    console.groupEnd();

    return { machineTs, servicesTs, pkgJson, tsConfig };
}
