import { createMachine, createActor, assign, fromPromise } from 'xstate';
import { nullLogger } from './logger.js';

export class ChatEngine {
    constructor(config, services = {}, uiHooks = {}, logger = nullLogger) {
        this.config   = config;
        this.services = services;
        this.ui       = uiHooks;
        this.logger   = logger;
        this.actor    = null;
        this.choices  = [];
        this.lastId   = null;
        this.setupKeyboard();
    }

    // ── Machine setup ─────────────────────────────────────────────────────────

    start() {
        if (this.actor) this.actor.stop();
        this.lastId = null;

        const config = JSON.parse(JSON.stringify(this.config));

        // ── Async services → XState actors ────────────────────────────────────
        const actorsMap = {};
        Object.entries(this.services).forEach(([name, fn]) => {
            if (name === 'guards') return;
            if (typeof fn === 'function') {
                actorsMap[name] = fromPromise(({ input }) => fn(input));
            }
        });

        // ── Guards ────────────────────────────────────────────────────────────
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

        // ── Pre-generate updateContext actions ────────────────────────────────
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
                record: assign({
                    trace: ({ context, event }) => [
                        ...(context.trace || []),
                        event.value || event.type
                    ]
                }),
                ...generatedActions
            }
        });

        this.actor = createActor(machine);
        this.actor.subscribe(snap => this.onUpdate(snap));
        this.actor.start();
    }

    restart() {
        this.ui.clearMessages?.();
        this.start();
    }

    // ── Submit ────────────────────────────────────────────────────────────────

    submit(value) {
        this.logger.log(`📤 submit() called with: "${value}"`);
        this.actor.send({ type: 'SUBMIT', value });
    }

    // ── Replay ────────────────────────────────────────────────────────────────

    async replay(traceString) {
        if (!traceString) return;
        let trace;
        try {
            trace = JSON.parse(traceString);
        } catch {
            this.logger.error('❌ Replay: invalid JSON trace string');
            return;
        }

        this.logger.log('▶ Replay starting, steps:', trace.length);
        this.restart();

        for (const item of trace) {
            await new Promise(r => setTimeout(r, 600));
            const snap    = this.actor.getSnapshot();
            const stateId = typeof snap.value === 'string'
                ? snap.value : Object.keys(snap.value)[0];
            const meta    = this.config.states[stateId]?.meta ?? {};

            if (meta.input === 'text') {
                this.logger.log(`▶ Replay submit [${stateId}]: "${item}"`);
                this.ui.addBubble?.(item, 'user');
                this.submit(item);

                const after   = this.actor.getSnapshot();
                const afterId = typeof after.value === 'string'
                    ? after.value : Object.keys(after.value)[0];

                if (afterId === stateId) {
                    const err = after.context.inputError || 'validation failed';
                    this.logger.error(`❌ Replay aborted at "${stateId}": ${err}`);
                    this.ui.removeLastUserBubble?.();
                    return;
                }
            } else {
                this.logger.log(`▶ Replay event [${stateId}]: "${item}"`);
                this.ui.addBubble?.(item, 'user');
                this.actor.send({ type: item });
            }
        }

        this.logger.log('▶ Replay complete');
    }

    // ── State update ──────────────────────────────────────────────────────────

    onUpdate(snapshot) {
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

            if (state.meta?.text) {
                const msg = state.meta.text.replace(
                    /{{(\w+)}}/g,
                    (_, k) => snapshot.context[k] ?? '...'
                );
                this.ui.addBubble?.(msg, 'bot');
            }
        }

        this.lastId = stateId;

        if (snapshot.context.inputError) {
            this.logger.warn(`⚠️  Input error [${stateId}]: ${snapshot.context.inputError}`);
            this.ui.showError?.(snapshot.context.inputError);
        }

        this.choices = state.on
            ? Object.keys(state.on).filter(k => !['SUBMIT', 'SERVICE_RESPONSE'].includes(k))
            : [];

        this.ui.updateProfile?.(snapshot.context, stateId);
        this.ui.renderButtons?.(this.choices, stateChanged);
    }

    // ── Keyboard shortcuts ────────────────────────────────────────────────────

    setupKeyboard() {
        window.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
            const n = parseInt(e.key);
            if (n > 0 && n <= this.choices.length) {
                const ev = this.choices[n - 1];
                this.ui.addBubble?.(ev, 'user');
                this.actor.send({ type: ev });
            }
        });
    }

    send(type, value) {
        this.actor.send({ type, value });
    }
}
