import { ChatEngine } from './ChatEngine.js';
import { realtorServices } from './realtor-services.js';

async function boot() {
    console.log("🎬 Booting Engine...");
    try {
        const response = await fetch('./realtor-machine.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const config = await response.json();
        console.log("📄 Config Loaded:", config.id);

        const uiHooks = {
            addBubble: (text, side) => {
                const m = document.getElementById('messages');
                if (!m) return;
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

            updateProfile: (context, stateId) => {
                const profile = document.getElementById('profile-view');
                const stateDisplay = document.getElementById('state-id');
                if (profile) profile.innerText = JSON.stringify(context, null, 2);
                if (stateDisplay) stateDisplay.innerText = `State: ${stateId}`;
                if (window.renderDiagram) window.renderDiagram(config, stateId);
            },

            renderButtons: (choices) => {
                const area = document.getElementById('input-area');
                if (!area) return;
                area.innerHTML = '';

                const snapshot = window.currentEngine.actor.getSnapshot();
                const stateId = typeof snapshot.value === 'string'
                    ? snapshot.value
                    : Object.keys(snapshot.value)[0];
                const stateConfig = config.states[stateId];

                if (stateConfig?.meta?.input === 'text') {
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.placeholder = 'Type and press Enter...';
                    input.onkeydown = (e) => {
                        if (e.key === 'Enter' && input.value.trim()) {
                            const val = input.value.trim();
                            uiHooks.addBubble(val, 'user');
                            window.currentEngine.send('SUBMIT', val);
                            input.value = '';
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

        window.currentEngine = new ChatEngine(config, realtorServices, uiHooks);
        window.currentEngine.start();

        // Global helpers wired to the engine instance
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
                Object.assign(config, JSON.parse(e.target.result));
                window.currentEngine.restart();
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
                btn.innerText = "✅ Copied!";
                setTimeout(() => btn.innerText = orig, 2000);
            });
        };

    } catch (error) {
        console.error("❌ CRITICAL BOOT ERROR:", error);
    }
}

window.addEventListener('load', boot);
