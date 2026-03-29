/**
 * subscription-management-v2-services.js
 *
 * Guards for the subscription_management_v2 XState5 machine.
 *
 * Each guard mirrors the business-rule validation performed in handlers.py
 * and fsm.py before the Python FSM transition is allowed to proceed.
 *
 * How guards are evaluated in the IDE:
 *   - The machine sends a SUBMIT event carrying { value: <text the user typed> }
 *   - The guard function receives { context, event } where:
 *       context  = current XState context (subscription_id, current_plan_tier, etc.)
 *       event    = { type: 'SUBMIT', value: '<user input>' }
 *   - Return true  → first SUBMIT branch fires (transition proceeds)
 *   - Return false → fallback branch fires (inputError is set, state unchanged)
 *
 * Guard  ↔  Python equivalent
 * ─────────────────────────────────────────────────────────────────────────────
 * noActiveExtensionExists  ↔  _validate_extend_quota_prerequisites() in handlers.py
 * isNotHighestPlan         ↔  _validate_and_prepare_plan_change() upgrade check
 * isLowerPricedPlan        ↔  _validate_and_prepare_plan_change() downgrade check
 */

export const subscriptionManagementV2Services = {

  guards: {

    /**
     * noActiveExtensionExists
     *
     * Python: _validate_extend_quota_prerequisites() checks that no QuotaExtension
     * with status = 'Active' exists for this subscription_id before allowing a new one.
     *
     * Simulation rule:
     *   The user types 'extend' to simulate a clean check (no active extension exists).
     *   Any other input simulates the rejection case (active extension already present).
     *
     * In production: replaced by a DynamoDB query that checks for existing active
     * extensions — get_quota_extensions_by_subscription(subscription_id) filtered
     * to status == QuotaExtensionStatus.ACTIVE.
     */
    noActiveExtensionExists: ({ context, event }) => {
      const input = (event.value ?? '').trim().toLowerCase();

      // Simulate: type 'extend' to pass the guard
      if (input === 'extend') return true;

      // Simulate: any other value → guard fails (active extension already exists)
      return false;
    },

    /**
     * isNotHighestPlan
     *
     * Python: _validate_and_prepare_plan_change() for upgrades checks that the
     * selected plan's price is strictly greater than the current plan's price.
     * The UI hides the Upgrade action entirely for Draft/Suspended/Cancelled.
     *
     * Plans in order of price (ascending): Starter → Grow → Pro
     *
     * Simulation rule:
     *   The user types the target plan name they want to upgrade to.
     *   Guard passes if:
     *     - current_plan_tier is 'Starter' and input is 'Grow' or 'Pro'
     *     - current_plan_tier is 'Grow'    and input is 'Pro'
     *   Guard fails if:
     *     - current_plan_tier is 'Pro' (already highest — no upgrade possible)
     *     - input plan is same tier or lower than current
     *     - input is not a recognised plan name
     *
     * In production: replaced by a price comparison between get_subscription_plan_info()
     * for both the current plan_id and the incoming plan_id.
     */
    isNotHighestPlan: ({ context, event }) => {
      const PLAN_TIERS = { starter: 1, grow: 2, pro: 3 };

      const currentTier = PLAN_TIERS[(context.current_plan_tier ?? '').toLowerCase()] ?? 0;
      const targetInput = (event.value ?? '').trim().toLowerCase();
      const targetTier  = PLAN_TIERS[targetInput] ?? 0;

      // Target plan must exist and must be strictly higher than current
      if (targetTier === 0) return false;  // unrecognised plan name
      return targetTier > currentTier;
    },

    /**
     * isLowerPricedPlan
     *
     * Python: _validate_and_prepare_plan_change() for downgrades checks that the
     * selected plan's price is strictly less than the current plan's price.
     * Downgrade is only available when status = 'Awaiting Renewal'.
     *
     * Plans in order of price (ascending): Starter → Grow → Pro
     *
     * Simulation rule:
     *   The user types the target plan name they want to downgrade to.
     *   Guard passes if:
     *     - current_plan_tier is 'Pro'  and input is 'Grow' or 'Starter'
     *     - current_plan_tier is 'Grow' and input is 'Starter'
     *   Guard fails if:
     *     - current_plan_tier is 'Starter' (already lowest — no downgrade possible)
     *     - input plan is same tier or higher than current
     *     - input is not a recognised plan name
     *
     * In production: replaced by a price comparison between get_subscription_plan_info()
     * for both the current plan_id and the incoming plan_id.
     */
    isLowerPricedPlan: ({ context, event }) => {
      const PLAN_TIERS = { starter: 1, grow: 2, pro: 3 };

      const currentTier = PLAN_TIERS[(context.current_plan_tier ?? '').toLowerCase()] ?? 0;
      const targetInput = (event.value ?? '').trim().toLowerCase();
      const targetTier  = PLAN_TIERS[targetInput] ?? 0;

      // Target plan must exist and must be strictly lower than current
      if (targetTier === 0) return false;  // unrecognised plan name
      return targetTier < currentTier;
    },

  },

};
