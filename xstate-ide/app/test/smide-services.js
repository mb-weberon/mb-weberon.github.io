/**
 * smide-services.js
 *
 * Mock services for smide-machine.json — for visualisation and path exploration
 * in the IDE only. Toggle the constants below to explore different boot paths.
 *
 * Boot scenarios:
 *
 *   Fresh start (default):
 *     HAS_FLOW = false  →  booting → no_flow
 *
 *   Boot storage error:
 *     BOOT_FAILS = true  →  booting → load_error
 *
 *   Returning user, flow loaded, no conversation yet:
 *     HAS_FLOW = true, HAS_SESSION = false, HAS_RESULTS = false
 *     →  booting → prompt_restore → RESTORE → restoring_flow → flow_idle
 *
 *   Returning user, mid-conversation:
 *     HAS_FLOW = true, HAS_SESSION = true, HAS_RESULTS = false
 *     →  booting → prompt_restore → RESTORE → restoring_flow → session_active
 *
 *   Returning user, previous test results available:
 *     HAS_FLOW = true, HAS_RESULTS = true
 *     →  booting → prompt_restore → RESTORE → restoring_flow → results_ready
 *
 *   Restore fails mid-way:
 *     HAS_FLOW = true, RESTORE_FAILS = true
 *     →  booting → prompt_restore → RESTORE → restoring_flow → load_error
 *
 * Load errors (LOAD_ERROR event) are sent imperatively by main.js when
 * loadPair() or loadTestResults() fail — not modelled as guards here.
 *
 * Guard wiring:
 *   booting.invoke.onDone        — guards read event.output from checkPersistedState
 *   restoring_flow.invoke.onDone — guards read event.output from restorePersistedState
 */

const HAS_FLOW      = false;
const HAS_RESULTS   = false;
const HAS_SESSION   = false;
const BOOT_FAILS    = false;
const RESTORE_FAILS = false;

export const realtorServices = {

    // ── Async services ────────────────────────────────────────────────────────

    // Simulates the IndexedDB presence check on boot.
    // In production: opens the 'sm-ide' DB and checks whether a 'current' flow record exists.
    // Returns { hasFlow, hasResults, hasSession } — guards in booting.onDone read these.
    // Throws when BOOT_FAILS = true to exercise the booting → load_error path.
    checkPersistedState: async () => {
        if (BOOT_FAILS) throw new Error('Simulated boot storage failure');
        return { hasFlow: HAS_FLOW, hasResults: HAS_RESULTS, hasSession: HAS_SESSION };
    },

    // Simulates the full restore: loads flow JSON + services source from IndexedDB,
    // imports services via blob URL, silent-replays session trace, restores results drawer.
    // In production: returns { hasResults, hasSession } so restoring_flow.onDone can route.
    // Throws when RESTORE_FAILS = true to exercise the restoring_flow → load_error path.
    restorePersistedState: async () => {
        if (RESTORE_FAILS) throw new Error('Simulated restore failure');
        return { hasResults: HAS_RESULTS, hasSession: HAS_SESSION };
    },

    // ── Guards ────────────────────────────────────────────────────────────────

    guards: {
        // booting.invoke.onDone — event.output is from checkPersistedState
        hasPersistedFlow:    ({ event }) => event.output?.hasFlow    === true,

        // restoring_flow.invoke.onDone — event.output is from restorePersistedState
        hasPersistedResults: ({ event }) => event.output?.hasResults === true,
        hasPersistedSession: ({ event }) => event.output?.hasSession === true,
    },
};
