/**
 * generate-traces.js
 *
 * Enumerates every possible path through a machine config and logs
 * the resulting trace arrays to the console, ready to copy-paste
 * into the replay input.
 *
 * Usage (browser console):
 *   import('./generate-traces.js').then(m => m.generateTraces(config))
 *
 * Or wire it to a button in the IDE toolbar:
 *   window.generateTraces(config)
 *
 * The config passed in should be the same object main.js loaded from
 * realtor-machine.json — already available as window._config if you
 * expose it there, or just pass it directly.
 *
 * For text-input states (meta.input === 'text') the path walker needs
 * a sample value to continue. These are defined in SAMPLE_INPUTS below.
 * Add an entry for each state id that has a text input.
 */

const SAMPLE_INPUTS = {
    ask_email: 'test@example.com',
    ask_phone: '4155550123',
};

/**
 * Walk every path from the initial state to a final state (or dead end).
 * Returns an array of trace arrays — one per complete path.
 *
 * @param {object} config  — raw machine JSON (realtor-machine.json)
 * @returns {string[][]}
 */
export function getAllTraces(config) {
    const paths = [];

    // Recursively walk the graph.
    // stateId   — current state
    // trace     — events accumulated so far on this path
    // visited   — set of stateIds on the current path (cycle guard)
    function walk(stateId, trace, visited) {
        const state = config.states[stateId];
        if (!state) return;

        // Final state — record the path
        if (state.type === 'final') {
            paths.push([...trace]);
            return;
        }

        // Cycle guard
        if (visited.has(stateId)) {
            console.warn(`⚠️  Cycle detected at "${stateId}", stopping this branch.`);
            paths.push([...trace, `[CYCLE:${stateId}]`]);
            return;
        }

        const nextVisited = new Set(visited).add(stateId);

        // ── always transitions (guard-based routing states) ──────────────────
        // These have no user events — just follow all possible targets.
        if (state.always) {
            const branches = Array.isArray(state.always) ? state.always : [state.always];
            branches.forEach(branch => {
                const target = branch.target ?? branch;
                if (target) walk(target, trace, nextVisited);
            });
            return;
        }

        // ── invoke states ─────────────────────────────────────────────────────
        // Service call — follow onDone (happy path)
        if (state.invoke && !state.on) {
            const target = state.invoke.onDone?.target;
            if (target) walk(target, trace, nextVisited);
            return;
        }

        // ── on transitions ────────────────────────────────────────────────────
        if (state.on) {
            const events = Object.entries(state.on);

            events.forEach(([eventType, transition]) => {
                // Array transitions (guarded) — take the first branch that has a target
                const branches = Array.isArray(transition) ? transition : [transition];
                const branch   = branches.find(b => b?.target);
                if (!branch?.target) return;

                if (eventType === 'SUBMIT') {
                    // Text input state — use the sample value as the trace entry
                    const sample = SAMPLE_INPUTS[stateId] ?? 'sample-input';
                    walk(branch.target, [...trace, sample], nextVisited);
                } else {
                    // Choice event — use the event type as the trace entry
                    walk(branch.target, [...trace, eventType], nextVisited);
                }
            });
        }
    }

    walk(config.initial, [], new Set());
    return paths;
}

/**
 * Generate all traces and log them to the console.
 * Call this from the browser console or wire to a button.
 *
 * @param {object} config  — raw machine JSON
 */
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
