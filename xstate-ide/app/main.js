import { Runtime }          from './Runtime.js';
import { ChatUI }            from './ChatUI.js';

// Tracks the currently active services — starts empty until the user loads a flow.
// Replaced by reloadServices() whenever a .js file is loaded dynamically.
let activeServices = {};
import { loadVersion }       from './version.js';
import { consoleLogger }     from './logger.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

const BASE = new URL('.', import.meta.url).href;
const fetchLocal = (file) => fetch(BASE + file);

// ── Toast notifications ────────────────────────────────────────────────────────

function showToast(message, type = 'error') {
    const bg = type === 'warn' ? '#b45309' : '#c0392b';
    const toast = document.createElement('div');
    toast.style.cssText = `
        position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
        background:${bg}; color:#fff;
        font-family:'Courier New',monospace; font-size:13px;
        padding:10px 18px; border-radius:6px;
        box-shadow:0 4px 12px rgba(0,0,0,0.4);
        z-index:9999;
        width:max-content; max-width:min(480px, calc(100vw - 32px));
        text-align:center; word-break:break-word;
        pointer-events:none;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}
window.showToast = showToast;

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

    // ── Config — starts null until a flow is explicitly loaded ────────────────
    // No auto-fetch of realtor-machine.json. The user must load a flow via
    // "Load Flow" or "Load Results" before the IDE becomes interactive.
    let config = null;

    // ── Pre-load generate-traces.js so its exports are ready when needed ──────
    const tracesModule = await import('./generate-traces.js');
    window._showResultsDrawer  = tracesModule.showResultsDrawer;
    window.generateTraces      = () => config ? tracesModule.generateTraces(config) : [];
    window.downloadTestResults = tracesModule.downloadTestResults;
    window.stopAllTraces       = tracesModule.stopAllTraces;
    window.runAllTraces        = (pauseMs) => {
        if (!config) {
            console.warn('⚠️  No flow loaded — use Load Flow first');
            return Promise.resolve();
        }
        return tracesModule.runAllTracesHeadless(config, activeServices, { pauseMs, servicesSource: window._loadedServicesSource });
    };
    window.loadTestResults = (file) =>
        tracesModule.loadTestResults(file);

    // ── Visited edge tracking (IDE only) ──────────────────────────────────────
    const visitedEdges   = new Set();
    window._visitedEdges = visitedEdges;
    let _lastStateId     = null;

    // ── Blank-slate UI — shown when no flow is loaded ─────────────────────────
    // The chat mount shows a placeholder; the diagram shows a hint.
    // Both are replaced as soon as a flow is loaded and the runtime starts.

    const chatMount = document.getElementById('chat-mount');

    function _showBlankSlate() {
        chatMount.innerHTML = `
            <div id="no-flow-placeholder" style="
                flex:1; display:flex; flex-direction:column;
                align-items:center; justify-content:center;
                gap:12px; padding:24px; text-align:center;
                color:#888; font-family:'Segoe UI',sans-serif;
            ">
                <div style="font-size:36px;">📂</div>
                <div style="font-size:15px; font-weight:600; color:#555;">No flow loaded</div>
                <div style="font-size:13px; line-height:1.6;">
                    Use <strong>Load Flow</strong> to open a state machine,<br>
                    or <strong>Load Results</strong> to restore a previous test run.
                </div>
                <div style="
                    font-size:12px; line-height:1.6; color:#aaa;
                    background:#2a2a2a; border:1px solid #3a3a3a;
                    border-radius:6px; padding:10px 14px; max-width:260px;
                ">
                    💡 Load Flow requires both files selected together:<br>
                    <code style="color:#61dafb;">*-machine.json</code> and <code style="color:#61dafb;">*-services.js</code>
                </div>
                <a href="./help.html" target="_blank" style="
                    font-size:12px; color:#61dafb; text-decoration:none;
                    opacity:0.8;
                ">📖 Help &amp; examples</a>
            </div>`;

        const mc = document.getElementById('mermaid-container');
        if (mc) mc.innerHTML = `
            <div style="
                color:#666; font-family:'Segoe UI',sans-serif;
                font-size:13px; text-align:center; padding:24px;
            ">No flow loaded</div>`;

        const profile = document.getElementById('profile-view');
        const stateDisplay = document.getElementById('state-id');
        if (profile) profile.innerText = '(no flow loaded)';
        if (stateDisplay) stateDisplay.innerText = 'State: —';
    }

    _showBlankSlate();

    // Disable buttons that require a loaded flow
    function _setFlowLoaded(loaded) {
        const ids = ['test-btn', 'restart-btn', 'save-flow-btn', 'pack-prod-btn', 'copy-btn'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.disabled = !loaded;
            el.style.opacity = loaded ? '' : '0.4';
            el.style.cursor  = loaded ? '' : 'not-allowed';
        });
    }
    _setFlowLoaded(false);

    // ── IDE rendering ─────────────────────────────────────────────────────────
    function renderIDE(snap) {
        if (!config) return;
        const { stateId, context } = snap;

        if (_lastStateId && _lastStateId !== stateId && context.trace?.length) {
            const lastEvent = context.trace[context.trace.length - 1];
            visitedEdges.add(`${_lastStateId}|${lastEvent}`);
        }
        _lastStateId = stateId;

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

        if (window.renderDiagram) {
            window.renderDiagram(config, stateId, visitedEdges).catch(e =>
                console.error('❌ Diagram render failed:', e.message)
            );
        }
    }

    // ── _activateFlow — creates/replaces Runtime + ChatUI for a given config ──
    // Called by loadPair (Load Flow) and loadTestResults (Load Results).
    // Also called by _restartRuntime when the config changes.
    // chatUI is kept in module scope so _restartRuntime can call chatUI.clear().
    let chatUI = null;

    function _activateFlow(newConfig) {
        // Accept a fresh config object (not necessarily the same reference)
        if (!newConfig) return;

        // Replace module-level config in-place so all closures over `config` see it
        config = newConfig;
        window._config = config;

        // Tear down old runtime + ChatUI if present
        if (window.currentRuntime) {
            try { window.currentRuntime.actor?.stop(); } catch (_) {}
        }
        // Clear chat area before mounting new ChatUI
        chatMount.innerHTML = '';

        visitedEdges.clear();
        _lastStateId = null;

        window.currentRuntime = new Runtime(config, activeServices, consoleLogger);
        chatUI = new ChatUI(window.currentRuntime, chatMount);
        chatUI.mount();

        // Wire IDE rendering on top of ChatUI's snapshot handler
        const baseSnapshot = window.currentRuntime.onSnapshot;
        window.currentRuntime.onSnapshot = (snap) => {
            baseSnapshot(snap);
            renderIDE(snap);
        };

        window.currentRuntime.start();
        console.log('✅ Runtime started for flow:', config.id);

        // Scroll-to-bottom observer on the messages element ChatUI created
        const _messagesEl = chatMount.querySelector('#messages');
        if (_messagesEl && window.ResizeObserver) {
            new ResizeObserver(() => {
                const d = _messagesEl.scrollHeight - _messagesEl.scrollTop - _messagesEl.clientHeight;
                if (d < 80) _messagesEl.scrollTop = _messagesEl.scrollHeight;
            }).observe(_messagesEl);
        }

        _setFlowLoaded(true);
    }

    // ── Restart ───────────────────────────────────────────────────────────────
    // With no arguments: restart the currently loaded flow to its initial state.
    // With a newConfig argument: load the new config and restart (used by
    // loadTestResults to restore the config that was active during the test run).
    window._restartRuntime = (overrideConfig) => {
        if (overrideConfig && overrideConfig !== config) {
            // Config is changing — re-activate with the new config
            _activateFlow(overrideConfig);
            return;  // _activateFlow calls start(), so we're done
        }
        if (!config || !window.currentRuntime) {
            console.warn('⚠️  No flow loaded — nothing to restart');
            return;
        }
        visitedEdges.clear();
        _lastStateId = null;
        chatUI?.clear();
        window.currentRuntime.restart();
        // Replay bar intentionally NOT cleared — useful for comparison after restart.
    };

    // Replay: restart the runtime, then after one tick pass the trace string
    // to Runtime.replay(). delayMs > 0 gives smooth step-by-step UI for manual
    // replays; automated test runs pass 0 to stay fast.
    window._replayTrace = (traceString, overrideConfig, delayMs = 350) => {
        if (!traceString) return;
        window._restartRuntime(overrideConfig);
        setTimeout(() => window.currentRuntime?.replay(traceString, { delayMs }), 50);
    };

    // ── Save / Load Flow ──────────────────────────────────────────────────────
    window.downloadPair = () => {
        if (!config) { console.warn('⚠️  No flow loaded'); return; }
        const flowId      = config.id || 'flow';
        const machineStr  = strToU8(JSON.stringify(config, null, 2));
        const servicesStr = strToU8(window._loadedServicesSource || '// no services loaded');
        const zipped = zipSync({
            [`${flowId}-machine.json`]: machineStr,
            [`${flowId}-services.js`]:  servicesStr,
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

        let newConfig = null;

        if (zipFile) {
            const buf      = await zipFile.arrayBuffer();
            const unzipped = unzipSync(new Uint8Array(buf));
            const machineEntry  = Object.keys(unzipped).find(k => k.endsWith('.json'));
            const servicesEntry = Object.keys(unzipped).find(k => k.endsWith('.js'));
            if (!machineEntry)  { const m = 'ZIP contains no .json machine file'; console.error('❌', m); showToast(m); return; }
            if (!servicesEntry) { const m = 'ZIP contains no .js services file'; console.error('❌', m); showToast(m); return; }
            try {
                newConfig = JSON.parse(strFromU8(unzipped[machineEntry]));
            } catch (e) { const m = `Invalid machine JSON in ZIP: ${e.message}`; console.error('❌', m); showToast(m); return; }
            await reloadServices(strFromU8(unzipped[servicesEntry]), servicesEntry);
        } else {
            if (!jsonFile && !jsFile) { const m = 'Unsupported file type — load a .zip, .json, or .js'; console.error('❌', m); showToast(m); return; }
            if (jsonFile && !jsFile)  { const m = 'Load the .js services file alongside the .json'; console.error('❌', m); showToast(m); return; }
            if (jsonFile) {
                try { newConfig = JSON.parse(await readText(jsonFile)); }
                catch (e) { const m = `Invalid machine JSON: ${e.message}`; console.error('❌', m); showToast(m); return; }
            }
            if (jsFile) await reloadServices(await readText(jsFile), jsFile.name);
        }

        if (newConfig) {
            _activateFlow(newConfig);
        } else if (config) {
            // Services-only reload — hot-patch and restart with existing config
            window._restartRuntime();
        }
    };

    // Programmatic load for test automation (used by ui_full in ui-contracts.js).
    window._loadFlowFromUrl = async (machineUrl, servicesUrl) => {
        const [machineText, servicesText] = await Promise.all([
            fetch(machineUrl).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}: ${machineUrl}`); return r.text(); }),
            fetch(servicesUrl).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}: ${servicesUrl}`); return r.text(); }),
        ]);
        let newConfig;
        try { newConfig = JSON.parse(machineText); }
        catch (e) { const m = `Invalid machine JSON: ${e.message}`; console.error('❌', m); showToast(m); return; }
        await reloadServices(servicesText, servicesUrl.split('/').pop());
        _activateFlow(newConfig);
    };

    // Used by loadTestResults to restore services source from a saved results file.
    window._reloadServicesFromSource = (src, label) => reloadServices(src, label);

    // Used by loadTestResults to restore the active config so runAllTraces re-runs
    // against the right machine. Updating the `config` let is enough — all runAllTraces
    // lambdas close over it by reference.
    window._setActiveConfig = (newConfig) => {
        config = newConfig;
        window._config = newConfig;
    };

    async function reloadServices(src, label) {
        window._loadedServicesSource = src;
        try {
            // Append a unique comment to bust the browser's ES module cache.
            // Without this, Chrome reuses the cached module from a previous
            // import of the same source, so reloading the same file has no effect.
            const cacheBust = `
// cache-bust: ${Date.now()}`;
            const blob    = new Blob([src + cacheBust], { type: 'text/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            const mod     = await import(/* @vite-ignore */ blobUrl);
            // Revoke after import resolves, not before — some browsers re-resolve
            // the URL during module linking which fails if already revoked.
            URL.revokeObjectURL(blobUrl);
            const newServices = mod.realtorServices ?? mod.default ?? mod;
            // Update activeServices so _activateFlow (called right after) picks it up
            activeServices = newServices;
            // Also patch the live runtime in case only services changed (no new config)
            if (window.currentRuntime) {
                Object.assign(window.currentRuntime.services, newServices);
            }
            console.log('📂 Services loaded:', label);
        } catch (e) {
            const m = `Could not load services (${label}): ${e.message}`;
            console.warn('⚠️ ', m);
            showToast(m, 'warn');
        }
    }

    window.copyTrace = () => {
        // getTrace() returns the _trace envelope: { steps: [{stateId, value, at, ms}, ...] }
        // Extract step values (skipping validation failures and service steps) to build
        // a JSON array string — the exact format Runtime.replay() expects.
        const raw = window.currentRuntime.getTrace?.();
        let values = [];
        if (raw && Array.isArray(raw.steps)) {
            values = raw.steps
                .filter(s => s.valid !== false && !s.service && s.value != null)
                .map(s => s.value);
        } else if (Array.isArray(raw)) {
            values = raw.filter(Boolean);
        }
        if (!values.length) { console.warn('copyTrace: nothing to copy'); return; }
        const str = JSON.stringify(values);
        _showReplayBar(str);
        // Close the context panel so the replay bar is immediately visible
        const viewer = document.getElementById('profile-viewer');
        if (viewer?.classList.contains('open')) {
            window.toggleProfile?.();
        }
    };

    // ── Replay bar show / hide ────────────────────────────────────────────────
    window._showReplayBar = _showReplayBar;
    window._clearReplayBar = _clearReplayBar;

    function _showReplayBar(str) {
        const bar   = document.getElementById('replay-bar');
        const input = document.getElementById('replay-input');
        if (!bar || !input) return;
        if (str !== undefined) input.value = str;
        bar.classList.add('visible');
        // Focus input so user can immediately hit ▶ or edit
        setTimeout(() => input.focus(), 50);
    }

    function _clearReplayBar() {
        const bar   = document.getElementById('replay-bar');
        const input = document.getElementById('replay-input');
        if (input) input.value = '';
        if (bar)   bar.classList.remove('visible');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test button + results drawer management
    // ─────────────────────────────────────────────────────────────────────────
    //
    // Test button toggles: 🧪 Test (idle) ↔ ⏹ Stop (running).
    // Load Results button toggles: 📋 Load Results ↔ 💾 Save Results
    //   (flips to Save Results after a test run completes or is stopped,
    //    so the user can save before the results are lost to the next run).
    // ─────────────────────────────────────────────────────────────────────────

    const testBtn        = document.getElementById('test-btn');
    const loadResultsBtn = document.getElementById('load-results-btn');
    const loadFlowBtn    = document.getElementById('load-flow-btn');
    const progressEl     = document.getElementById('test-progress');
    let _testRunning     = false;
    let _resultsSaved    = true;  // true = no unsaved results; flips false after a run

    // Flip Load Results ↔ Save Results, and lock/unlock Load Flow.
    // "Unsaved results" state: results exist but have not been downloaded.
    // In this state Load Flow is disabled to prevent loading a different flow
    // that would make the results meaningless / unrestorable.
    function _setResultsReady(ready) {
        if (!loadResultsBtn) return;
        if (ready) {
            _resultsSaved = false;
            loadResultsBtn.innerHTML = '💾<br>Save<br>Results';
            loadResultsBtn.title     = 'Save test results as JSON';
            loadResultsBtn.onclick   = () => {
                window.downloadTestResults?.();
                // Mark as saved so Load Flow re-enables
                _resultsSaved = true;
                _setResultsReady(false);
            };
            // Disable Load Flow while unsaved results exist
            if (loadFlowBtn) {
                loadFlowBtn.disabled = true;
                loadFlowBtn.title    = 'Save Results before loading a new flow';
                loadFlowBtn.style.opacity = '0.4';
            }
        } else {
            _resultsSaved = true;
            loadResultsBtn.innerHTML = '📋<br>Load<br>Results';
            loadResultsBtn.title     = 'Load a previously saved test results JSON';
            loadResultsBtn.onclick   = () => document.getElementById('load-results').click();
            // Re-enable Load Flow
            if (loadFlowBtn) {
                loadFlowBtn.disabled = false;
                loadFlowBtn.title    = 'Load state machine (.json), services (.js), or both as a ZIP';
                loadFlowBtn.style.opacity = '';
            }
        }
    }

    function _setTestRunning(running, hadResults) {
        _testRunning = running;
        if (running) {
            testBtn.innerHTML = '⏹<br>Stop';
            testBtn.title     = 'Stop the running tests';
            testBtn.classList.add('test-btn-stop');
        } else {
            testBtn.innerHTML = '🧪<br>Test';
            testBtn.title     = 'Auto-generate all paths and run as tests';
            testBtn.classList.remove('test-btn-stop');
            if (progressEl) progressEl.textContent = '';
            _setResultsReady(!!hadResults);
        }
    }

    // ── Badge progress polling ────────────────────────────────────────────────
    let _progressInterval = null;

    function _pinBadge(badge) {
        const toggle = document.getElementById('profile-toggle');
        if (!toggle) return;
        const r = toggle.getBoundingClientRect();
        badge.style.setProperty('bottom',
            (window.innerHeight - r.bottom) + 'px', 'important');
    }

    function _startProgressPolling() {
        _progressInterval = setInterval(() => {
            const badge = document.getElementById('test-status-badge');
            if (!badge || !progressEl) return;
            _pinBadge(badge);
            const text = badge.querySelector('span')?.innerText ?? badge.innerText ?? '';
            if (text) progressEl.textContent = text;
        }, 200);
    }

    function _stopProgressPolling() {
        clearInterval(_progressInterval);
        _progressInterval = null;
    }

    // ── Test button click ─────────────────────────────────────────────────────
    testBtn.addEventListener('click', () => {
        if (_testRunning) {
            window.stopAllTraces?.();
        } else {
            if (!config || !window.currentRuntime) {
                console.warn('⚠️  No flow loaded — use Load Flow first');
                return;
            }
            // Reset Save/Load button back to Load while a new run starts
            _setResultsReady(false);
            _setTestRunning(true);
            _startProgressPolling();
            window.runAllTraces().then(() => {
                _stopProgressPolling();
                _setTestRunning(false, /* hadResults */ true);
            }).catch(() => {
                _stopProgressPolling();
                _setTestRunning(false, /* hadResults */ !!window._testResults);
            });
        }
    });

    // ── Portrait mobile helpers ───────────────────────────────────────────────
    const isMobile   = () => window.innerWidth <= 700;
    const isPortrait = () =>
        window.innerWidth <= 700 && window.innerHeight > window.innerWidth;

    // Resize #diagram-pane to fill exactly the space above the drawer.
    // Called whenever the drawer moves or resizes, and on window resize.
    function _fitDiagramAboveDrawer(drawer) {
        if (!isPortrait()) {
            // Reset any portrait-specific override when not in portrait
            const dp = document.getElementById('diagram-pane');
            if (dp) dp.style.maxHeight = '';
            return;
        }
        const dp = document.getElementById('diagram-pane');
        if (!dp || !drawer) return;
        const drawerTop = drawer.getBoundingClientRect().top;
        // Clamp: diagram always gets at least 80px
        dp.style.maxHeight = Math.max(80, drawerTop) + 'px';
        dp.style.overflow  = 'hidden';
    }

    // ── Drawer row icon injection ─────────────────────────────────────────────
    // generate-traces.js builds rows; we wait for the tbody to be populated
    // then prepend action icons.  Each row is expected to have a data-trace
    // attribute (JSON array) set by generate-traces, OR we read the existing
    // row structure to extract the trace.
    //
    // Row icon layout (prepended as first td):
    //   [ 📋 | ▶ ]   then the original ✅/❌ and trace text columns follow.

    function _getTraceFromRow(tr) {
        // generate-traces.js doesn't set data-trace/data-index on rows.
        // _addIconsToRow stamps _caseIndex directly onto the element.
        if (tr.dataset.trace) {
            try { return JSON.parse(tr.dataset.trace); } catch (_) {}
        }
        const results = window._testResults;
        if (!results?.cases) return null;
        const idx = tr._caseIndex ?? parseInt(tr.dataset.index ?? '-1');
        if (idx < 0 || idx >= results.cases.length) return null;
        const c = results.cases[idx];
        // generate-traces.js uses c.expected as the replay payload
        return c?.expected ?? c?.trace ?? c?.inputs ?? null;
    }

    function _traceToReplayString(trace) {
        // generate-traces.js uses JSON.stringify of the trace array as the
        // replay string format (same as what _replayTrace expects).
        if (!trace) return '';
        return typeof trace === 'string' ? trace : JSON.stringify(trace);
    }

    function _injectRowIcons(drawer) {
        const tbody = drawer.querySelector('tbody');
        if (!tbody) return;

        // Stamp case indices on data rows (skip diff/detail rows which have colspan)
        // generate-traces.js interleaves diffRows (no onclick) between case rows.
        // We identify case rows as those with an onclick handler.
        let caseIdx = 0;
        Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
            if (tr.closest('thead')) return;
            // diff rows have colspan and no cursor:pointer style
            const isDataRow = tr.style.cursor === 'pointer' || typeof tr.onclick === 'function';
            if (isDataRow) {
                tr._caseIndex = caseIdx++;
                _addIconsToRow(tr);
            }
        });

        // ── 2. Fix thead: add icon-column header cell + tighten all th padding ─
        const thead = drawer.querySelector('thead');
        if (thead) {
            const headerRow = thead.querySelector('tr');
            if (headerRow && !headerRow.querySelector('.th-icons')) {
                // Tighten all existing ths to minimal height
                Array.from(headerRow.querySelectorAll('th')).forEach(th => {
                    th.style.padding = '3px 6px';
                });
                const th = document.createElement('th');
                th.className = 'th-icons';
                th.style.cssText = 'width:28px; padding:3px 4px;';
                headerRow.insertBefore(th, headerRow.firstChild);
            }
        }

        // ── 3. Slim the drawer: replace collapse btn with 💾, hide subHeader ───
        // Structure: drawer.children = [header, subHeader, tableWrap]
        const mainHeader = drawer.children[0];
        const subHeader  = drawer.children[1];
        const tableWrap  = drawer.children[2];

        if (mainHeader && subHeader && tableWrap) {
            // generate-traces.js owns collapse via bottom-position sliding.
            // We do NOT install a separate collapse handler here — rows must
            // never be hidden via display:none or max-height:0.
            mainHeader.style.cursor     = 'grab';
            mainHeader.style.userSelect = 'none';

            // tableWrap: always scrollable, never hidden
            tableWrap.style.overflowY  = 'auto';
            tableWrap.style.overflowX  = 'hidden';
            tableWrap.style.maxHeight  = '';

            // Hide the subHeader (the "Run at XX:XX | Download JSON" bar)
            // This reclaims ~24px of height. The 💾 in the main header covers download.
            subHeader.style.display = 'none';
        }

        // Watch for rows added later (during test run)
        new MutationObserver((muts) => {
            muts.forEach(m => m.addedNodes.forEach(node => {
                if (node.nodeName !== 'TR' || node.closest('thead')) return;
                const isDataRow = typeof node.onclick === 'function' || node.style.cursor === 'pointer';
                if (!isDataRow) return;
                // Assign next available index based on already-stamped rows
                let nextIdx = 0;
                Array.from(tbody.querySelectorAll('tr')).forEach(r => {
                    if (r === node) return;
                    if (typeof r.onclick === 'function' || r.style.cursor === 'pointer') {
                        if (r._caseIndex === undefined) r._caseIndex = nextIdx;
                        nextIdx = r._caseIndex + 1;
                    }
                });
                node._caseIndex = nextIdx;
                _addIconsToRow(node);
            }));
        }).observe(tbody, { childList: true });
    }

    function _addIconsToRow(tr) {
        // Don't double-inject
        if (tr.querySelector('.row-action-icons')) return;
        // Skip header rows
        if (tr.closest('thead')) return;

        const iconTd = document.createElement('td');
        iconTd.className = 'row-action-icons';

        // ▶ Replay button — row click already copies to replay bar,
        //   this button lets the user replay immediately without a second click.
        const replayBtn = document.createElement('button');
        replayBtn.className   = 'row-icon-btn row-icon-replay';
        replayBtn.textContent = '▶';
        replayBtn.title       = 'Replay this test trace';
        replayBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const trace = _getTraceFromRow(tr);
            const str   = _traceToReplayString(trace);
            if (!str) { console.warn('row icon: no trace found', tr._caseIndex, window._testResults); return; }
            window._replayTrace?.(str);
        });

        iconTd.appendChild(replayBtn);

        // Prepend to the row before whatever generate-traces.js put there
        tr.insertBefore(iconTd, tr.firstChild);
    }

    // ── Drawer collapse helper ────────────────────────────────────────────────
    // Mirrors the applyCollapsed() logic in generate-traces.js: slide the
    // drawer below the viewport so only the header strip sits above the toolbar.
    // Never hides rows — they stay in the DOM and are scrollable when expanded.
    function _collapseDrawer(drawer) {
        const header    = drawer.firstElementChild;
        const headerH   = header ? header.offsetHeight : 40;
        const toolbar   = document.getElementById('toolbar');
        const clearance = toolbar ? toolbar.offsetHeight : 0;
        const fullH     = drawer.scrollHeight;
        drawer.style.bottom     = (clearance + headerH - fullH) + 'px';
        drawer.style.height     = '';
        drawer.style.maxHeight  = '';
        _fitDiagramAboveDrawer(drawer);
    }

    // ── Drawer height cap + drag + portrait diagram resize ────────────────────
    function _setupDrawer(drawer) {
        // Default max-height.
        //
        // Mobile/portrait: cap so the drawer can't rise above #profile-toggle
        // (which sits near the bottom of the right pane in UI3).
        //
        // Desktop: the drawer is a free-floating position:fixed element sitting
        // over the diagram pane — not under the right pane. Use a generous
        // viewport-based cap (80vh) so the full result set is scrollable.
        function _applyHeightCap() {
            if (drawer.dataset.userResized) return;
            // Cap at 80% of viewport height on all viewports.
            // The toolbar clearance is handled by applyCollapsed() in generate-traces.js
            // (bottom positioning) — not by constraining maxHeight here.
            drawer.style.maxHeight = Math.max(80, window.innerHeight * 0.80) + 'px';
        }
        _applyHeightCap();

        // Touch drag on drawer header: vertical resize only (portrait) or free (landscape)
        const header = drawer.firstElementChild;
        if (header) {
            let _sx, _sy, _sh, _st;
            header.addEventListener('touchstart', (e) => {
                if (e.target.closest('button')) return;
                const r = drawer.getBoundingClientRect();
                _sx = e.touches[0].clientX;
                _sy = e.touches[0].clientY;
                _sh = r.height;
                _st = r.top;
                drawer.style.transition = 'none';
            }, { passive: true });

            header.addEventListener('touchmove', (e) => {
                const dy = _sy - e.touches[0].clientY; // drag up = positive
                if (Math.abs(dy) < 4) return;
                drawer.dataset.userResized = '1';

                if (isPortrait()) {
                    // Portrait: resize height by dragging up/down, keep bottom fixed
                    const newH = Math.max(header.offsetHeight,
                                 Math.min(window.innerHeight - 60, _sh + dy));
                    drawer.style.height    = newH + 'px';
                    drawer.style.maxHeight = newH + 'px';
                    _fitDiagramAboveDrawer(drawer);
                } else {
                    // Landscape/desktop: free drag (original behaviour)
                    const dx = e.touches[0].clientX - _sx;
                    const newTop  = Math.max(0, Math.min(window.innerHeight - drawer.offsetHeight, _st + (e.touches[0].clientY - _sy)));
                    const newLeft = Math.max(0, Math.min(window.innerWidth  - drawer.offsetWidth,  drawer.getBoundingClientRect().left + dx));
                    drawer.style.top    = newTop  + 'px';
                    drawer.style.left   = newLeft + 'px';
                    drawer.style.right  = 'auto';
                    drawer.style.bottom = 'auto';
                }
            }, { passive: true });

            header.addEventListener('touchend', () => {
                drawer.style.transition = '';
            }, { passive: true });
        }

        // Initial portrait diagram fit
        _fitDiagramAboveDrawer(drawer);

        // Inject row action icons
        _injectRowIcons(drawer);

        // Re-fit on window resize
        const _onResize = () => {
            _applyHeightCap();
            _fitDiagramAboveDrawer(drawer);
        };
        window.addEventListener('resize', _onResize);
        drawer._removeResizeListener = () =>
            window.removeEventListener('resize', _onResize);
    }

    // ── Drawer lifecycle (called by index.html's inline observer) ────────────

    function _setToolbarDrawerClearance(drawer) {
        // Lift the toolbar by the drawer's header height so buttons are never
        // hidden behind the collapsed drawer strip.  The header is always the
        // first child of the drawer; fall back to 36px (desktop HEADER_H).
        const toolbar = document.getElementById('toolbar');
        if (!toolbar) return;
        const header  = drawer?.firstElementChild;
        const headerH = header ? header.offsetHeight || 36 : 36;
        toolbar.style.paddingBottom = headerH + 'px';
    }

    function _clearToolbarDrawerClearance() {
        const toolbar = document.getElementById('toolbar');
        if (toolbar) toolbar.style.paddingBottom = '';
    }

    window._onDrawerAdded = (drawer) => {
        _setupDrawer(drawer);
        // Wait one rAF so the drawer is painted and offsetHeight is real
        requestAnimationFrame(() => _setToolbarDrawerClearance(drawer));
    };

    window._onDrawerRemoved = () => {
        // Reset toolbar padding and diagram pane height when drawer is gone
        _clearToolbarDrawerClearance();
        const dp = document.getElementById('diagram-pane');
        if (dp) dp.style.maxHeight = '';
    };
}

