/**
 * subscription-services.js
 *
 * Services for subscription-machine.json.
 *
 * Toggle the flags below to explore different paths in the chat UI.
 * The test runner replays all paths with the defaults shown here.
 */

// ── Manual exploration flags ──────────────────────────────────────────────────
// Set these to true/false in the browser console to try different branches.
const TRIAL_JUST_ENDED               = false;
const STATUS_IS_PAST_DUE_MAX_RETRIES = false;
const STRIPE_CHARGE_SUCCEEDS         = true;
const STRIPE_CREATE_SUCCEEDS         = true;

// ─────────────────────────────────────────────────────────────────────────────

export const subscriptionServices = {

    // ── Guards ─────────────────────────────────────────────────────────────────
    // XState 5 passes a single { context, event, ... } args object.
    // Real implementations would inspect the Stripe webhook payload in event.

    guards: {
        trialJustEnded:               ({ context, event }) => TRIAL_JUST_ENDED,
        statusIsPastDueAndMaxRetries: ({ context, event }) => STATUS_IS_PAST_DUE_MAX_RETRIES,
    },

    // ── Async services ─────────────────────────────────────────────────────────
    // Must be at the TOP LEVEL of this object (not nested) so Runtime.start()
    // picks them up and registers them as XState actors.
    // Each receives { input } where input is the current context.

    // Monitors the Stripe retry window while in past_due.
    // Returns a never-resolving promise so the machine stays in past_due
    // until an external event (PAYMENT_RECOVERED or RETRIES_EXHAUSTED) fires.
    // In production this would be a long-running poll or webhook listener.
    watchRetryWindow: ({ input }) => new Promise(() => {}),

    // Charges the saved payment method and resumes the Stripe subscription.
    chargeAndResumeStripe: async ({ input }) => {
        if (!STRIPE_CHARGE_SUCCEEDS) throw new Error('stripe_charge_failed');
        // Real: await stripe.subscriptions.update(id, { pause_collection: '' })
        return { resumed: true };
    },

    // Creates a brand-new Stripe subscription for a reactivating user.
    createNewStripeSubscription: async ({ input }) => {
        if (!STRIPE_CREATE_SUCCEEDS) throw new Error('stripe_create_failed');
        // Real: await stripe.subscriptions.create({ customer, items, payment_method })
        return { stripeSubscriptionId: 'sub_mock_' + Date.now() };
    },
};
