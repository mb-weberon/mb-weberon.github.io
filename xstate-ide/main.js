import { Runtime } from './Runtime.js';
import { realtorServices } from './realtor-services.js';
import { loadVersion } from './version.js';
import { consoleLogger } from './logger.js';
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
        import('./generate-traces.js').then(m => {
	    window._config             = config;
	    window.generateTraces      = () => m.generateTraces(config);
	    window.downloadTestResults = m.downloadTestResults;
	    window.stopAllTraces       = m.stopAllTraces;
	    window.loadTestResults     = m.loadTestResults;
	    window.runAllTraces        = (pauseMs) => m.runAllTraces(
		config,
		window._replayTrace,
		() => window.currentRuntime.getTrace(),
		() => {
		    const s = window.currentRuntime.actor.getSnapshot();
		    return typeof s.value === 'string' ? s.value : Object.keys(s.value)[0];
		},
		pauseMs
	    );
	});
    } catch (e) {
        console.error('❌ Failed to load machine config:', e.message);
        return;
    }

    try {
        const res = await fetchLocal('realtor-services.js');
        if (res.ok) window._loadedServicesSource = await res.text();
    } catch (_) { /* non-fatal */ }

    // ── Visited edge tracking (IDE only) ──────────────────────────────────────
    const visitedEdges   = new Set();
    window._visitedEdges = visitedEdges;   // exposed for test runner capture
    let _lastStateId     = null;
    let _lastTraceLength = 0;

    // ── Chat rendering ────────────────────────────────────────────────────────
    function renderChat(snap) {
        const { stateId, message, input, placeholder, choices, error } = snap;

        // Add user bubble for the event that caused this transition.
        // Guard on trace length so we never double-up with onReplayStep bubbles.
        if (message && snap.context.trace?.length > _lastTraceLength) {
            const lastTrace = snap.context.trace[snap.context.trace.length - 1];
            addBubble(lastTrace, 'user');
            _lastTraceLength = snap.context.trace.length;
        }

        if (message) {
            addBubble(message, 'bot');
        }

        if (error) {
            showError(error);
            return;   // self-transition: don't rebuild input controls
        }

        const area = document.getElementById('input-area');
        if (!area) return;
        area.innerHTML = '';

        if (input === 'text') {
            const inputEl       = document.createElement('input');
            inputEl.type        = 'text';
            inputEl.placeholder = placeholder || 'Type and press Enter...';

            const sendBtn         = document.createElement('button');
            sendBtn.innerText     = 'Send';
            sendBtn.style.cssText = 'flex-shrink:0;';

            const go = () => {
                const val = inputEl.value.trim();
                if (!val) return;
                inputEl.value = '';
                window.currentRuntime.submit(val);
            };

            inputEl.onkeydown = (e) => { if (e.key === 'Enter') go(); };
            sendBtn.onclick   = go;

            area.appendChild(inputEl);
            area.appendChild(sendBtn);
            setTimeout(() => inputEl.focus(), 100);
        }

        choices.forEach((c, i) => {
            const b     = document.createElement('button');
            b.innerText = `(${i + 1}) ${c}`;
            b.onclick   = () => window.currentRuntime.send(c);
            area.appendChild(b);
        });
    }

    // ── IDE rendering ─────────────────────────────────────────────────────────
    function renderIDE(snap) {
        const { stateId, context } = snap;

        // Visited edge tracking
        if (_lastStateId && _lastStateId !== stateId && context.trace?.length) {
            const lastEvent = context.trace[context.trace.length - 1];
            visitedEdges.add(`${_lastStateId}|${lastEvent}`);
        }
        _lastStateId = stateId;

        // Context viewer
        const profile      = document.getElementById('profile-view');
        const stateDisplay = document.getElementById('state-id');
        if (profile)      profile.innerText      = JSON.stringify(context, null, 2);
        if (stateDisplay) stateDisplay.innerText = `State: ${stateId}`;

        // Diagram
        if (window.renderDiagram) {
            window.renderDiagram(config, stateId, visitedEdges).catch(e =>
                console.error('❌ Diagram render failed:', e.message)
            );
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function addBubble(text, side) {
        const m = document.getElementById('messages');
        if (!m) return;
        const d = document.createElement('div');
        d.className = `msg ${side}`;
        d.innerText = text;
        m.appendChild(d);
        m.scrollTop = m.scrollHeight;
    }

    function showError(message) {
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
    }

    // ── Start runtime ─────────────────────────────────────────────────────────
    console.log('🚀 Starting Runtime...');
    window.currentRuntime = new Runtime(config, realtorServices, consoleLogger);

    window.currentRuntime.onSnapshot = (snap) => {
        renderChat(snap);
        renderIDE(snap);
    };

    // onReplayStep fires BEFORE the snapshot for that step, so we add the user
    // bubble here and advance _lastTraceLength to prevent renderChat doubling it.
    window.currentRuntime.onReplayStep = (item) => {
        addBubble(item, 'user');
        _lastTraceLength++;
    };

    window.currentRuntime.start();
    console.log('✅ Runtime started');

    // ── Restart ───────────────────────────────────────────────────────────────
    window._restartRuntime = (overrideConfig) => {
        if (overrideConfig && overrideConfig !== config) {
            // Swap the live config and rebuild the Runtime with the override
            Object.assign(config, overrideConfig);
            window._config = config;
            window.currentRuntime = new Runtime(config, realtorServices, consoleLogger);
            window.currentRuntime.onSnapshot = (snap) => {
                renderChat(snap);
                renderIDE(snap);
            };
            window.currentRuntime.onReplayStep = (item) => {
                addBubble(item, 'user');
                _lastTraceLength++;
            };
        }
        document.getElementById('messages').innerHTML = '';
        visitedEdges.clear();
        _lastStateId     = null;
        _lastTraceLength = 0;
        window.currentRuntime.restart();
    };

    // Replay must go through _restartRuntime so the DOM clears and
    // _lastTraceLength resets before the replay steps start firing.
    window._replayTrace = (traceString, overrideConfig) => {
        window._restartRuntime(overrideConfig);
        // Small delay to let the initial state snapshot render before steps begin
        setTimeout(() => window.currentRuntime.replay(traceString), 50);
    };

    // ── Save / Load Flow ──────────────────────────────────────────────────────
    window.downloadPair = () => {
        const machineStr  = strToU8(JSON.stringify(config, null, 2));
        const servicesStr = strToU8(window._loadedServicesSource || '// realtor-services.js not available');
        const zipped = zipSync({
            'realtor-machine.json': machineStr,
            'realtor-services.js':  servicesStr,
        });
        const blob = new Blob([zipped], { type: 'application/zip' });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `${config.id || 'flow'}.zip`;
        a.click();
        console.log('💾 Saved flow ZIP:', a.download);
    };

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
            const buf      = await zipFile.arrayBuffer();
            const unzipped = unzipSync(new Uint8Array(buf));
            const machineEntry  = Object.keys(unzipped).find(k => k.endsWith('.json'));
            const servicesEntry = Object.keys(unzipped).find(k => k.endsWith('.js'));
            if (!machineEntry) { console.error('❌ ZIP contains no .json file'); return; }
            try {
                Object.assign(config, JSON.parse(strFromU8(unzipped[machineEntry])));
            } catch (e) { console.error('❌ Failed to parse machine JSON from ZIP:', e.message); return; }
            if (servicesEntry) await reloadServices(strFromU8(unzipped[servicesEntry]), servicesEntry);
        } else {
            if (jsonFile) {
                try { Object.assign(config, JSON.parse(await readText(jsonFile))); }
                catch (e) { console.error('❌ Failed to parse machine JSON:', e.message); return; }
            }
            if (jsFile) await reloadServices(await readText(jsFile), jsFile.name);
            if (!jsonFile && !jsFile) { console.error('❌ Unsupported file type'); return; }
        }

        window._restartRuntime();
    };

    async function reloadServices(src, label) {
        window._loadedServicesSource = src;
        try {
            const blob    = new Blob([src], { type: 'text/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            const mod     = await import(/* @vite-ignore */ blobUrl);
            URL.revokeObjectURL(blobUrl);
            const newServices = mod.realtorServices ?? mod.default ?? mod;
            Object.assign(window.currentRuntime.services, newServices);
            console.log('📂 Services loaded:', label);
        } catch (e) {
            console.warn(`⚠️  Could not re-import services (${label}):`, e.message);
        }
    }

    window.copyTrace = () => {
        const text = JSON.stringify(window.currentRuntime.getTrace());
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
