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

    // ── Async services ────────────────────────────────────────────────────────
    // Registered as XState actors via fromPromise() in Runtime.js.
    // Each function receives { input } where input is the current context
    // (passed automatically by XState from the invoke definition).

    /**
     * emailTranscript
     * Sends the conversation transcript to the user's email address.
     * Replace the setTimeout with a real POST to your email service
     * (e.g. SendGrid, Postmark, your own API endpoint).
     */
    emailTranscript: async ({ input }) => {
        const { user_email, trace } = input;
        console.log(`📧 [MOCK] Emailing transcript to: ${user_email}`);
        console.log(`📧 [MOCK] Trace payload:`, trace);

        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 800));

        // TODO: replace with real implementation, e.g.:
        // await fetch('https://api.yourservice.com/email/transcript', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify({ to: user_email, trace })
        // });

        console.log(`📧 [MOCK] Transcript email sent successfully`);
        return { ok: true };
    },

    /**
     * uploadContext
     * Uploads the full lead context and trace to your server.
     * Always runs regardless of the user's transcript preference —
     * this is the CRM/analytics write, not the user-facing email.
     * Replace the setTimeout with a real POST to your backend.
     */
    uploadContext: async ({ input }) => {
        const payload = {
            user_email: input.user_email,
            phone:      input.phone,
            status:     input.status,
            order:      input.order,
            timing:     input.timing,
            trace:      input.trace,
            submittedAt: new Date().toISOString()
        };

        console.log(`🚀 [MOCK] Uploading context to server:`, payload);

        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 600));

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
    // Error copy lives in realtor-machine.json next to each guard reference.

    guards: {
        isValidEmail: ({ event })   => validators.email(event.value),
        isValidPhone: ({ event })   => validators.phone(event.value),
        isSoon:       ({ context }) => context.timing === 'soon',
        isLater:      ({ context }) => context.timing === 'later',
        isValidText:  ({ event })   => validators.text(event.value),
    },
};
