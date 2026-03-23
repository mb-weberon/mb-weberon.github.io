/**
 * generate-traces.js
 *
 * Enumerates every possible path through a machine config and either
 * logs them to the console or runs them one after another in the IDE.
 *
 * Usage (browser console):
 *   generateTraces()        — log all trace arrays, copy-paste individually
 *   runAllTraces()          — replay every path automatically, one after another
 *   runAllTraces(2000)      — same but 2 seconds between paths (default: 1500ms)
 *
 * Both functions are exposed on window by main.js.
 *
 * For text-input states (meta.input === 'text') the walker needs a sample
 * value to continue. Add an entry in SAMPLE_INPUTS for each such state id.
 */

const SAMPLE_INPUTS = {
    ask_email: 'test@example.com',
    ask_phone: '4155550123',
};

/**
 * Walk every path from the initial state to a final state (or dead end).
 * Returns an array of trace arrays — one per complete path.
 *
 * @param {object} config  — raw machine JSON
 * @returns {string[][]}
 */
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

        // always transitions (guard-based routing states)
        if (state.always) {
            const branches = Array.isArray(state.always) ? state.always : [state.always];
            branches.forEach(branch => {
                const target = branch.target ?? branch;
                if (target) walk(target, trace, nextVisited);
            });
            return;
        }

        // invoke states — follow onDone (happy path only)
        if (state.invoke && !state.on) {
            const target = state.invoke.onDone?.target;
            if (target) walk(target, trace, nextVisited);
            return;
        }

        // on transitions
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

/**
 * Generate all traces and log them to the console.
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

/**
 * Replay every path automatically, one after another.
 * Waits for each replay to finish before starting the next,
 * then pauses `pauseMs` so you can inspect the result.
 *
 * @param {object} config       — raw machine JSON
 * @param {function} replayFn   — window._replayTrace
 * @param {number}  replaySteps — number of steps in longest trace × 600ms + buffer
 * @param {number}  pauseMs     — gap between paths (default 1500ms)
 */
export async function runAllTraces(config, replayFn, pauseMs = 1500) {
    const traces = getAllTraces(config);
    const total  = traces.length;

    console.group(`▶▶ Running all ${total} paths`);

    for (let i = 0; i < total; i++) {
        const trace = traces[i];
        // Estimate how long this replay will take: each step is 600ms,
        // plus 50ms startup delay, plus a small buffer.
        const replayDuration = 50 + (trace.length * 600) + 400;

        console.log(`\n▶ Path ${i + 1} / ${total}: ${JSON.stringify(trace)}`);

        replayFn(JSON.stringify(trace));
        await new Promise(r => setTimeout(r, replayDuration + pauseMs));
    }

    console.log(`\n✅ All ${total} paths complete`);
    console.groupEnd();
}
