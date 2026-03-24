import { Runtime }          from './Runtime.js';
import { ChatUI }            from './ChatUI.js';
import { realtorServices }   from './realtor-services.js';
import { loadVersion }       from './version.js';
import { consoleLogger }     from './logger.js';
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
        window._appVersion    = version;   // read by ui-contracts.js at capture time
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
            window._showResultsDrawer  = m.showResultsDrawer;
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
    window._visitedEdges = visitedEdges;
    let _lastStateId     = null;

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
        if (profile) {
            const { _trace, ...rest } = context;
            const traceRows = (_trace?.steps ?? []).map((s, i) => {
                if (s.service)         return `  [${i}] ⚙️  ${s.service} ok=${s.ok} (${s.ms}ms)`;
                if (s.valid === false)  return `  [${i}] ❌ ${s.stateId} "${s.value}" (${s.ms}ms)`;
                return                        `  [${i}] ✅ ${s.stateId} "${s.value}" (${s.ms}ms)`;
            }).join('\n');
            const traceHeader = _trace
                ? `_trace: session=${_trace.sessionId?.slice(0,8)}… flow=${_trace.flowId}@${_trace.flowVersion}\n${traceRows || '  (no steps yet)'}`
                : '_trace: null';
            profile.innerText = traceHeader + '\n\n' + JSON.stringify(rest, null, 2);
        }
        if (stateDisplay) stateDisplay.innerText = `State: ${stateId}`;

        // Diagram
        if (window.renderDiagram) {
            window.renderDiagram(config, stateId, visitedEdges).catch(e =>
                console.error('❌ Diagram render failed:', e.message)
            );
        }
    }

    // ── Start runtime + ChatUI ─────────────────────────────────────────────────
    console.log('🚀 Starting Runtime…');
    window.currentRuntime = new Runtime(config, realtorServices, consoleLogger);

    const chatMount = document.getElementById('chat-mount');
    const chatUI    = new ChatUI(window.currentRuntime, chatMount);
    chatUI.mount();

    // IDE subscribes after ChatUI so it piggybacks without replacing the callbacks.
    // We wrap onSnapshot to fan out to both ChatUI and renderIDE.
    const chatSnapshot = window.currentRuntime.onSnapshot;
    window.currentRuntime.onSnapshot = (snap) => {
        chatSnapshot(snap);
        renderIDE(snap);
    };

    window.currentRuntime.start();
    console.log('✅ Runtime started');

    // ── Restart ───────────────────────────────────────────────────────────────
    window._restartRuntime = (overrideConfig) => {
        if (overrideConfig && overrideConfig !== config) {
            Object.assign(config, overrideConfig);
            window._config = config;
            window.currentRuntime = new Runtime(config, realtorServices, consoleLogger);

            // Re-mount ChatUI on the new runtime instance
            chatUI.runtime = window.currentRuntime;
            chatUI.mount();

            const newChatSnapshot = window.currentRuntime.onSnapshot;
            window.currentRuntime.onSnapshot = (snap) => {
                newChatSnapshot(snap);
                renderIDE(snap);
            };
        }

        visitedEdges.clear();
        _lastStateId = null;
        chatUI.clear();
        window.currentRuntime.restart();
    };

    // Replay: clear the DOM first, then let the runtime replay into it.
    window._replayTrace = (traceString, overrideConfig) => {
        window._restartRuntime(overrideConfig);
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
    const W = window.innerWidth, H = window.innerHeight;
    console.log(`📐 Inner viewport: ${W} × ${H} px`);
    console.groupCollapsed('%c📐 UI Contracts — quick start', 'color:#61dafb; font-weight:bold;');
    console.log(
        `Current viewport: ${W}×${H}\n\n` +
        `For a stable fixed-size window, run:\n` +
        `  window.open(location.href, '_blank', 'width=1024,height=768')\n` +
        `then undock DevTools before measuring.\n\n` +
        `First time (or after intentional layout changes):\n` +
        `  await window.ui_contracts('capture', '1024x768')  ← saves ui-baseline-1024x768.json\n\n` +
        `Before / after every change:\n` +
        `  await window.ui_contracts('check', '1024x768')    ← checks against that baseline`
    );
    console.groupEnd();
});

window.downloadProductionBundle = async () => {
    console.log('📦 Packaging flow for production deployment…');
    const base = new URL('./', import.meta.url).href;

    const fetchText = (f) => fetch(base + f).then(r => {
        if (!r.ok) throw new Error(`Failed to fetch ${f}: HTTP ${r.status}`);
        return r.text();
    });

    console.log('📦 Fetching production files…');
    const [runtime, chatui, chatcss, services, validators_, logger_, versionjs] =
        await Promise.all([
            fetchText('Runtime.js'),
            fetchText('ChatUI.js'),
            fetchText('chat-theme.css'),
            fetchText('realtor-services.js'),
            fetchText('validators.js'),
            fetchText('logger.js'),
            fetchText('version.js'),
        ]);

    const config   = window._config;
    const version  = window._appVersion ?? 'unknown';
    const flowId   = config?.id ?? 'chatbot';
    const packedAt = new Date().toISOString();

    const minimalHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${flowId}</title>
  <link rel="stylesheet" href="./chat-theme.css">
  <script type="importmap">
      { "imports": {
	  "xstate":  "https://unpkg.com/xstate@5/dist/xstate.esm.js",
	  "mermaid": "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs",
	  "fflate":  "https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js"
      }}
  </script>
</head>
<body>
  <div id="chat-mount" style="display:flex;flex-direction:column;height:100vh"></div>
  <script type="module">
    import { Runtime }          from './Runtime.js';
    import { ChatUI }           from './ChatUI.js';
    import { realtorServices }  from './realtor-services.js';
    import { nullLogger }       from './logger.js';

    const res    = await fetch('./realtor-machine.json');
    const config = await res.json();
    const rt     = new Runtime(config, realtorServices, nullLogger);
    const ui     = new ChatUI(rt, document.getElementById('chat-mount'));
    ui.mount();
    rt.start();
  <\/script>
</body>
</html>`;

    const manifest = [
        `flow:      ${flowId}`,
        `version:   ${version}`,
        `packedAt:  ${packedAt}`,
        ``,
        `files:`,
        `  index.html             (generated)`,
        `  Runtime.js`,
        `  ChatUI.js`,
        `  chat-theme.css`,
        `  realtor-machine.json   (in-memory config at pack time)`,
        `  realtor-services.js`,
        `  validators.js`,
        `  logger.js`,
        `  version.js`,
        `  MANIFEST.txt           (this file)`,
    ].join('\n');

    const { zipSync, strToU8 } = await import('fflate');
    const zipped = zipSync({
        'index.html':              strToU8(minimalHtml),
        'Runtime.js':              strToU8(runtime),
        'ChatUI.js':               strToU8(chatui),
        'chat-theme.css':          strToU8(chatcss),
        'realtor-machine.json':    strToU8(JSON.stringify(config, null, 2)),
        'realtor-services.js':     strToU8(services),
        'validators.js':           strToU8(validators_),
        'logger.js':               strToU8(logger_),
        'version.js':              strToU8(versionjs),
        'MANIFEST.txt':            strToU8(manifest),
    });

    const blob = new Blob([zipped], { type: 'application/zip' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `${flowId}-prod-${packedAt.slice(0,10)}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);

    console.log(`✅ Production bundle downloaded: ${a.download}`);
    console.log(`   Files: 9 | Flow: ${flowId} | Version: ${version}`);
};
