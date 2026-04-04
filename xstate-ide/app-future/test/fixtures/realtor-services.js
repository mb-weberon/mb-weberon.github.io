/**
 * realtor-services.js
 *
 * Everything flow-specific that lives outside the machine JSON:
 *   - Actions   (named assign functions; registered via services.actions)
 *   - Guards    (registered as XState guards in .provide())
 *   - Actors    (async service calls; registered via fromPromise in Runtime.js)
 */

// ── Validators ────────────────────────────────────────────────────────────────
// Pure boolean validators inlined so this file is fully self-contained
// (services.js is loaded as a blob URL and cannot use relative imports).
// No imports needed — Runtime.js wraps plain action functions with assign().

const validators = {
    email: (val) =>
        !!val &&
        /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val.trim()),

    // Accepts common US formats: 4155550123, 415-555-0123, (415) 555-0123,
    // +1 415 555 0123, 1-415-555-0123
    phone: (val) =>
        !!val &&
        /^\+?1?[\s\-.]?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}$/.test(val.trim()),
};

export const realtorServices = {

    // ── Actions ───────────────────────────────────────────────────────────────
    // Named assign functions referenced by string in machine.json.
    // Registered via services.actions in Runtime.js.

    actions: {
        setUserEmail:      ({ event }) => ({ user_email: event.value, inputError: null }),
        setEmailError:     ()          => ({ inputError: 'Please provide a valid email address (e.g. name@example.com).' }),
        setStatusRent:     ()          => ({ status: 'rent' }),
        setStatusOwn:      ()          => ({ status: 'own' }),
        setOrderBuyFirst:  ()          => ({ order: 'buy_first' }),
        setOrderSellFirst: ()          => ({ order: 'sell_first' }),
        setTimingSoon:     ()          => ({ timing: 'soon' }),
        setTimingLater:    ()          => ({ timing: 'later' }),
        setPhone:          ({ event }) => ({ phone: event.value, inputError: null }),
        setPhoneError:     ()          => ({ inputError: 'Please enter a valid phone number (7\u201320 digits).' }),
    },

    // ── Async actors ──────────────────────────────────────────────────────────
    // Registered as XState actors via fromPromise() in Runtime.js.
    // Each function receives { input } where input is the current context.

    /**
     * emailTranscript
     * Sends the conversation transcript to the user's email address.
     * Replace the setTimeout with a real POST to your email service.
     */
    emailTranscript: async ({ input }) => {
        console.log(`📧 [MOCK] Emailing transcript to: ${input.user_email}`);

        await new Promise(resolve => setTimeout(resolve, 0));

        // TODO: replace with real implementation, e.g.:
        // await fetch('https://api.yourservice.com/email/transcript', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify({ to: input.user_email })
        // });

        console.log(`📧 [MOCK] Transcript email sent successfully`);
        return { ok: true };
    },

    /**
     * uploadContext
     * Uploads the full lead context to your server.
     * Always runs regardless of the user's transcript preference.
     */
    uploadContext: async ({ input }) => {
        const payload = {
            user_email:  input.user_email,
            phone:       input.phone,
            status:      input.status,
            order:       input.order,
            timing:      input.timing,
            submittedAt: new Date().toISOString(),
        };

        console.log(`🚀 [MOCK] Uploading context to server:`, payload);

        await new Promise(resolve => setTimeout(resolve, 0));

        // TODO: replace with real implementation, e.g.:
        // await fetch('https://api.yourservice.com/leads', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify(payload)
        // });

        console.log(`🚀 [MOCK] Upload complete`);
        return { ok: true };
    },

    // ── Guards ────────────────────────────────────────────────────────────────
    // Pure booleans — no side effects, no error strings.
    // Error copy lives in machine.json next to each guard reference.

    guards: {
        isValidEmail: ({ event })   => validators.email(event.value),
        isValidPhone: ({ event })   => validators.phone(event.value),
        isSoon:       ({ context }) => context.timing === 'soon',
        isLater:      ({ context }) => context.timing === 'later',
    },

    // ── Sample inputs for automated test path generation ─────────────────────
    // Keyed by state id (meta.input === 'text' states).

    SAMPLE_INPUTS: {
        ask_email: 'test@example.com',
        ask_phone: '4155550123',
    },
};
