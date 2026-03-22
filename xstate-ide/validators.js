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
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim()),

    phone: (val) =>
        !!val &&
        /^\+?[\d\s\-().]{7,20}$/.test(val.trim()),

    // Any non-empty string
    text: (val) =>
        !!val && val.trim().length > 0,
};
