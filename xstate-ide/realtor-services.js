import { validators } from './validators.js';

/**
 * realtor-services.js
 *
 * Everything flow-specific that lives outside the machine JSON:
 *   - Async service calls  (registered as XState actors via fromPromise)
 *   - Guards               (registered as XState guards in .provide())
 *
 * Error message copy lives in realtor-machine.json next to each guard
 * reference — not here. Guards are pure booleans.
 */

export const realtorServices = {

    // ── Guards ────────────────────────────────────────────────────────────────

    guards: {
        isValidEmail: ({ event })    => validators.email(event.value),
        isValidPhone: ({ event })    => validators.phone(event.value),
        isSoon:       ({ context })  => context.timing === 'soon',
        isLater:      ({ context })  => context.timing === 'later',
        isValidText:  ({ event })    => validators.text(event.value),
    },
};
