/**
 * logger.js
 *
 * Lightweight logger abstraction.
 *
 * Consumers:
 *   - ChatEngine accepts a logger as its third constructor argument.
 *   - IDE (main.js) always passes consoleLogger — always logs.
 *   - Production boot passes resolveLogger() — silent unless debug flag set.
 *
 * Enabling debug in production:
 *   URL param:        ?debug=true
 *   localStorage:     localStorage.setItem('debug', 'true')
 */

/** Silent logger — all methods are no-ops. Production default. */
export const nullLogger = {
    log:   () => {},
    warn:  () => {},
    error: () => {},
};

/** Console logger — thin wrapper around console.*. */
export const consoleLogger = {
    log:   (...args) => console.log(...args),
    warn:  (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
};

/**
 * Returns true if debug logging should be enabled.
 * Checks ?debug=true URL param or localStorage.debug === 'true'.
 */
export function shouldEnableDebug() {
    try {
        const param = new URLSearchParams(window.location.search).get('debug');
        if (param === 'true') return true;
    } catch (_) { /* non-browser env */ }
    try {
        if (localStorage.getItem('debug') === 'true') return true;
    } catch (_) { /* storage blocked */ }
    return false;
}

/**
 * Returns consoleLogger if debug is enabled, nullLogger otherwise.
 * Use this in production boots.
 */
export function resolveLogger() {
    return shouldEnableDebug() ? consoleLogger : nullLogger;
}
