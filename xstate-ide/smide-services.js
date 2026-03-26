/**
 * ide-services.js
 *
 * Mock services for ide-machine.json — for visualisation in the IDE only.
 *
 * Guards return fixed values so you can explore different boot paths by
 * toggling the constants below. Actions are no-ops. The single async
 * service resolves immediately.
 *
 * To simulate "returning user with results":
 *   HAS_FLOW    = true
 *   HAS_RESULTS = true
 *   HAS_SESSION = false
 *
 * To simulate "fresh start":
 *   HAS_FLOW    = false
 *   (machine goes straight to no_flow)
 */

// ── Toggle these to explore different boot paths ──────────────────────────────
const HAS_FLOW    = false;
const HAS_RESULTS = false;
const HAS_SESSION = false;

// ─────────────────────────────────────────────────────────────────────────────

export const realtorServices = {

    // ── Async service ─────────────────────────────────────────────────────────
    // Simulates the async restore step (IndexedDB read + silent replay).
    // Resolves instantly so the diagram transitions without delay.
    restorePersistedState: async () => {
        return { ok: true };
    },

    // ── Guards ────────────────────────────────────────────────────────────────
    guards: {
        hasPersistedFlow:    () => HAS_FLOW,
        hasPersistedResults: () => HAS_RESULTS,
        hasPersistedSession: () => HAS_SESSION,
    },
};
