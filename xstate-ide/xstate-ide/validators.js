/**
 * validators.js
 *
 * Pure boolean validators. Each function takes a value and returns true/false.
 * No error strings here — error copy lives in the machine JSON next to the
 * guard that can fail, so flow authors control the message without touching code.
 *
 * Consumed by realtor-services.js (and any future *-services.js) to build
 * XState-native guards.
 */

export const validators = {

    email: (val) =>
        !!val &&
        /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val.trim()),

    // Accepts common US formats: 4155550123, 415-555-0123, (415) 555-0123,
    // +1 415 555 0123, 1-415-555-0123
    phone: (val) =>
        !!val &&
        /^\+?1?[\s\-.]?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}$/.test(val.trim()),

    // Any non-empty string
    text: (val) =>
        !!val && val.trim().length > 0,
};
