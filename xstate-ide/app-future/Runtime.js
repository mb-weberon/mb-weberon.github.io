import { createMachine, createActor, assign, fromPromise } from 'xstate';
import { nullLogger } from './logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// Reads timing from the Runtime-owned _trace object (not from XState context).
function msSinceLastStep(trace) {
    const steps = trace?.steps;
    if (!steps?.length) {
        const s = trace?.startedAt;
        return s ? Date.now() - new Date(s).getTime() : 0;
    }
    const last = steps[steps.length - 1];
    return last.at ? Date.now() - new Date(last.at).getTime() : 0;
}


export class Runtime {
    constructor(config, services = {}, logger = nullLogger, { headless = false } = {}) {
        this.config       = config;
        this.services     = services;
        this.logger       = logger;
        this.actor        = null;
        this.choices      = [];
        this.lastId       = null;
        this.onSnapshot        = null;   // (snap) => void
        this.onReplayStep      = null;   // (item: string) => void
        this.onReplayDone      = null;   // () => void  — fires when replay() finishes
        this.validationAbortedAt = null; // stateId where a guard rejected the sample input
        this.contextOverrides  = {};    // applied on top of config.context at start()

        // ── Trace (instance-owned, not XState context) ────────────────────────
        this._trace                = null;  // { flowId, flowVersion, sessionId, startedAt, steps[] }
        this._lastEvent            = null;  // last event sent via submit() or send()
        this._pendingServiceEvent  = null;  // captured by inspect — xstate.done/error.actor.*
        this._errorRecordedForEvent = false; // prevents double-recording one validation failure

        if (!headless) this.setupKeyboard();
    }

    // ── Machine setup ─────────────────────────────────────────────────────────

    start() {
        if (this.actor) this.actor.stop();
        this.lastId = null;

        // Reset trace state for this run.
        this._trace = {
            flowId:      this.config.id ?? 'unknown',
            flowVersion: window._appVersion ?? 'unknown',
            sessionId:   uuid(),
            startedAt:   new Date().toISOString(),
            steps:       [],
        };
        this._lastEvent            = null;
        this._pendingServiceEvent  = null;
        this._errorRecordedForEvent = false;

        const config = JSON.parse(JSON.stringify(this.config));

        // Apply any user-supplied initial context overrides.
        if (this.contextOverrides && Object.keys(this.contextOverrides).length > 0) {
            Object.assign(config.context, this.contextOverrides);
        }

        // Ensure every invoke gets the full context as input if no input is defined.
        // XState 5 does not auto-forward context — it must be explicit.
        Object.values(config.states).forEach(state => {
            if (state.invoke && state.invoke.input === undefined) {
                state.invoke.input = ({ context }) => context;
            }
        });

        const actorsMap = {};
        Object.entries(this.services).forEach(([name, fn]) => {
            if (name === 'guards')        return;
            if (name === 'actions')       return;
            if (name === 'SAMPLE_INPUTS') return;
            if (typeof fn === 'function') {
                actorsMap[name] = fromPromise(({ input }) => fn({ input }));
            }
        });

        const rawGuards = this.services.guards ?? {};
        const guardsMap = {};
        Object.entries(rawGuards).forEach(([name, fn]) => {
            guardsMap[name] = (args) => {
                const result = fn(args);
                this.logger.log(`🛡️  Guard "${name}" → ${result} (value: "${args.event?.value}")`);
                return result;
            };
        });
        this.logger.log('🛡️  Registering guards:', Object.keys(guardsMap));

        // Named context-update actions from services.actions.
        // Plain functions (returning a partial context object) are wrapped with
        // assign here so services.js stays self-contained with no XState import.
        // Pre-built XState action objects are passed through as-is.
        const actionsMap = {};
        Object.entries(this.services.actions ?? {}).forEach(([name, fn]) => {
            actionsMap[name] = typeof fn === 'function' ? assign(fn) : fn;
        });
        this.logger.log('⚙️  Registered actions:', Object.keys(actionsMap));

        // Warn if legacy updateContext action objects are still present in the config.
        // These are no longer processed by the Runtime — replace with named assign
        // actions in services.js and reference them by name in machine.json.
        (function scanLegacyUpdateContext(cfg) {
            let found = 0;
            function check(actions) {
                if (!actions) return;
                const list = Array.isArray(actions) ? actions : [actions];
                list.forEach(a => { if (typeof a === 'object' && a?.type === 'updateContext') found++; });
            }
            function checkBranches(branches) {
                if (!branches) return;
                const list = Array.isArray(branches) ? branches : [branches];
                list.forEach(b => check(b?.actions));
            }
            check(cfg.entry);
            Object.values(cfg.states ?? {}).forEach(s => {
                check(s.entry); check(s.exit);
                if (s.on) Object.values(s.on).forEach(t => checkBranches(t));
                checkBranches(s.always);
                if (s.invoke) { checkBranches(s.invoke.onDone); checkBranches(s.invoke.onError); }
            });
            if (found > 0) console.warn(
                `⚠️  ${found} legacy updateContext action object(s) found in machine config. ` +
                `These are no longer supported — replace with named assign actions in services.js.`
            );
        })(config);

        const machine = createMachine(config).provide({
            actors:  actorsMap,
            guards:  guardsMap,
            actions: actionsMap,
        });

        // Capture service completion events via the inspect API so _onUpdate
        // can record them without machine.json needing recordService actions.
        this.actor = createActor(machine, {
            inspect: (ev) => {
                if (ev.type === '@xstate.event') {
                    const t = ev.event?.type ?? '';
                    if (t.startsWith('xstate.done.actor.') || t.startsWith('xstate.error.actor.')) {
                        this._pendingServiceEvent = ev.event;
                    }
                }
            },
        });
        this.actor.subscribe(snap => this._onUpdate(snap));
        this.actor.start();
    }

