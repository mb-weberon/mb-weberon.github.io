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
        window._appVersion    = version;
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
            window._config            = config;
            window.generateTraces     = () => m.generateTraces(config);
            window.downloadTestResults = m.downloadTestResults;
            window.stopAllTraces      = m.stopAllTraces;
            window.loadTestResults    = (file) => {
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const results = JSON.parse(e.target.result);
                        window._testResults = results;
                        _renderResults(results);
                        console.log(`✅ Loaded ${results.cases?.length} test cases from file`);
                    } catch (err) {
                        console.error('❌ Failed to parse results JSON:', err.message);
                    }
                };
                reader.readAsText(file);
            };

            // runAllTraces: run via generate-traces.js, suppress the floating
            // badge/drawer it creates, and render results into the inline panel.
            window.runAllTraces = async (pauseMs = 1500) => {
                // Observe body for the floating badge; hide it and mirror
                // progress text to our inline bar instead.
                const badgeObserver = new MutationObserver(() => {
                    const badge = document.getElementById('test-status-badge');
                    if (!badge) return;
                    badge.style.display = 'none';
                    const text  = badge.querySelector('span')?.innerText ?? '';
                    const match = text.match(/(\d+)\s*\/\s*(\d+)/);
                    if (match) _updateProgress(parseInt(match[1]), parseInt(match[2]));
                });
                badgeObserver.observe(document.body, { childList: true, subtree: true,
                    attributes: true, characterData: true });

                let results;
                try {
                    results = await m.runAllTraces(
                        config,
                        window._replayTrace,
                        () => window.currentRuntime.getTrace(),
                        () => {
                            const s = window.currentRuntime.actor.getSnapshot();
                            return typeof s.value === 'string' ? s.value : Object.keys(s.value)[0];
                        },
                        pauseMs
                    );
                } finally {
                    badgeObserver.disconnect();
                    // Remove floating badge and drawer — we render inline instead
                    document.getElementById('test-status-badge')?.remove();
                    document.getElementById('test-results-drawer')?.remove();
                    const dp = document.getElementById('diagram-pane');
                    if (dp) dp.style.paddingBottom = '';
                }

                if (results) _renderResults(results);
                return results;
            };
        });
    } catch (e) {
        console.error('❌ Failed to load machine config:', e.message);
        return;
    }

    try {
        const res = await fetchLocal('realtor-services.js');
        if (res.ok) window._loadedServicesSource = await res.text();
    } catch (_) { /* non-fatal */ }

    // ── Visited edge tracking ─────────────────────────────────────────────────
    const visitedEdges   = new Set();
    window._visitedEdges = visitedEdges;
    let _lastStateId     = null;

    // ── Test panel: title init ────────────────────────────────────────────────
    const tdpTitle = document.getElementById('tdp-title');
    if (tdpTitle && config?.id) tdpTitle.textContent = `🧪 ${config.id}`;

    // ── Test panel: expand / collapse ────────────────────────────────────────
    let _tdpExpanded = false;

    const tdpPanel       = document.getElementById('test-debug-panel');
    const tdpHeader      = document.getElementById('tdp-header');
    const tdpCollapseBtn = document.getElementById('tdp-collapse-btn');

    function _setTdpExpanded(expanded) {
        _tdpExpanded = expanded;
        tdpPanel.classList.toggle('expanded', expanded);
        tdpCollapseBtn.textContent = expanded ? '▼' : '▲';
        tdpCollapseBtn.title       = expanded ? 'Collapse' : 'Expand';
    }

    // Clicking anywhere on the header bar (not a button) toggles expand
    tdpHeader.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        _setTdpExpanded(!_tdpExpanded);
    });

    tdpCollapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        _setTdpExpanded(!_tdpExpanded);
    });

    // ── Test panel: run / stop wiring ─────────────────────────────────────────
    const tdpRunBtn  = document.getElementById('tdp-run-btn');
    const tdpStopBtn = document.getElementById('tdp-stop-btn');
    const tdpLoadBtn = document.getElementById('tdp-load-btn');

    function _setRunning(running) {
        tdpRunBtn.style.display  = running ? 'none' : '';
        tdpLoadBtn.style.display = running ? 'none' : '';
        tdpStopBtn.style.display = running ? ''     : 'none';
        const progress = document.getElementById('tdp-progress');
        if (running) {
            progress.classList.add('visible');
            _setTdpExpanded(true);
        } else {
            progress.classList.remove('visible');
        }
    }

    tdpRunBtn.addEventListener('click', () => {
        if (!window.runAllTraces) return;
        _setRunning(true);
        window.runAllTraces().finally(() => _setRunning(false));
    });

    tdpStopBtn.addEventListener('click', () => {
        window.stopAllTraces?.();
        _setRunning(false);
    });

    // ── Test panel: progress update ───────────────────────────────────────────
    function _updateProgress(current, total) {
        const label = document.getElementById('tdp-progress-label');
        const fill  = document.getElementById('tdp-progress-fill');
        if (label) label.textContent = `${current} / ${total}`;
        if (fill)  fill.style.width  = total > 0 ? `${(current / total) * 100}%` : '0%';
    }

    // ── Test panel: render results into the table ─────────────────────────────
    function _renderResults(results) {
        window._testResults = results;

        // Update summary in handle bar
        const summary = document.getElementById('tdp-summary');
        if (summary) {
            const { passed, total, failed } = results;
            summary.textContent  = `${passed}/${total} passed`;
            summary.style.color  = failed === 0 ? '#98c379' : '#e06c75';
        }

        // Update title with flowId
        if (tdpTitle && results.flowId) tdpTitle.textContent = `🧪 ${results.flowId}`;

        const tbody = document.getElementById('tdp-results-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        let firstCase = null, firstTr = null;

        results.cases.forEach((c) => {
            const tr = document.createElement('tr');
            tr.style.cssText = `cursor:pointer; border-bottom:1px solid #2c313a; transition:background 0.1s;`;
            tr.innerHTML = `
                <td style="padding:4px 8px; color:#666; width:28px;">${c.path}</td>
                <td style="padding:4px 8px; width:30px;">${c.passed ? '✅' : '❌'}</td>
                <td style="padding:4px 8px; color:#abb2bf; max-width:160px; overflow:hidden;
                    text-overflow:ellipsis; white-space:nowrap;"
                    title="${c.expected.join(' → ')}">${c.expected.join(' → ')}</td>
                <td style="padding:4px 8px; color:${c.passed ? '#98c379' : '#e06c75'}; width:90px;
                    overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${c.finalStateId}</td>
            `;

            // Diff row (shown on click for failed cases)
            let diffRow = null;
            if (!c.passed) {
                diffRow = document.createElement('tr');
                diffRow.style.cssText = `display:none; background:#2c1e1e;`;
                diffRow.innerHTML = `
                    <td colspan="4" style="padding:4px 12px; color:#e06c75; font-size:10px;
                        font-family:'Courier New',monospace; line-height:1.6;">
                        ${c.diffs.map(d => `⚠ ${d}`).join('<br>')}
                    </td>
                `;
            }

            let selectedRow = null;

            tr.onmouseenter = () => { if (tr !== selectedRow) tr.style.background = '#2c313a'; };
            tr.onmouseleave = () => { if (tr !== selectedRow) tr.style.background = ''; };

            tr.onclick = () => {
                if (selectedRow) { selectedRow.style.background = ''; selectedRow.style.outline = ''; }
                selectedRow = tr;
                tr.style.background = '#2d3a4a';
                tr.style.outline    = '1px solid #0084ff';

                if (diffRow) diffRow.style.display = diffRow.style.display === 'none' ? '' : 'none';

                // Populate replay input
                const replayInput = document.getElementById('tdp-replay-input');
                if (replayInput) {
                    replayInput.value = JSON.stringify(c.expected);
                }

                // Restore context viewer
                _restoreContextFromCase(c, results.config ?? config);

                // Open state/trace sub-section automatically
                const tracePanel = document.getElementById('tdp-state-trace');
                if (tracePanel && !tracePanel.classList.contains('open')) {
                    window.toggleStateTrace();
                }
            };

            if (!firstTr) { firstTr = tr; firstCase = c; }

            tbody.appendChild(tr);
            if (diffRow) tbody.appendChild(diffRow);
        });

        // Auto-select first row
        if (firstTr && firstCase) firstTr.click();

        // Ensure panel is expanded to show results
        _setTdpExpanded(true);
    }

    // Restore context viewer and diagram from a saved test case
    function _restoreContextFromCase(c, caseConfig) {
        const profile      = document.getElementById('tdp-profile-view');
        const stateDisplay = document.getElementById('tdp-state-id');

        if (profile) {
            const ctx = c.finalContext ?? {};
            const { _trace, ...rest } = ctx;
            const traceRows = (_trace?.steps ?? []).map((s, i) => {
                if (s.service)        return `  [${i}] ⚙️  ${s.service} ok=${s.ok} (${s.ms}ms)`;
                if (s.valid === false) return `  [${i}] ❌ ${s.stateId} "${s.value}" (${s.ms}ms)`;
                return                       `  [${i}] ✅ ${s.stateId} "${s.value}" (${s.ms}ms)`;
            }).join('\n');
            const traceHeader = _trace
                ? `_trace: session=${_trace.sessionId?.slice(0,8)}… flow=${_trace.flowId}@${_trace.flowVersion}\n${traceRows || '  (no steps yet)'}`
                : '_trace: null';
            profile.innerText = traceHeader + '\n\n' + JSON.stringify(rest, null, 2);
        }

        if (stateDisplay) stateDisplay.innerText = `State: ${c.finalStateId}`;

        // Restore chat bubbles
        const messages = document.getElementById('messages');
        if (messages && c.bubbles?.length) {
            messages.innerHTML = '';
            c.bubbles.forEach(b => {
                const d     = document.createElement('div');
                d.className = `msg ${b.side}`;
                d.innerText = b.text;
                messages.appendChild(d);
            });
            messages.scrollTop = messages.scrollHeight;
        }

        // Re-render diagram with captured visited edges
        if (window.renderDiagram) {
            window.renderDiagram(
                caseConfig ?? config,
                c.finalStateId,
                new Set(c.visitedEdges ?? [])
            ).catch(() => {});
        }
    }

    // ── IDE rendering (live updates from runtime) ─────────────────────────────
    function renderIDE(snap) {
        const { stateId, context } = snap;

        // Visited edge tracking
        if (_lastStateId && _lastStateId !== stateId && context.trace?.length) {
            const lastEvent = context.trace[context.trace.length - 1];
            visitedEdges.add(`${_lastStateId}|${lastEvent}`);
        }
        _lastStateId = stateId;

        // Context & state viewer
        const profile      = document.getElementById('tdp-profile-view');
        const stateDisplay = document.getElementById('tdp-state-id');

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

    // Fan out onSnapshot to both ChatUI and renderIDE
    const chatSnapshot = window.currentRuntime.onSnapshot;
    window.currentRuntime.onSnapshot = (snap) => {
        chatSnapshot(snap);
        renderIDE(snap);
    };

    window.currentRuntime.start();
    console.log('✅ Runtime started');

    // ── Preview mode ──────────────────────────────────────────────────────────
    let _tdpExpandedBeforePreview = false;

    window.enterPreview = () => {
        _tdpExpandedBeforePreview = _tdpExpanded;
        // Populate preview header
        const flowTitle   = document.getElementById('preview-flow-title');
        const versionBadge = document.getElementById('preview-version-badge');
        if (flowTitle)    flowTitle.textContent   = config?.id ?? 'chatbot';
        if (versionBadge) versionBadge.textContent = window._appVersion ?? '';

        document.body.classList.add('preview-mode');
        const previewBtn = document.getElementById('preview-btn');
        if (previewBtn) { previewBtn.textContent = '✕ Preview'; previewBtn.classList.add('active'); }
        // Wire the button to exit instead of enter
        previewBtn.onclick = window.exitPreview;
        console.log('👁 Preview mode entered');
    };

    window.exitPreview = () => {
        document.body.classList.remove('preview-mode');
        const previewBtn = document.getElementById('preview-btn');
        if (previewBtn) {
            previewBtn.textContent = '👁 Preview';
            previewBtn.classList.remove('active');
            previewBtn.onclick = window.enterPreview;
        }
        // Restore test panel expand state
        _setTdpExpanded(_tdpExpandedBeforePreview);
        console.log('👁 Preview mode exited');
    };

    // ── Restart ───────────────────────────────────────────────────────────────
    window._restartRuntime = (overrideConfig) => {
        if (overrideConfig && overrideConfig !== config) {
            Object.assign(config, overrideConfig);
            window._config = config;
            window.currentRuntime = new Runtime(config, realtorServices, consoleLogger);

            chatUI.runtime = window.currentRuntime;
            chatUI.mount();

            const newChatSnapshot = window.currentRuntime.onSnapshot;
            window.currentRuntime.onSnapshot = (snap) => {
                newChatSnapshot(snap);
                renderIDE(snap);
            };

            // Update test panel title
            if (tdpTitle && config?.id) tdpTitle.textContent = `🧪 ${config.id}`;
        }

        visitedEdges.clear();
        _lastStateId = null;
        chatUI.clear();
        window.currentRuntime.restart();
    };

    // Replay: clear DOM first, then replay into it
    window._replayTrace = (traceString, overrideConfig) => {
        window._restartRuntime(overrideConfig);
        setTimeout(() => window.currentRuntime.replay(traceString), 50);
    };

    // ── Copy trace ────────────────────────────────────────────────────────────
    window.copyTrace = () => {
        const text = JSON.stringify(window.currentRuntime.getTrace());
        navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById('tdp-copy-btn');
            if (!btn) return;
            const orig    = btn.textContent;
            btn.textContent = '✅ Copied!';
            setTimeout(() => btn.textContent = orig, 2000);
        });
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
            const key     = Object.keys(mod).find(k => k.endsWith('Services') || k.endsWith('services'));
            if (key) {
                Object.assign(realtorServices, mod[key]);
                console.log(`✅ Services reloaded from ${label}`);
            } else {
                console.warn(`⚠️  No *Services export found in ${label}`);
            }
        } catch (e) {
            console.error(`❌ Failed to load services from ${label}:`, e.message);
        }
    }

    // ── Production bundle ─────────────────────────────────────────────────────
    window.downloadProductionBundle = async () => {
        console.log('📦 Packaging flow for production deployment…');
        const base = new URL('./', import.meta.url).href;

        const fetchText = (f) => fetch(base + f).then(r => {
            if (!r.ok) throw new Error(`Failed to fetch ${f}: HTTP ${r.status}`);
            return r.text();
        });

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

        const version_  = window._appVersion ?? 'unknown';
        const flowId    = config?.id ?? 'chatbot';
        const packedAt  = new Date().toISOString();

        const minimalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${flowId}</title>
  <link rel="stylesheet" href="./chat-theme.css">
  <script type="importmap">
      { "imports": {
          "xstate": "https://unpkg.com/xstate@5/dist/xstate.esm.js",
          "fflate": "https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js"
      }}
  <\/script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin:0; padding:0; height:100%; overflow:hidden;
      font-family:'Segoe UI',system-ui,sans-serif; background:#f4f7f6; }
    #app { position:fixed; inset:0; display:flex; flex-direction:column;
      align-items:center; background:#f4f7f6; }
    #chat-card { width:100%; max-width:560px; height:100%; display:flex;
      flex-direction:column; background:#fff; box-shadow:0 0 24px rgba(0,0,0,0.08); }
    #chat-header { flex-shrink:0; padding:12px 16px 10px; background:#1c1e21;
      display:flex; align-items:baseline; gap:8px; }
    #chat-title { font-family:'Courier New',monospace; font-size:14px; font-weight:bold;
      color:#61dafb; letter-spacing:0.05em; }
    #chat-version { font-family:'Courier New',monospace; font-size:11px; font-weight:bold;
      color:#fff; background:#0051cc; border:1px solid #3a8fff; border-radius:4px; padding:1px 6px; }
    #chat-mount { flex:1; display:flex; flex-direction:column; overflow:hidden; min-height:0; }
  </style>
</head>
<body>
  <div id="app">
    <div id="chat-card">
      <div id="chat-header">
        <span id="chat-title">${flowId}</span>
        <span id="chat-version">${version_}</span>
      </div>
      <div id="chat-mount"></div>
    </div>
  </div>
  <script type="module">
    import { Runtime }         from './Runtime.js';
    import { ChatUI }          from './ChatUI.js';
    import { realtorServices } from './realtor-services.js';
    import { nullLogger }      from './logger.js';
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
            `version:   ${version_}`,
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
        `Capture baseline:\n` +
        `  await window.ui_contracts('capture', '1024x768')\n\n` +
        `Check against baseline:\n` +
        `  await window.ui_contracts('check', '1024x768')`
    );
    console.groupEnd();
});