// ── Visual viewport / soft keyboard handling ─────────────────────────────────
// On mobile, when the soft keyboard appears the visual viewport shrinks but
// the layout viewport (window.innerHeight) stays the same. position:fixed
// elements get pushed partly behind the keyboard. We detect this via
// visualViewport.resize and translate #right-pane upward by the difference
// so the drawer title bar and toolbar are always visible above the keyboard.
if (window.visualViewport) {
    const _vvListener = () => {
        const pane = document.getElementById('right-pane');
        if (!pane) return;
        const keyboardH = window.innerHeight - window.visualViewport.height;
        if (keyboardH > 50) {
            // Keyboard is open — shift pane up to stay in view
            pane.style.transform = `translateX(${pane._panOffset || 0}px) translateY(-${keyboardH}px)`;
        } else {
            // Keyboard closed — restore horizontal-only transform
            const offset = pane._panOffset || 0;
            pane.style.transform = offset ? `translateX(${offset}px)` : '';
        }
    };
    window.visualViewport.addEventListener('resize', _vvListener);
    window.visualViewport.addEventListener('scroll', _vvListener);
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

    const config   = window._config;
    const services = window._loadedServicesSource;
    if (!config)   { console.warn('⚠️  No flow loaded — Pack Prod requires a loaded flow'); return; }
    if (!services) { console.warn('⚠️  No services loaded — Pack Prod requires a services file'); return; }

    const version  = window._appVersion ?? 'unknown';
    const flowId   = config?.id ?? 'chatbot';
    const packedAt = new Date().toISOString();
    const machineFile  = `${flowId}-machine.json`;
    const servicesFile = `${flowId}-services.js`;

    console.log('📦 Fetching production files…');
    const [runtime, chatui, chatcss, logger_, versionjs] =
        await Promise.all([
            fetchText('Runtime.js'),
            fetchText('ChatUI.js'),
            fetchText('chat-theme.css'),
            fetchText('logger.js'),
            fetchText('version.js'),
        ]);

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
  </script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }

    html, body {
      margin: 0; padding: 0;
      height: 100%; overflow: hidden;
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #f4f7f6;
    }

    #app {
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      background: #f4f7f6;
    }

    #chat-card {
      width: 100%;
      max-width: 560px;
      height: 100%;
      display: flex;
      flex-direction: column;
      background: #ffffff;
      box-shadow: 0 0 24px rgba(0,0,0,0.08);
    }

    #chat-header {
      flex-shrink: 0;
      padding: 12px 16px 10px;
      background: #1c1e21;
      display: flex;
      align-items: baseline;
      gap: 8px;
    }

    #chat-title {
      font-family: 'Courier New', monospace;
      font-size: 14px;
      font-weight: bold;
      color: #61dafb;
      letter-spacing: 0.05em;
    }

    #chat-version {
      font-family: 'Courier New', monospace;
      font-size: 11px;
      font-weight: bold;
      color: #fff;
      background: #0051cc;
      border: 1px solid #3a8fff;
      border-radius: 4px;
      padding: 1px 6px;
    }

    #chat-mount {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
    }
  </style>
</head>
<body>
  <div id="app">
    <div id="chat-card">
      <div id="chat-header">
        <span id="chat-title">${flowId}</span>
        <span id="chat-version">${version}</span>
      </div>
      <div id="chat-mount"></div>
    </div>
  </div>
  <script type="module">
    import { Runtime }    from './Runtime.js';
    import { ChatUI }     from './ChatUI.js';
    import { nullLogger } from './logger.js';

    const [res, svcMod] = await Promise.all([
        fetch('./${machineFile}'),
        import('./${servicesFile}'),
    ]);
    const config   = await res.json();
    const services = svcMod.default ?? svcMod[Object.keys(svcMod).find(k => k !== 'default')] ?? svcMod;
    const rt       = new Runtime(config, services, nullLogger);
    const ui       = new ChatUI(rt, document.getElementById('chat-mount'));
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
        `  ${machineFile}   (in-memory config at pack time)`,
        `  ${servicesFile}`,
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
        [machineFile]:             strToU8(JSON.stringify(config, null, 2)),
        [servicesFile]:            strToU8(services),
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
    console.log(`   Files: 10 | Flow: ${flowId} | Version: ${version}`);
};
