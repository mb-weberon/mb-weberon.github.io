import { ChatEngine } from './ChatEngine.js';
import { realtorServices } from './realtor-services.js';
import { loadVersion } from './version.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

const BASE = new URL('.', import.meta.url).href;
const fetchLocal = (file) => fetch(BASE + file);

console.log('📁 Base URL:', BASE);

async function boot() {
    console.log('🎬 Boot started');
    console.log('📦 App:', document.title, '| Built:', new Date().toISOString().slice(0,10));

    // ── Version ───────────────────────────────────────────────────────────────
    const version   = await loadVersion(BASE);
    const versionEl = document.getElementById('version-label');
    if (version && versionEl) {
        versionEl.textContent = version;
        console.log('🏷️  Version:', version, '| URL:', window.location.href);
    }

    // ── Config ────────────────────────────────────────────────────────────────
    let config;
    try {
        console.log('📄 Fetching realtor-machine.json from:', BASE + 'realtor-machine.json');
        const res = await fetchLocal('realtor-machine.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        config = await res.json();
        console.log('✅ Config loaded:', config.id, '| initial:', config.initial);
        console.log('📊 States:', Object.keys(config.states).join(', '));
    } catch (e) {
        console.error('❌ Failed to load machine config:', e.message);
        return;
    }

    // Cache services source so Save Flow ZIP can bundle it
    try {
        const res = await fetchLocal('realtor-services.js');
        if (res.ok) window._loadedServicesSource = await res.text();
    } catch (_) { /* non-fatal */ }

    // ── Visited edge tracking ─────────────────────────────────────────────────
    const visitedEdges = new Set();
    let   _lastStateId = null;
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
            visitedEdges.clear();
            _lastStateId = null;
        },

        removeLastUserBubble: () => {
            const msgs = document.getElementById('messages');
            if (msgs?.lastChild?.classList.contains('user')) {
                msgs.removeChild(msgs.lastChild);
            }
        },

        // Called by ChatEngine.onUpdate whenever context.inputError is non-null.
        // Fires on self-transitions (failed guard) without rebuilding the input.
        showError: (message) => {
            const area  = document.getElementById('input-area');
            const input = area?.querySelector('input');
            area?.querySelector('.validation-error')?.remove();
            const err         = document.createElement('div');
            err.className     = 'validation-error';
            err.textContent   = message;
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
            const profile      = document.getElementById('profile-view');
            const stateDisplay = document.getElementById('state-id');
            if (profile)      profile.innerText      = JSON.stringify(context, null, 2);
            if (stateDisplay) stateDisplay.innerText = `State: ${stateId}`;

            // Record the specific edge traversed: fromState|eventType
            // The last trace entry is the event/value that caused this transition.
            if (_lastStateId && _lastStateId !== stateId && context.trace?.length) {
                const lastEvent = context.trace[context.trace.length - 1];
                visitedEdges.add(`${_lastStateId}|${lastEvent}`);
            }
            _lastStateId = stateId;

            if (window.renderDiagram) {
                window.renderDiagram(config, stateId, visitedEdges).catch(e =>
                    console.error('❌ Diagram render failed:', e.message)
                );
            } else {
                console.warn('⚠️  window.renderDiagram not ready yet');
            }
        },

        // stateChanged=false on self-transitions (failed guard) — preserve the
        // existing input field rather than rebuilding it.
        renderButtons: (choices, stateChanged = true) => {
            const area = document.getElementById('input-area');
            if (!area) { console.error('❌ #input-area not found'); return; }

            if (!stateChanged) {
                // showError has already updated the UI — nothing else to do.
                return;
            }

            area.innerHTML = '';

            const snapshot    = window.currentEngine.actor.getSnapshot();
            const stateId     = typeof snapshot.value === 'string'
                ? snapshot.value : Object.keys(snapshot.value)[0];
            const stateConfig = config.states[stateId];

            if (stateConfig?.meta?.input === 'text') {
                const input       = document.createElement('input');
                input.type        = 'text';
                input.placeholder = stateConfig.meta.placeholder || 'Type and press Enter...';

                const sendBtn       = document.createElement('button');
                sendBtn.innerText   = 'Send';
                sendBtn.style.cssText = 'flex-shrink:0;';

                const go = () => {
                    const val      = input.value.trim();
                    const beforeId = (() => {
                        const s = window.currentEngine.actor.getSnapshot();
                        return typeof s.value === 'string' ? s.value : Object.keys(s.value)[0];
                    })();

                    // Add user bubble BEFORE submit() so it always appears
                    // above the bot response. onUpdate fires synchronously
                    // inside submit(), so without this the order is reversed.
                    uiHooks.addBubble(val, 'user');
                    window.currentEngine.submit(val);

                    const afterSnap = window.currentEngine.actor.getSnapshot();
                    const afterId   = typeof afterSnap.value === 'string'
                        ? afterSnap.value : Object.keys(afterSnap.value)[0];

                    if (afterId !== beforeId) {
                        // State advanced — clear the input
                        input.value = '';
                    } else {
                        // Guard failed — remove the speculative bubble.
                        // showError has already been called by onUpdate.
                        const msgs = document.getElementById('messages');
                        if (msgs?.lastChild?.classList.contains('user')) {
                            msgs.removeChild(msgs.lastChild);
                        }
                    }
                };

                input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
                sendBtn.onclick = go;

                area.appendChild(input);
                area.appendChild(sendBtn);
                setTimeout(() => input.focus(), 100);
            }

            choices.forEach((c, i) => {
                const b     = document.createElement('button');
                b.innerText = `(${i + 1}) ${c}`;
                b.onclick   = () => {
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
    // ── Save: ZIP both files together ─────────────────────────────────────────
    window.downloadPair = () => {
        const machineStr  = strToU8(JSON.stringify(config, null, 2));
        const servicesStr = strToU8(window._loadedServicesSource || '// realtor-services.js not available');
        const zipped = zipSync({
            'realtor-machine.json':  machineStr,
            'realtor-services.js':   servicesStr,
        });
        const blob = new Blob([zipped], { type: 'application/zip' });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `${config.id || 'flow'}.zip`;
        a.click();
        console.log('💾 Saved flow ZIP:', a.download);
    };

    // ── Load: ZIP, bare .json, bare .js, or .json + .js picked together ───────
    window.loadPair = async (fileList) => {
        if (!fileList?.length) return;
        const files = Array.from(fileList);

        const zipFile  = files.find(f => f.name.endsWith('.zip'));
        const jsonFile = files.find(f => f.name.endsWith('.json'));
        const jsFile   = files.find(f => f.name.endsWith('.js'));

        const readText = (f) => new Promise((res, rej) => {
            const r = new FileReader();
            r.onload  = e => res(e.target.result);
            r.onerror = rej;
            r.readAsText(f);
        });

        if (zipFile) {
            // ── ZIP path ──────────────────────────────────────────────────────
            const buf      = await zipFile.arrayBuffer();
            const unzipped = unzipSync(new Uint8Array(buf));

            const machineEntry  = Object.keys(unzipped).find(k => k.endsWith('.json'));
            const servicesEntry = Object.keys(unzipped).find(k => k.endsWith('.js'));

            if (!machineEntry) { console.error('❌ ZIP contains no .json file'); return; }
            try {
                const newConfig = JSON.parse(strFromU8(unzipped[machineEntry]));
                Object.assign(config, newConfig);
                console.log('📂 [ZIP] Machine loaded:', machineEntry, '→', newConfig.id);
            } catch (e) { console.error('❌ Failed to parse machine JSON from ZIP:', e.message); return; }

            if (servicesEntry) {
                await reloadServices(strFromU8(unzipped[servicesEntry]), servicesEntry);
            }

        } else {
            // ── Loose files path (one or two files) ───────────────────────────
            if (jsonFile) {
                try {
                    const newConfig = JSON.parse(await readText(jsonFile));
                    Object.assign(config, newConfig);
                    console.log('📂 [JSON] Machine loaded:', jsonFile.name, '→', newConfig.id);
                } catch (e) { console.error('❌ Failed to parse machine JSON:', e.message); return; }
            }

            if (jsFile) {
                await reloadServices(await readText(jsFile), jsFile.name);
            }

            if (!jsonFile && !jsFile) {
                console.error('❌ Unsupported file type — drop a .zip, .json, .js, or both');
                return;
            }
        }

        window.currentEngine.restart();
    };

    // Shared helper: dynamically re-import a services JS string
    async function reloadServices(src, label) {
        window._loadedServicesSource = src;
        try {
            const blob    = new Blob([src], { type: 'text/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            const mod     = await import(/* @vite-ignore */ blobUrl);
            URL.revokeObjectURL(blobUrl);
            const newServices = mod.realtorServices ?? mod.default ?? mod;
            Object.assign(window.currentEngine.services, newServices);
            console.log('📂 Services loaded:', label);
        } catch (e) {
            console.warn(`⚠️  Could not re-import services (${label}):`, e.message);
            console.warn('   Existing services will be used.');
        }
    }

    window.copyTrace = () => {
        const ctx  = window.currentEngine.actor.getSnapshot().context;
        const text = JSON.stringify(ctx.trace);
        navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById('copy-btn');
            if (!btn) return;
            const orig    = btn.innerText;
            btn.innerText = '✅ Copied!';
            setTimeout(() => btn.innerText = orig, 2000);
        });
    };
}

window.addEventListener('load', () => {
    console.log('🏁 DOM ready');
    boot();
});
