/**
 * ChatUI.js
 *
 * Owns all chat DOM rendering. Zero IDE knowledge, zero XState imports.
 *
 * Usage:
 *   const chatUI = new ChatUI(runtime, document.getElementById('chat-mount'));
 *   chatUI.mount();
 *
 * Public API:
 *   mount()   — attach to the DOM, subscribe to runtime, start listening
 *   clear()   — wipe messages + input area (call before runtime.restart())
 */

export class ChatUI {
    /**
     * @param {object} runtime  — Runtime instance (submit, send, restart, onSnapshot, onReplayStep)
     * @param {Element} el      — DOM element to render the chat UI into
     */
    constructor(runtime, el) {
        this.runtime          = runtime;
        this.el               = el;
        this._lastTraceLength = 0;

        // Bound handlers — stored so they can be re-assigned on the runtime
        this._onSnapshot   = this._handleSnapshot.bind(this);
        this._onReplayStep = this._handleReplayStep.bind(this);
    }

    // ── Public API ────────────────────────────────────────────────────────────

    mount() {
        this._buildDOM();
        this.runtime.onSnapshot   = this._onSnapshot;
        this.runtime.onReplayStep = this._onReplayStep;
    }

    /**
     * Clears messages and input area.
     * Call this BEFORE runtime.restart() so the DOM is clean before the first
     * new snapshot fires.
     */
    clear() {
        if (this._messagesEl) this._messagesEl.innerHTML = '';
        if (this._inputAreaEl) this._inputAreaEl.innerHTML = '';
        this._lastTraceLength = 0;
    }

    // ── DOM construction ──────────────────────────────────────────────────────

    _buildDOM() {
        // Messages scroll area
        this._messagesEl = this.el.querySelector('#messages');
        if (!this._messagesEl) {
            this._messagesEl = document.createElement('div');
            this._messagesEl.id = 'messages';
            this.el.appendChild(this._messagesEl);
        }

        // Controls container + input area
        this._controlsEl = this.el.querySelector('#controls-container');
        if (!this._controlsEl) {
            this._controlsEl = document.createElement('div');
            this._controlsEl.id = 'controls-container';
            this.el.appendChild(this._controlsEl);
        }

        this._inputAreaEl = this._controlsEl.querySelector('#input-area');
        if (!this._inputAreaEl) {
            this._inputAreaEl = document.createElement('div');
            this._inputAreaEl.id = 'input-area';
            this._controlsEl.appendChild(this._inputAreaEl);
        }
    }

    // ── Runtime callbacks ─────────────────────────────────────────────────────

    _handleSnapshot(snap) {
        const { message, input, placeholder, choices, error, context } = snap;

        // User bubble: only if trace advanced (not a self-transition / replay double)
        if (message && (context.trace?.length ?? 0) > this._lastTraceLength) {
            const lastTrace = context.trace[context.trace.length - 1];
            this._addBubble(lastTrace, 'user');
            this._lastTraceLength = context.trace.length;
        }

        if (message) {
            this._addBubble(message, 'bot');
        }

        if (error) {
            this._showError(error);
            return;   // self-transition: keep existing input controls
        }

        this._renderInputArea(input, placeholder, choices);
    }

    _handleReplayStep(item) {
        this._addBubble(item, 'user');
        this._lastTraceLength++;
    }

    // ── Rendering helpers ─────────────────────────────────────────────────────

    _renderInputArea(input, placeholder, choices) {
        this._inputAreaEl.innerHTML = '';

        if (input === 'text') {
            const inputEl       = document.createElement('input');
            inputEl.type        = 'text';
            inputEl.placeholder = placeholder || 'Type and press Enter…';

            const sendBtn     = document.createElement('button');
            sendBtn.innerText = 'Send';
            sendBtn.style.cssText = 'flex-shrink:0;';

            const go = () => {
                const val = inputEl.value.trim();
                if (!val) return;
                inputEl.value = '';
                this.runtime.submit(val);
            };

            inputEl.onkeydown = (e) => { if (e.key === 'Enter') go(); };
            sendBtn.onclick   = go;

            this._inputAreaEl.appendChild(inputEl);
            this._inputAreaEl.appendChild(sendBtn);
            setTimeout(() => inputEl.focus(), 100);
        }

        choices.forEach((c, i) => {
            const b     = document.createElement('button');
            b.innerText = `(${i + 1}) ${c}`;
            b.onclick   = () => this.runtime.send(c);
            this._inputAreaEl.appendChild(b);
        });
    }

    _addBubble(text, side) {
        const d = document.createElement('div');
        d.className = `msg ${side}`;
        d.innerText = text;
        this._messagesEl.appendChild(d);
        this._messagesEl.scrollTop = this._messagesEl.scrollHeight;
    }

    _showError(message) {
        const input = this._inputAreaEl.querySelector('input');
        this._inputAreaEl.querySelector('.validation-error')?.remove();

        const err       = document.createElement('div');
        err.className   = 'validation-error';
        err.textContent = message;

        this._inputAreaEl.appendChild(err);

        if (input) {
            input.classList.add('input-error');
            input.focus();
            input.addEventListener('input', () => {
                input.classList.remove('input-error');
                err.remove();
            }, { once: true });
        }
    }
}
