/**
 * ChatUI.js
 *
 * Owns all chat DOM rendering. Zero IDE knowledge, zero XState imports.
 * Backed by Preact for declarative rendering.
 *
 * Usage:
 *   const chatUI = new ChatUI(runtime, document.getElementById('chat-mount'));
 *   chatUI.mount();
 *
 * Public API:
 *   mount()   — attach to the DOM, subscribe to runtime, start listening
 *   clear()   — wipe messages + input area (call before runtime.restart())
 */

// Import html from 'htm/preact' (already loaded by ToolbarUI — no extra CDN fetch)
// but import render from the shared 'preact' importmap entry, which is the same
// module instance as 'preact/hooks'. This keeps currentComponent in sync:
// render sets it, useState/useRef/useEffect read it from the same module.
import { html } from 'htm/preact';
import { render } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';

// ── Components ────────────────────────────────────────────────────────────────

function Messages({ messages }) {
    const ref = useRef(null);
    useEffect(() => {
        if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    }, [messages.length]);
    return html`<div id="messages" ref=${ref}>
        ${messages.map((m, i) => html`<div key=${i} class=${'msg ' + m.side}>${m.text}</div>`)}
    </div>`;
}

function InputArea({ input, placeholder, choices, error, onSubmit, onChoice }) {
    const [value, setValue]       = useState('');
    const [localErr, setLocalErr] = useState(null);
    const inputRef                = useRef(null);

    // Sync incoming error into local display state
    useEffect(() => { setLocalErr(error || null); }, [error]);

    // Focus text input whenever it appears
    useEffect(() => {
        if (input === 'text') setTimeout(() => inputRef.current?.focus(), 50);
    }, [input]);

    const go = () => {
        const val = value.trim();
        if (!val) return;
        setValue('');
        setLocalErr(null);
        onSubmit(val);
    };

    return html`<div id="input-area">
        ${input === 'text' && html`
            <input ref=${inputRef} type="text"
                class=${localErr ? 'input-error' : ''}
                placeholder=${placeholder || 'Type and press Enter\u2026'}
                value=${value}
                onInput=${e => { setValue(e.target.value); setLocalErr(null); }}
                onKeyDown=${e => { if (e.key === 'Enter') go(); }}
            />
            <button style="flex-shrink:0" onClick=${go}>Send</button>
        `}
        ${localErr && html`<div class="validation-error">${localErr}</div>`}
        ${choices.map((c, i) => html`
            <button key=${c} onClick=${() => onChoice(c)}>(${i + 1}) ${c}</button>
        `)}
    </div>`;
}

function ChatRoot({ messages, input, placeholder, choices, error, runtime, onUserInput }) {
    // display:contents makes this div invisible to the flex layout in chatMount,
    // so #messages and #controls-container remain direct flex children — same as
    // using a Fragment. A concrete root element avoids htm's <> shorthand, which
    // can produce an empty-string type and cause createElementNS errors on remount.
    return html`<div style="display:contents">
        <${Messages} messages=${messages}/>
        <div id="controls-container">
            <${InputArea}
                input=${input}
                placeholder=${placeholder}
                choices=${choices}
                error=${error}
                onSubmit=${val => { onUserInput?.(); runtime.submit(val); }}
                onChoice=${c => { onUserInput?.(); runtime.send(c); }}
            />
        </div>
    </div>`;
}

// ── ChatUI class — same public API as the previous imperative version ─────────

export class ChatUI {
    /**
     * @param {object} runtime  — Runtime instance (submit, send, restart, onSnapshot, onReplayStep)
     * @param {Element} el      — DOM element to render the chat UI into
     */
    constructor(runtime, el, { onUserInput } = {}) {
        this.runtime             = runtime;
        this.el                  = el;
        this._pendingReplayEcho  = false;
        this._state              = { messages: [], input: null, placeholder: '', choices: [], error: null };
        this._onUserInput     = onUserInput ?? null;

        this._onSnapshot   = this._handleSnapshot.bind(this);
        this._onReplayStep = this._handleReplayStep.bind(this);
    }

    // ── Public API ────────────────────────────────────────────────────────────

    mount() {
        this._rerender();
        this.runtime.onSnapshot   = this._onSnapshot;
        this.runtime.onReplayStep = this._onReplayStep;
    }

    /**
     * Switches to a new runtime without tearing down the Preact tree.
     * Resets all message state, re-renders, and re-wires snapshot handlers.
     * Call this instead of unmount()+mount() to avoid Preact hook-state issues.
     */
    reset(newRuntime) {
        this.runtime            = newRuntime;
        this._pendingReplayEcho = false;
        this._state             = { messages: [], input: null, placeholder: '', choices: [], error: null };
        this.mount();   // _rerender() + wire handlers on the new runtime
    }

    /**
     * Clears messages and input area.
     * Call this BEFORE runtime.restart() so the DOM is clean before the first
     * new snapshot fires.
     */
    clear() {
        this._pendingReplayEcho = false;
        this._state = { messages: [], input: null, placeholder: '', choices: [], error: null };
        this._rerender();
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    _rerender() {
        render(html`<${ChatRoot} ...${this._state} runtime=${this.runtime} onUserInput=${this._onUserInput}/>`, this.el);
    }

    _update(patch) {
        Object.assign(this._state, patch);
        this._rerender();
    }

    _handleSnapshot(snap) {
        const { message, input, placeholder, choices, error, userInput } = snap;
        const newMessages = [...this._state.messages];

        // Echo the user's input as a chat bubble — but only if _handleReplayStep
        // hasn't already added it (replay pushes the message directly then sets
        // _pendingReplayEcho so we skip the duplicate here).
        if (message && userInput && !this._pendingReplayEcho) {
            newMessages.push({ text: userInput, side: 'user' });
        }
        this._pendingReplayEcho = false;

        if (message) {
            newMessages.push({ text: message, side: 'bot' });
        }

        if (error) {
            // Self-transition: show error inline, keep existing input controls
            this._update({ messages: newMessages, error });
            return;
        }

        this._update({
            messages:    newMessages,
            input:       input    ?? null,
            placeholder: placeholder ?? '',
            choices:     choices  ?? [],
            error:       null,
        });
    }

    _handleReplayStep(item) {
        this._pendingReplayEcho = true;
        this._update({ messages: [...this._state.messages, { text: item, side: 'user' }] });
    }
}