    restart() {
        this.start();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    submit(value) {
        this.logger.log(`📤 submit() called with: "${value}"`);
        this._lastEvent            = { type: 'SUBMIT', value };
        this._errorRecordedForEvent = false;
        this.actor.send({ type: 'SUBMIT', value });
    }

    send(type) {
        this._lastEvent            = { type };
        this._errorRecordedForEvent = false;
        this.actor.send({ type });
    }

    getTrace() {
        // Return instance-owned trace if available (all runs after v0.12.80).
        if (this._trace) return this._trace;
        // Legacy fallback: old saved results embedded _trace in XState context.
        const ctx = this.actor?.getSnapshot()?.context ?? {};
        if (ctx._trace) return ctx._trace;
        return {
            flowId:      this.config?.id ?? 'unknown',
            flowVersion: 'legacy',
            sessionId:   null,
            startedAt:   null,
            steps:       (ctx.trace ?? []).map(v => ({ value: v })),
        };
    }

    // ── Replay ────────────────────────────────────────────────────────────────

    async replay(traceString, { delayMs = 0 } = {}) {
        if (!traceString) return;
        let trace;
        try {
            trace = JSON.parse(traceString);
        } catch {
            this.logger.error('❌ Replay: invalid JSON trace string');
            return;
        }

        // Support both old flat-array and new envelope formats
        let steps;
        if (Array.isArray(trace)) {
            steps = trace;   // old: ["email@x.com", "RENT", ...]
        } else if (trace?.steps) {
            // new envelope — skip validation failures and service records
            steps = trace.steps
                .filter(s => s.valid !== false && !s.service)
                .map(s => s.value);
        } else {
            this.logger.error('❌ Replay: unrecognised trace format');
            this.onReplayDone?.();
            return;
        }

        this.logger.log('▶ Replay starting, steps:', steps.length);
        // No this.restart() here — the caller (_replayTrace in main.js) is
        // responsible for restarting and clearing the DOM before calling replay().

        for (const item of steps) {
            // Wait for the machine to settle into a stable (non-transient) state
            // before sending the next event. This replaces the fixed 600ms delay
            // and eliminates timing-based flakiness entirely.
            await this._waitForStableState();

            // Optional per-step pause so the UI can animate between steps.
            // Manual replay passes delayMs=350 for a smooth visible progression.
            // Automated test runs use the default (0) to stay as fast as possible.
            if (delayMs > 0) {
                await new Promise(r => setTimeout(r, delayMs));
            }

            const snap    = this.actor.getSnapshot();
            const stateId = typeof snap.value === 'string'
                ? snap.value : Object.keys(snap.value)[0];
            const meta    = this.config.states[stateId]?.meta ?? {};

            if (meta.input === 'text') {
                this.logger.log(`▶ Replay submit [${stateId}]: "${item}"`);
                this.onReplayStep?.(item);
                this.submit(item);

                // Wait for the state to change (or detect a validation failure)
                await this._waitForStateChange(stateId);

                const after   = this.actor.getSnapshot();
                const afterId = typeof after.value === 'string'
                    ? after.value : Object.keys(after.value)[0];

                if (afterId === stateId) {
                    const err = after.context.inputError || 'validation failed';
                    this.logger.error(`❌ Replay aborted at "${stateId}": ${err}`);
                    this.validationAbortedAt = stateId;
                    this.onReplayDone?.();
                    return;
                }
            } else {
                this.logger.log(`▶ Replay event [${stateId}]: "${item}"`);
                this.onReplayStep?.(item);
                this.send(item);   // use this.send() so _lastEvent is captured for trace
            }
        }

        // Wait for any trailing invoke chains or always-transitions to finish
        // (e.g. route_by_timing → closing_soon → send_transcript → upload_context → finish_screen)
        await this._waitForStableState();

        this.logger.log('▶ Replay complete');
        this.onReplayDone?.();
    }

    /**
     * Resolves once the machine is in a stable state — i.e. not a transient
     * state (always-only or invoke-only with no on:{} handlers).
     * Polls at 20ms so invoke async work can complete without busy-waiting.
     */
    _waitForStableState() {
        return new Promise(resolve => {
            const check = () => {
                const snap    = this.actor.getSnapshot();
                // Actor has stopped (final state reached)
                if (snap.status !== 'active') { resolve(); return; }

                const stateId = typeof snap.value === 'string'
                    ? snap.value : Object.keys(snap.value)[0];
                const state   = this.config.states[stateId];
                if (!state) { resolve(); return; }

                const isTransient =
                    !!state.always ||
                    (!!state.invoke && !state.on);

                if (!isTransient) { resolve(); return; }
                setTimeout(check, 20);
            };
            check();
        });
    }

    /**
     * Resolves once the machine has left `fromStateId` (or the actor stops).
     * Used after submitting text input to confirm the guard passed and a real
     * transition occurred, rather than a self-transition on validation error.
     */
    _waitForStateChange(fromStateId) {
        return new Promise(resolve => {
            const check = () => {
                const snap = this.actor.getSnapshot();
                if (snap.status !== 'active') { resolve(); return; }

                const stateId = typeof snap.value === 'string'
                    ? snap.value : Object.keys(snap.value)[0];

                if (stateId !== fromStateId) { resolve(); return; }
                setTimeout(check, 20);
            };
            // Give the event one tick to be processed before polling
            setTimeout(check, 0);
        });
    }

    // ── Internal state update → emit snapshot ────────────────────────────────

    _onUpdate(snapshot) {
        const stateId    = typeof snapshot.value === 'string'
            ? snapshot.value : Object.keys(snapshot.value)[0];
        const state      = this.config.states[stateId];
        if (!state) return;

        const stateChanged = stateId !== this.lastId;

        // ── Trace recording (must happen before this.lastId is updated) ───────
        if (stateChanged && this._trace) {
            if (this._pendingServiceEvent) {
                // Service completion: invoke onDone/onError triggered the transition.
                const e       = this._pendingServiceEvent;
                const typeStr = e.type ?? '';
                const service = typeStr.replace(/^xstate\.(done|error)\.actor\./, '');
                const ok      = typeStr.startsWith('xstate.done');
                this._trace.steps.push({
                    stateId: this.lastId ?? 'unknown',
                    service,
                    ok,
                    result: e.output ?? e.error ?? null,
                    at:     new Date().toISOString(),
                    ms:     msSinceLastStep(this._trace),
                });
                this._pendingServiceEvent = null;
            } else if (this._lastEvent) {
                // User event: submit() or send() caused the transition.
                const value = this._lastEvent.value ?? this._lastEvent.type;
                this._trace.steps.push({
                    stateId: this.lastId ?? 'unknown',
                    value,
                    at:  new Date().toISOString(),
                    ms:  msSinceLastStep(this._trace),
                });
            }
            this._errorRecordedForEvent = false;
        } else if (!stateChanged && snapshot.context.inputError && !this._errorRecordedForEvent && this._trace) {
            // Validation failure: guard rejected input, state unchanged, new error.
            this._trace.steps.push({
                stateId: this.lastId ?? 'unknown',
                valid:   false,
                value:   this._lastEvent?.value ?? this._lastEvent?.type ?? '',
                at:      new Date().toISOString(),
                ms:      msSinceLastStep(this._trace),
            });
            this._errorRecordedForEvent = true;
        }

        // userInput for this transition — passed to onSnapshot so consumers
        // (ChatUI, diagram) don't need to read from context.trace.
        const userInput = (stateChanged && this._lastEvent)
            ? (this._lastEvent.value ?? this._lastEvent.type)
            : null;

        if (stateChanged) {
            const inputMeta = state.meta?.input ? ` [input: ${state.meta.input}]` : '';
            const isFinal   = state.type === 'final' ? ' 🏁' : '';
            this.logger.log(`🔀 State: ${this.lastId ?? '(start)'} → ${stateId}${inputMeta}${isFinal}`);
            this.logger.log(`   Context:`, { ...snapshot.context });
            this._lastEvent = null;
        }

        this.lastId = stateId;

        if (snapshot.context.inputError) {
            this.logger.warn(`⚠️  Input error [${stateId}]: ${snapshot.context.inputError}`);
        }

        this.choices = state.on
            ? Object.keys(state.on).filter(k => !['SUBMIT', 'SERVICE_RESPONSE'].includes(k))
            : [];

        if (this.onSnapshot) {
            const message = (stateChanged && state.meta?.text)
                ? state.meta.text.replace(/{{(\w+)}}/g, (_, k) => snapshot.context[k] ?? '...')
                : null;

            this.onSnapshot({
                stateId,
                message,
                userInput,
                trace:       this._trace,
                input:       state.meta?.input       ?? null,
                placeholder: state.meta?.placeholder ?? null,
                choices:     this.choices,
                context:     snapshot.context,
                error:       snapshot.context.inputError ?? null,
            });
        }
    }

    // ── Keyboard shortcuts ────────────────────────────────────────────────────

    setupKeyboard() {
        window.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
            const n = parseInt(e.key);
            if (n > 0 && n <= this.choices.length) {
                this.actor.send({ type: this.choices[n - 1] });
            }
        });
    }
}
