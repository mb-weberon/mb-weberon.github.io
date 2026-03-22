import { ChatEngine } from './ChatEngine.js';
import { realtorServices } from './realtor-services.js';
import { loadVersion } from './version.js';

// Derive base URL from this file's own location so all fetches work regardless
// of what directory the HTTP server is rooted at (e.g. /xstate-ide/).
const BASE = new URL('.', import.meta.url).href;
const fetchLocal = (file) => fetch(BASE + file);

console.log('📁 Base URL:', BASE);

async function boot() {
    console.log('🎬 Boot started');

    // ── Load version ──────────────────────────────────────────────────────────
    const version = await loadVersion(BASE);
    const el = document.getElementById('version-label');
    if (version && el) {
        el.textContent = version;
        console.log('🏷️  Version:', version);
    }

    // ── Load machine config ───────────────────────────────────────────────────
    let config;
    try {
        console.log('📄 Fetching realtor-machine.json from:', BASE + 'realtor-machine.json');
        const res = await fetchLocal('realtor-machine.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        config = await res.json();
        console.log('✅ Config loaded:', config.id, '| initial state:', config.initial);
        console.log('📊 States:', Object.keys(config.states).join(', '));
    } catch (e) {
        console.error('❌ Failed to load machine config:', e.message);
        return;
    }

    // ── UI Hooks ──────────────────────────────────────────────────────────────
    const uiHooks = {
        addBubble: (text, side) => {
            const m = document.getElementById('messages');
            if (!m) { console.error('❌ #messages not found'); return; }
            const d = document.createElement('div');
            d.className = `msg ${side}`;
            d.innerText = text;
            m.appendChild(d);
            m.scrollTop = m.scrollHeight;
        },

        clearMessages: () => {
            const m = document.getElementById('messages');
            if (m) m.innerHTML = '';
        },

        // Shows a validation error message below the input and highlights it red.
        // Clears automatically when the user starts typing again.
        showError: (message) => {
            const area  = document.getElementById('input-area');
            const input = area?.querySelector('input');
            area?.querySelector('.validation-error')?.remove();
            const err = document.createElement('div');
            err.className = 'validation-error';
            err.textContent = message;
            err.style.cssText = 'width:100%; color:#e53e3e; font-size:12px; margin-top:4px; padding:0 2px;';
            area?.appendChild(err);
            if (input) {
                input.style.borderColor = '#e53e3e';
                input.focus();
                input.addEventListener('input', () => {
                    input.style.borderColor = '';
                    err.remove();
                }, { once: true });
            }
        },

        updateProfile: (context, stateId) => {
            const profile = document.getElementById('profile-view');
            const stateDisplay = document.getElementById('state-id');
            if (profile) profile.innerText = JSON.stringify(context, null, 2);
            if (stateDisplay) stateDisplay.innerText = `State: ${stateId}`;
            if (window.renderDiagram) {
                window.renderDiagram(config, stateId).catch(e =>
                    console.error('❌ Diagram render failed:', e.message)
                );
            } else {
                console.warn('⚠️  window.renderDiagram not ready yet');
            }
        },

        renderButtons: (choices) => {
            const area = document.getElementById('input-area');
            if (!area) { console.error('❌ #input-area not found'); return; }
            area.innerHTML = '';

            const snapshot = window.currentEngine.actor.getSnapshot();
            const stateId = typeof snapshot.value === 'string'
                ? snapshot.value : Object.keys(snapshot.value)[0];
            const stateConfig = config.states[stateId];

            if (stateConfig?.meta?.input === 'text') {
                const input = document.createElement('input');
                input.type = 'text';
                input.placeholder = stateConfig.meta.placeholder || 'Type and press Enter...';
                input.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        const val = input.value.trim();
                        // engine.submit() validates; only add bubble + clear if valid
                        const ok = window.currentEngine.submit(val);
                        if (ok) {
                            uiHooks.addBubble(val, 'user');
                            input.value = '';
                        }
                    }
                };
                area.appendChild(input);
                setTimeout(() => input.focus(), 100);
            }

            choices.forEach((c, i) => {
                const b = document.createElement('button');
                b.innerText = `(${i + 1}) ${c}`;
                b.onclick = () => {
                    uiHooks.addBubble(c, 'user');
                    window.currentEngine.send(c);
                };
                area.appendChild(b);
            });
        }
    };

    // ── Start engine ──────────────────────────────────────────────────────────
    console.log('🚀 Starting ChatEngine...');
    window.currentEngine = new ChatEngine(config, realtorServices, uiHooks);
    window.currentEngine.start();
    console.log('✅ ChatEngine started');

    // ── Global helpers ────────────────────────────────────────────────────────
    window.downloadConfig = () => {
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'machine.json';
        a.click();
    };

    window.loadNewConfig = (file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const newConfig = JSON.parse(e.target.result);
                Object.assign(config, newConfig);
                console.log('📂 New config loaded:', newConfig.id);
                window.currentEngine.restart();
            } catch (err) {
                console.error('❌ Failed to parse loaded JSON:', err.message);
            }
        };
        reader.readAsText(file);
    };

    window.copyTrace = () => {
        const ctx = window.currentEngine.actor.getSnapshot().context;
        const text = JSON.stringify(ctx.trace);
        navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById('copy-btn');
            if (!btn) return;
            const orig = btn.innerText;
            btn.innerText = '✅ Copied!';
            setTimeout(() => btn.innerText = orig, 2000);
        });
    };
}

window.addEventListener('load', () => {
    console.log('🏁 DOM ready');
    boot();
});
