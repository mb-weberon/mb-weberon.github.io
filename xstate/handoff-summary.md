# HANDOFF: Realtor Bot Implementation Summary

## 1. Core Requirements
The objective was to build a multi-step conversational UI for a Real Estate bot with the following flow:
1. **Email Collection:** Prompt user for email and store it in context.
2. **Status Identification:** Ask if user is 'OWN' (Owner) or 'RENT' (Renter) and update context.
3. **Async Data Fetching:** Automatically trigger a service call upon entering the `fetch_rate` state.
4. **Mock API Integration:** Use `realtor-services.js` (simulated 1.5s delay) to return a random mortgage rate.
5. **Data Injection:** Display a final summary bubble using template strings (e.g., `{{rate}}`) populated by the service response.

## 2. Current File Manifest
- `realtor-machine.json`: The XState 5 state machine configuration.
- `ChatEngine.js`: The class managing the XState Actor, Action implementations, and UI updates.
- `realtor-services.js`: Contains the `getMarketRate` async function.
- `main.js`: Bootstraps the application and defines UI Hooks (addBubble, renderButtons).

## 3. Failed Requirement: The "Fetch" Deadlock
The bot successfully reaches the `fetch_rate` state but "hangs" there. The requirement was for the `entry` action of that state to trigger the API and move to the next state automatically.

### Why it failed:
- **XState 5 Action Resolution:** XState 5 changed how action parameters are passed to the `.provide()` block.
- **Param Nesting:** When actions are listed in an array in JSON:
  `actions: [{ type: "updateContext", params: {...} }, "record"]`
  XState 5 wraps these parameters inside an `action` object that requires specific destructuring (e.g., `action.params` vs `action.action.params`).
- **Silent Action Execution:** The machine is failing to locate the `callService` implementation due to the signature change, resulting in the service never being called, and thus the `SERVICE_RESPONSE` event never being sent to trigger the final transition.

## 4. Technical Specs for the Next Developer
- **XState Version:** 5.x (ESM).
- **Action Signature needed:** `({ context, event, action, self })`.
- **The "Broken" Transition:** `fetch_rate` -> `on: { SERVICE_RESPONSE: "final_summary" }`.
- **Critical Fix Needed:** In `ChatEngine.js`, implement a robust parameter extraction helper to resolve `action.params` regardless of whether they are direct or nested by XState's internal action-wrapping.

## 5. User Journey Status
- [x] Input email (Saves to context)
- [x] Select status (Saves to context)
- [!] Fetch Market Rate (Stuck here: Entry Action not firing/resolving)
- [ ] Display Summary (Final target)
