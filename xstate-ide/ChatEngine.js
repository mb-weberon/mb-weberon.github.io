import { createMachine, createActor, assign, fromPromise } from 'xstate';
import { validate } from './validators.js';

export class ChatEngine {
    constructor(config, services = {}, uiHooks = {}) {
        this.config = config;
        this.services = services;
        this.ui = uiHooks;
        this.actor = null;
        this.choices = [];
        this.lastId = null;
        this.setupKeyboard();
    }

    // ── Machine setup ─────────────────────────────────────────────────────────

    start() {
        if (this.actor) this.actor.stop();
        this.lastId = null;

        const getParams = (action) => action?.params ?? action?.action?.params ?? {};

        const actorsMap = {};
        Object.entries(this.services).forEach(([name, fn]) => {
            actorsMap[name] = fromPromise(({ input }) => fn(input));
        });

        const machine = createMachine(this.config).provide({
            actors: actorsMap,
            actions: {
                record: assign({
                    trace: ({ context, event }) => [
                        ...(context.trace || []),
                        event.value || event.type
                    ]
                }),

                updateContext: assign(({ event, action }) => {
                    const params = getParams(action);
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
                        updates[params.mapValueTo] = source;
                    }
                    return updates;
                })
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

    // ── Validation ────────────────────────────────────────────────────────────

    /**
     * submit(value)
     * Central point for all text submissions — live input AND replay both go
     * through here so validation is never bypassed.
     *
     * Returns true if the value passed validation and was sent, false otherwise.
     */
    submit(value) {
        const snap    = this.actor.getSnapshot();
        const stateId = typeof snap.value === 'string'
            ? snap.value : Object.keys(snap.value)[0];
        const meta    = this.config.states[stateId]?.meta ?? {};
        const pattern = meta.pattern ?? 'text';

        const result = validate(pattern, value);

        if (!result.valid) {
            console.warn(`⚠️  Validation failed [${stateId}] pattern="${pattern}" value="${value}" → ${result.error}`);
            this.ui.showError?.(result.error);
            return false;
        }

        console.log(`✅ Validation passed [${stateId}] pattern="${pattern}" value="${value}"`);
        this.actor.send({ type: 'SUBMIT', value });
        return true;
    }

    // ── Replay ────────────────────────────────────────────────────────────────

    async replay(traceString) {
        if (!traceString) return;
        let trace;
        try {
            trace = JSON.parse(traceString);
        } catch {
            console.error('❌ Replay: invalid JSON trace string');
            return;
        }

        console.log('▶ Replay starting, steps:', trace.length);
        this.restart();

        for (const item of trace) {
            await new Promise(r => setTimeout(r, 600));
            const snap    = this.actor.getSnapshot();
            const stateId = typeof snap.value === 'string'
                ? snap.value : Object.keys(snap.value)[0];
            const meta    = this.config.states[stateId]?.meta ?? {};

            if (meta.input === 'text') {
                console.log(`▶ Replay submit [${stateId}]:`, item);
                this.ui.addBubble(item, 'user');
                // Goes through submit() so validation is enforced in replay too
                const ok = this.submit(item);
                if (!ok) {
                    console.error(`❌ Replay aborted: value "${item}" failed validation at state "${stateId}"`);
                    return;
                }
            } else {
                console.log(`▶ Replay event [${stateId}]:`, item);
                this.ui.addBubble(item, 'user');
                this.actor.send({ type: item });
            }
        }

        console.log('▶ Replay complete');
    }

    // ── State update ──────────────────────────────────────────────────────────

    onUpdate(snapshot) {
        const stateId = typeof snapshot.value === 'string'
            ? snapshot.value : Object.keys(snapshot.value)[0];

        const state = this.config.states[stateId];
        if (!state) return;

        // ── State-change logging ──────────────────────────────────────────────
        if (stateId !== this.lastId) {
            const meta    = state.meta ?? {};
            const pattern = meta.pattern ? ` [validates: ${meta.pattern}]` : '';
            const input   = meta.input   ? ` [input: ${meta.input}]`       : '';
            const isLast  = state.type === 'final' ? ' 🏁' : '';
            console.log(`🔀 State: ${this.lastId ?? '(start)'} → ${stateId}${pattern}${input}${isLast}`);
            console.log(`   Context:`, { ...snapshot.context });
        }

        // Bot speech
        if (state.meta?.text && stateId !== this.lastId) {
            const msg = state.meta.text.replace(
                /{{(\w+)}}/g,
                (_, k) => snapshot.context[k] ?? '...'
            );
            this.ui.addBubble(msg, 'bot');
        }

        this.lastId = stateId;

        this.choices = state.on
            ? Object.keys(state.on).filter(k => !['SUBMIT', 'SERVICE_RESPONSE'].includes(k))
            : [];

        this.ui.updateProfile(snapshot.context, stateId);
        this.ui.renderButtons(this.choices);
    }

    // ── Keyboard shortcuts ────────────────────────────────────────────────────

    setupKeyboard() {
        window.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
            const n = parseInt(e.key);
            if (n > 0 && n <= this.choices.length) {
                const ev = this.choices[n - 1];
                this.ui.addBubble(ev, 'user');
                this.actor.send({ type: ev });
            }
        });
    }

    send(type, value) {
        this.actor.send({ type, value });
    }
}
