import { createMachine, createActor, assign, fromPromise } from 'xstate';
import { nullLogger } from './logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function msSinceLastStep(context) {
    const steps = context?._trace?.steps;
    if (!steps?.length) {
        const s = context?._trace?.startedAt;
        return s ? Date.now() - new Date(s).getTime() : 0;
    }
    const last = steps[steps.length - 1];
    return last.at ? Date.now() - new Date(last.at).getTime() : 0;
}


export class Runtime {
    constructor(config, services = {}, logger = nullLogger) {
        this.config       = config;
        this.services     = services;
        this.logger       = logger;
        this.actor        = null;
        this.choices      = [];
        this.lastId       = null;
        this.onSnapshot   = null;   // (snap) => void
        this.onReplayStep = null;   // (item: string) => void
        this.onReplayDone = null;   // () => void  — fires when replay() finishes
        this.setupKeyboard();
    }

    // ── Machine setup ─────────────────────────────────────────────────────────

    start() {
        if (this.actor) this.actor.stop();
        this.lastId = null;

        const config = JSON.parse(JSON.stringify(this.config));

        // Ensure every invoke gets the full context as input if no input is defined.
        // XState 5 does not auto-forward context — it must be explicit.
        Object.values(config.states).forEach(state => {
            if (state.invoke && state.invoke.input === undefined) {
                state.invoke.input = ({ context }) => context;
            }
        });

        const actorsMap = {};
        Object.entries(this.services).forEach(([name, fn]) => {
            if (name === 'guards') return;
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

        const generatedActions = {};

        const processActions = (actions) => {
            if (!actions) return;
            const list = Array.isArray(actions) ? actions : [actions];
            list.forEach((action) => {
                if (typeof action === 'object' && action.type === 'updateContext') {
                    const params = action.params ?? {};
                    const uid = `updateContext_${Math.random().toString(36).slice(2)}`;
                    action.type = uid;

                    generatedActions[uid] = assign(({ event }) => {
                        const updates = {};
                        Object.entries(params).forEach(([k, v]) => {
                            if (k === 'mapValueTo') return;
                            if (k === 'fromEvent')  return;
                            updates[k] = v;
                        });
                        if (params.mapValueTo) {
                            const source = params.fromEvent === 'output'
                                ? event.output
                                : event.value;
                            this.logger.log(`📥 "${params.mapValueTo}" ← ${JSON.stringify(source)} (fromEvent: ${params.fromEvent ?? 'value'})`);
                            updates[params.mapValueTo] = source;
                        }
                        return updates;
                    });
                }
            });
        };

        Object.values(config.states).forEach(state => {
            if (state.on) {
                Object.values(state.on).forEach(transition => {
                    const list = Array.isArray(transition) ? transition : [transition];
                    list.forEach(t => processActions(t?.actions));
                });
            }
            if (state.invoke) {
                processActions(state.invoke.onDone?.actions);
                processActions(state.invoke.onError?.actions);
            }
            processActions(state.entry);
        });

        this.logger.log('⚙️  Generated actions:', Object.keys(generatedActions));

        const machine = createMachine(config).provide({
            actors:  actorsMap,
            guards:  guardsMap,
            actions: {
                initTrace: assign(({ context }) => ({
                    _trace: {
                        flowId:      config.id ?? 'unknown',
                        flowVersion: window._appVersion ?? 'unknown',
                        sessionId:   uuid(),
                        startedAt:   new Date().toISOString(),
                        steps:       [],
                    }
                })),
                record: assign(({ context, event }) => {
                    const value = event.value ?? event.type;
                    const at    = new Date().toISOString();
                    const ms    = msSinceLastStep(context);
                    const step  = { stateId: this.lastId ?? 'unknown', value, at, ms };
                    const prev  = context._trace ?? {};
                    return {
                        _trace: { ...prev, steps: [...(prev.steps ?? []), step] },
                        trace:  [...(context.trace ?? []), value],
                    };
                }),
                recordValidationFailure: assign(({ context, event }) => {
                    const step = {
                        stateId: this.lastId ?? 'unknown',
                        valid:   false,
                        value:   event.value ?? event.type,
                        at:      new Date().toISOString(),
                        ms:      msSinceLastStep(context),
                    };
                    const prev = context._trace ?? {};
                    return { _trace: { ...prev, steps: [...(prev.steps ?? []), step] } };
                }),
                recordService: assign(({ context, event }) => {
                    const typeStr = event.type ?? '';
                    const service = typeStr.replace(/^xstate\.(done|error)\.actor\./, '');
                    const ok      = typeStr.startsWith('xstate.done');
                    const step    = {
                        stateId: this.lastId ?? 'unknown',
                        service,
                        ok,
                        result: event.output ?? event.error ?? null,
                        at:     new Date().toISOString(),
                        ms:     msSinceLastStep(context),
                    };
                    const prev = context._trace ?? {};
                    return { _trace: { ...prev, steps: [...(prev.steps ?? []), step] } };
                }),
                ...generatedActions
            }
        });

        this.actor = createActor(machine);
        this.actor.subscribe(snap => this._onUpdate(snap));
        this.actor.start();
    }

    restart() {
        this.start();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    submit(value) {
        this.logger.log(`📤 submit() called with: "${value}"`);
        this.actor.send({ type: 'SUBMIT', value });
    }

    send(type) {
        this.actor.send({ type });
    }

    getTrace() {
        const ctx = this.actor?.getSnapshot()?.context ?? {};
        if (ctx._trace) return ctx._trace;
        // legacy fallback — old flat array format
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
                    this.onReplayDone?.();
                    return;
                }
            } else {
                this.logger.log(`▶ Replay event [${stateId}]: "${item}"`);
                this.onReplayStep?.(item);
                this.actor.send({ type: item });
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

        if (stateChanged) {
            const inputMeta = state.meta?.input ? ` [input: ${state.meta.input}]` : '';
            const isFinal   = state.type === 'final' ? ' 🏁' : '';
            this.logger.log(`🔀 State: ${this.lastId ?? '(start)'} → ${stateId}${inputMeta}${isFinal}`);
            this.logger.log(`   Context:`, { ...snapshot.context });
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
