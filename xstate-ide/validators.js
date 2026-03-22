/**
 * validators.js
 *
 * Each key matches a `pattern` value in the machine JSON meta block.
 * Returns { valid: boolean, error: string }.
 *
 * Add new patterns here as flows require them — the engine picks them
 * up automatically via the meta.pattern field.
 */

export const validators = {

    email: (val) => {
        if (!val || !val.trim())
            return { valid: false, error: 'Email cannot be empty.' };
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim()))
            return { valid: false, error: 'Please enter a valid email address.' };
        return { valid: true };
    },

    phone: (val) => {
        if (!val || !val.trim())
            return { valid: false, error: 'Phone number cannot be empty.' };
        if (!/^\+?[\d\s\-().]{7,20}$/.test(val.trim()))
            return { valid: false, error: 'Please enter a valid phone number (7–20 digits).' };
        return { valid: true };
    },

    // Fallback: any non-empty string
    text: (val) => {
        if (!val || !val.trim())
            return { valid: false, error: 'This field cannot be empty.' };
        return { valid: true };
    },
};

/**
 * validate(pattern, value)
 * Looks up the named validator; falls back to 'text' if pattern is unknown.
 */
export function validate(pattern, value) {
    const fn = validators[pattern] || validators.text;
    return fn(value);
}
