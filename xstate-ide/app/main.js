import { Runtime }          from './Runtime.js';
import { ChatUI }            from './ChatUI.js';
import { mountToolbar }      from './ToolbarUI.js';
import { mountPaneUI }       from './PaneUI.js';
import { mountDiagramPane }  from './DiagramUI.js';

// Tracks the currently active services — starts empty until the user loads a flow.
// Replaced by reloadServices() whenever a .js file is loaded dynamically.
let activeServices = {};
import { loadVersion }       from './version.js';
import { consoleLogger }     from './logger.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { buildShareUrl, loadFromHash } from './share.js';
import { CANONICAL_BASE_URL }          from './config.js';

const BASE = new URL('.', import.meta.url).href;
const fetchLocal = (file) => fetch(BASE + file);

// ── Toast notifications ────────────────────────────────────────────────────────

function showToast(message, type = 'error') {
    const bg = type === 'warn' ? '#b45309' : type === 'info' ? '#1a7a3f' : '#c0392b';
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

// ── FSA availability banner ────────────────────────────────────────────────────
// Shown on load when the File System Access API is unavailable (Firefox, Safari).
// Stays pinned until the user dismisses it.

function _showFSAWarningBanner() {
    const banner = document.createElement('div');
    banner.id = 'fsa-warning-banner';
    banner.style.cssText = `
        position:fixed; top:0; left:0; right:0;
        background:#78350f; color:#fef3c7;
        font-family:'Segoe UI',sans-serif; font-size:13px; line-height:1.6;
        padding:10px 48px 10px 16px;
        box-shadow:0 2px 8px rgba(0,0,0,0.4);
        z-index:9998;
    `;
    banner.innerHTML = `
        <strong>⚠ Limited save support in this browser.</strong>
        Use <strong>Chrome</strong> or <strong>Edge</strong> for full File System Access API support.<br>
        <span style="opacity:0.85">On this browser: files download to your <em>Downloads</em> folder with an auto-generated name,
        and the app cannot detect if you cancel a save.</span>
        <button id="fsa-banner-dismiss" style="
            position:absolute; top:50%; right:12px; transform:translateY(-50%);
            background:transparent; border:1px solid #fef3c7; color:#fef3c7;
            border-radius:4px; padding:2px 8px; cursor:pointer; font-size:12px;
        ">Dismiss</button>
    `;
    document.body.appendChild(banner);
    document.getElementById('fsa-banner-dismiss').onclick = () => banner.remove();
}

console.log('📁 Base URL:', BASE);

async function boot() {
    console.log('🎬 Boot started');
    console.log('📦 App:', document.title, '| Built:', new Date().toISOString().slice(0,10));

    // ── Diagram pane — mount first so #mermaid-container exists for blank-slate ─
    const diagramMount = document.getElementById('diagram-mount');
    if (diagramMount) mountDiagramPane(diagramMount);

    // ── FSA availability check ────────────────────────────────────────────────
    if (!('showSaveFilePicker' in window)) _showFSAWarningBanner();

    // ── Version ───────────────────────────────────────────────────────────────
    const version = await loadVersion(BASE);
    if (version) {
        window._appVersion = version;
        console.log('🏷️  Version:', version, '| URL:', window.location.href);
    }

    // ── Config — starts null until a flow is explicitly loaded ────────────────
    // No auto-fetch of realtor-machine.json. The user must load a flow via
    // "Load Flow" or "Load Results" before the IDE becomes interactive.
    let config = null;

    // ── smide-machine — source of truth for toolbar button state ─────────────
    // Each state declares meta.toolbar: an array of enabled button IDs.
    const smideMachine = await fetch(BASE + 'test/smide-machine.json').then(r => r.json());
    const ALL_TOOLBAR_BTNS = ['test-btn', 'restart-btn', 'save-results-btn', 'save-flow-btn', 'load-btn', 'pack-prod-btn', 'share-btn'];
    let _updateToolbar = null;
    let _updatePane    = null;
    let smideRuntime   = null;

    // ── Pre-load generate-traces.js so its exports are ready when needed ──────
    const tracesModule = await import('./generate-traces.js');
    window._showResultsDrawer  = tracesModule.showResultsDrawer;
    window.generateTraces      = () => config ? tracesModule.generateTraces(config) : [];
    window.downloadTestResults = tracesModule.downloadTestResults;
    window.stopAllTraces       = tracesModule.stopAllTraces;
    window.skipCurrentTrace    = tracesModule.skipCurrentTrace;
    window.runAllTraces        = (pauseMs) => {
        if (!config) {
            console.warn('⚠️  No flow loaded — use Load Flow first');
            return Promise.resolve();
        }
        return tracesModule.runAllTracesHeadless(config, activeServices, { pauseMs, servicesSource: window._loadedServicesSource, priorResults: window._testResults });
    };
    window.loadTestResults       = (file) => tracesModule.loadTestResults(file);
    window._loadResultsFromCache = tracesModule.loadResultsFromCache;
    window._clearResultsCache    = tracesModule.clearResultsCache;
    window.drawerReset = tracesModule.drawerReset;
    window.drawerDump  = () => {
        const drawer  = document.getElementById('test-results-drawer');
        const rp      = document.getElementById('right-pane');
        const diagram = document.getElementById('diagram-pane');
        const get = (el) => el ? {
            rect:    el.getBoundingClientRect(),
            inline:  el.getAttribute('style') ?? '',
            computed: {
                position:  getComputedStyle(el).position,
                bottom:    getComputedStyle(el).bottom,
                top:       getComputedStyle(el).top,
                left:      getComputedStyle(el).left,
                right:     getComputedStyle(el).right,
                width:     getComputedStyle(el).width,
                height:    getComputedStyle(el).height,
                overflow:  getComputedStyle(el).overflow,
                transform: getComputedStyle(el).transform,
                display:   getComputedStyle(el).display,
                zIndex:    getComputedStyle(el).zIndex,
            },
        } : null;
        const dump = {
            viewport:      { w: window.innerWidth, h: window.innerHeight },
            bodyClasses:   document.body.className,
            drawer:        get(drawer),
            rightPane:     get(rp),
            diagramPane:   get(diagram),
        };
        console.log('🔍 drawerDump:', JSON.stringify(dump, null, 2));
        return dump;
    };

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
                    💡 Select <code style="color:#61dafb;">*-machine.json</code> alone, or together with<br>
                    <code style="color:#61dafb;">*-services.js</code> if the flow uses guards or async services.
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

        _updatePane?.({ profileText: '(no flow loaded)', stateId: '—' });
    }

    // ── Session persistence ───────────────────────────────────────────────────
    const PERSIST_KEY = 'xstate-ide:flow';
    const PREFS_KEY   = 'xstate-ide:uiPrefs';

    function _persistFlow(machineJson, servicesSource, ctxOverrides) {
        try {
            localStorage.setItem(PERSIST_KEY, JSON.stringify({ machineJson, servicesSource, ctxOverrides: ctxOverrides ?? null }));
        } catch (e) {
            console.warn('⚠️  Could not persist flow to localStorage:', e.message);
        }
    }

    function _clearPersistedFlow() {
        try { localStorage.removeItem(PERSIST_KEY); } catch (_) {}
        window._clearResultsCache?.();
    }

    function _loadPersistedFlow() {
        try {
            const raw = localStorage.getItem(PERSIST_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    }

    function _loadUIPrefs() {
        try {
            const raw = localStorage.getItem(PREFS_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (_) { return {}; }
    }

    function _persistUIPrefs(patch) {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify({ ..._loadUIPrefs(), ...patch }));
        } catch (e) {
            console.warn('⚠️  Could not persist UI prefs:', e.message);
        }
    }
    window._persistUIPrefs = _persistUIPrefs;

    function _applyUIPrefs() {
        const prefs = _loadUIPrefs();
        _updatePane?.({
            profileOpen:  !!prefs.profileOpen,
            observerOpen: !!prefs.observerOpen,
        });
        window._applyPaneOffset?.(prefs.paneOffset ?? 0);
    }

    // ── Narrow-pane input layout ──────────────────────────────────────────────
    // pane-narrow is toggled by _applyOffset in index.html whenever _panOffset > 0.
    // No ResizeObserver needed — the slide offset is the canonical signal.

    // ── Preact pane UI mount (titlebar + profile section + observer + replay bar) ─
    const titlebarMount  = document.getElementById('titlebar-mount');
    const profileMount   = document.getElementById('profile-mount');
    const observerMount  = document.getElementById('observer-mount');
    const replayMount    = document.getElementById('replay-mount');
    if (titlebarMount || profileMount || observerMount || replayMount) {
        const { update, toggle, toggleObserver } = mountPaneUI(
            { titlebar: titlebarMount, profile: profileMount, observer: observerMount, replay: replayMount },
            {
                version:     version || '—',
                profileText: '(no flow loaded)',
                stateId:     '—',
                getCtxEditValue: () => {
                    if (!config?.context) return '{}';
                    const { _trace, trace, ...editable } = { ...config.context, ...(contextOverrides ?? {}) };
                    return JSON.stringify(editable, null, 2);
                },
                onApplyCtx: (parsed) => {
                    contextOverrides = parsed;
                    _persistFlow(config, window._loadedServicesSource ?? null, contextOverrides);
                    smideRuntime?.send('RESTART');
                    window._restartRuntime();
                },
                onReplay: (str) => { if (str) window._replayTrace(str, window._activeReplayConfig); },
            }
        );
        _updatePane = update;
        window.toggleProfile = () => {
            toggle();
            requestAnimationFrame(() =>
                _persistUIPrefs({ profileOpen: !!document.getElementById('profile-viewer')?.classList.contains('open') })
            );
        };
        window.toggleObserver = () => {
            toggleObserver();
            requestAnimationFrame(() =>
                _persistUIPrefs({ observerOpen: !!document.getElementById('observer-viewer')?.classList.contains('open') })
            );
        };
        _applyUIPrefs();
        window._resetPanePrefs = () => {
            _updatePane({ profileOpen: false, observerOpen: false });
            window._applyPaneOffset?.(0);
        };
        window._showReplayBar   = (str) => _updatePane({ replayVisible: true,  replayValue: str ?? '' });
        window._clearReplayBar  = ()    => _updatePane({ replayVisible: false, replayValue: '' });
        window._restoreStateView = ({ profileText, stateId }) => _updatePane({ profileText, stateId });
    }

    // ── Preact toolbar mount ──────────────────────────────────────────────────
    const toolbarMount = document.getElementById('toolbar-mount');
    if (toolbarMount) {
        _updateToolbar = mountToolbar(toolbarMount, {
            onTest: () => {
                if (_testRunning) {
                    window.stopAllTraces?.();
                } else {
                    if (!config || !window.currentRuntime) {
                        console.warn('⚠️  No flow loaded — use Load Flow first');
                        return;
                    }
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
            },
            onRestart:       () => { smideRuntime?.send('RESTART'); window._restartRuntime(); },
            onSaveResults:   () => { window.downloadTestResults?.().then(ok => { if (ok) smideRuntime?.send('SAVE_RESULTS'); }); },
            onSaveFlow:      () => window.downloadPair(),
            onSaveFlowFiles: () => window.downloadFlowFiles(),
            onLoad:          () => document.getElementById('upload').click(),
            onPackProd:    () => window.downloadProductionBundle(),
            onShare: () => {
                if (!config) return;
                const result = buildShareUrl(
                    CANONICAL_BASE_URL,
                    config,
                    window._loadedServicesSource || null,
                    window._testResults || null
                );
                _updateToolbar?.({ shareResult: result });
            },
            onShareClose: () => _updateToolbar?.({ shareResult: null }),
            onShareCopy:  (url) => {
                navigator.clipboard?.writeText(url).catch(() => {});
                _updateToolbar?.({ shareResult: null });
                showToast('Link copied!', 'info');
            },
        });
    }

    // ── smide Runtime — boots the machine, drives toolbar/pane via onSnapshot ──
    // _showRestorePrompt is called from onSnapshot when state is prompt_restore.
    // It reads persisted data to show the machine id and wires buttons to smide events.
    function _showRestorePrompt() {
        const p = _loadPersistedFlow();
        chatMount.innerHTML = `
            <div id="no-flow-placeholder" style="
                flex:1; display:flex; flex-direction:column;
                align-items:center; justify-content:center;
                gap:14px; padding:24px; text-align:center;
                color:#888; font-family:'Segoe UI',sans-serif;
            ">
                <div style="font-size:36px;">🔄</div>
                <div style="font-size:15px; font-weight:600; color:#555;">Restore last session?</div>
                <div style="font-size:13px; color:#888;">
                    <strong style="color:#61dafb;">${p?.machineJson?.id ?? 'unknown'}</strong>
                    ${p?.servicesSource ? '+ services' : '(no services)'}
                </div>
                <div style="display:flex; gap:10px;">
                    <button id="restore-btn" style="
                        background:#0084ff; color:#fff; border:none;
                        border-radius:8px; padding:9px 20px; font-size:13px;
                        cursor:pointer;
                    ">Restore</button>
                    <button id="fresh-btn" style="
                        background:#444; color:#ccc; border:none;
                        border-radius:8px; padding:9px 20px; font-size:13px;
                        cursor:pointer;
                    ">Start fresh</button>
                </div>
                <a href="./help.html" target="_blank" style="
                    font-size:12px; color:#61dafb; text-decoration:none; opacity:0.8;
                ">📖 Help &amp; examples</a>
            </div>`;
        const mc = document.getElementById('mermaid-container');
        if (mc) mc.innerHTML = `
            <div style="
                color:#666; font-family:'Segoe UI',sans-serif;
                font-size:13px; text-align:center; padding:24px;
            ">No flow loaded</div>`;
        document.getElementById('restore-btn').onclick = () => smideRuntime?.send('RESTORE');
        document.getElementById('fresh-btn').onclick  = () => { _clearPersistedFlow(); smideRuntime?.send('START_FRESH'); };
    }

    {
        // Production services close over main.js variables — must be defined here
        // so they share the same contextOverrides, activeServices, and reloadServices.
        let _hashPayload       = null;
        let _hashPayloadLoaded = false;

        const smideProductionServices = {
            checkPersistedState: async () => {
                const p = _loadPersistedFlow();
                if (!p?.machineJson) return { hasFlow: false, hasResults: false, hasSession: false };
                const hasSession = !!(p.ctxOverrides && Object.keys(p.ctxOverrides).length > 0);
                const cached = await window._loadResultsFromCache?.();
                return { hasFlow: true, hasResults: !!cached, hasSession };
            },
            restorePersistedState: async () => {
                const p = _loadPersistedFlow();
                if (!p?.machineJson) throw new Error('No persisted flow found');
                if (p.servicesSource) {
                    await reloadServices(p.servicesSource, 'restored-services.js');
                } else {
                    activeServices = {};
                }
                contextOverrides = p.ctxOverrides ?? null;
                // _activateFlow does NOT send LOAD_FLOW here — the smide machine
                // routes to flow_idle/session_active/results_ready via onDone guards.
                _activateFlow(p.machineJson, /* keepOverrides */ true);
                const hasSession = !!(p.ctxOverrides && Object.keys(p.ctxOverrides).length > 0);
                const cached = await window._loadResultsFromCache?.();
                if (cached) {
                    window._testResults = cached;
                    window._showResultsDrawer?.(cached, window._replayTrace);
                }
                return { hasResults: !!cached, hasSession };
            },
            guards: {
                hasPersistedFlow:    ({ event }) => event.output?.hasFlow    === true,
                hasPersistedResults: ({ event }) => event.output?.hasResults === true,
                hasPersistedSession: ({ event }) => event.output?.hasSession === true,
            },
        };

        smideRuntime = new Runtime(smideMachine, smideProductionServices, undefined, { headless: true });

        // ── Observer state — narrates smide-machine transitions in IDE LOG ──────
        let _obsPrevStateId      = null;
        let _obsMessages         = [];
        let _pendingSmideEvent   = null;   // set before each send(), cleared in onSnapshot

        // Wrap send() so we know which user event triggered each snapshot.
        // XState5's subscribe snapshot does not expose .event, so we capture it here.
        const _origSmideSend = smideRuntime.send.bind(smideRuntime);
        smideRuntime.send = (type) => { _pendingSmideEvent = type; _origSmideSend(type); };

        smideRuntime.onSnapshot = (snap) => {
            const { stateId } = snap;
            const meta    = smideMachine.states[stateId]?.meta ?? {};
            const toolbar = meta.toolbar ?? [];
            const enabledBtns = ALL_TOOLBAR_BTNS.filter(id => toolbar.includes(id));
            _updateToolbar?.({ enabledBtns });

            const hasFlow = !['no_flow', 'booting', 'prompt_restore', 'restoring_flow', 'load_error', 'render_ui'].includes(stateId);
            _updatePane?.({ copyBtnEnabled: hasFlow });

            if (stateId !== _obsPrevStateId) {
                if (stateId === 'no_flow' || stateId === 'load_error') {
                    _showBlankSlate();
                } else if (stateId === 'prompt_restore') {
                    _showRestorePrompt();
                }
            }

            // ── Load from hash payload when machine reaches no_flow ───────────
            if (stateId === 'no_flow' && _hashPayload && !_hashPayloadLoaded) {
                _hashPayloadLoaded = true;
                const p = _hashPayload;
                _hashPayload = null;
                (async () => {
                    if (p.services) {
                        await reloadServices(p.services, `${p.machine?.id || 'flow'}-services.js`);
                    } else {
                        activeServices = {};
                    }
                    if (p.results) {
                        window._testResults = p.results;
                        if (p.results.config) window._setActiveConfig(p.results.config);
                        _activateFlow(p.results.config || p.machine);
                        window._showResultsDrawer?.(p.results, window._replayTrace);
                        smideRuntime.send('LOAD_RESULTS');
                    } else {
                        _activateFlow(p.machine);
                        smideRuntime.send('LOAD_FLOW');
                    }
                    if (p.ui?.diagramDir) window.setDiagramDir?.(p.ui.diagramDir);
                })();
            }

            // ── IDE LOG observer messages ─────────────────────────────────────
            {
                const pendingEvent = _pendingSmideEvent;
                _pendingSmideEvent = null;   // consume immediately

                const prevStateDef = _obsPrevStateId ? smideMachine.states[_obsPrevStateId] : null;
                const prevMeta     = prevStateDef?.meta ?? null;
                const stateChng    = stateId !== _obsPrevStateId;
                const isInitial    = !_obsPrevStateId;

                // onDone/onError: no pending user event, prev state had invoke, state changed
                const isInvokeEnd  = !pendingEvent && !!prevStateDef?.invoke && stateChng;
                const isOnError    = isInvokeEnd && stateId === 'load_error';
                const isOnDone     = isInvokeEnd && !isOnError;

                const msgs = [];

                if (isOnDone) {
                    msgs.push({ type: 'system', text: prevMeta?.onDone || '✓ done' });
                } else if (isOnError) {
                    msgs.push({ type: 'system', text: prevMeta?.onError || '✗ error' });
                } else if (pendingEvent && !isInitial) {
                    msgs.push({ type: 'user', text: pendingEvent });
                }

                if (stateChng) {
                    const botText = meta.chat || meta.text;
                    if (botText) msgs.push({ type: 'bot', text: botText });
                }

                if (msgs.length) {
                    _obsMessages = [..._obsMessages, ...msgs];
                    _updatePane?.({ observerMessages: _obsMessages });
                }

                _obsPrevStateId = stateId;
            }

            window._smideState = stateId;
            console.log('🗂️  smide state:', stateId, '| toolbar:', toolbar.join(', ') || '(none)');
        };

        // ── Hash payload detection — load from #flow= URL if present ─────────
        _hashPayload = loadFromHash();
        if (_hashPayload) {
            // Clear persisted session so smide boots to no_flow
            try { localStorage.removeItem(PERSIST_KEY); } catch (_) {}
            // Remove hash from URL to prevent reload loops
            history.replaceState(null, '', window.location.pathname + window.location.search);
            console.log('🔗 Hash payload detected — will load after boot');
        }

        smideRuntime.start();
    }

    // ── IDE rendering ─────────────────────────────────────────────────────────
    function renderIDE(snap) {
        if (!config) return;
        const { stateId, context } = snap;

        if (_lastStateId && _lastStateId !== stateId && context.trace?.length) {
            const lastEvent = context.trace[context.trace.length - 1];
            visitedEdges.add(`${_lastStateId}|${lastEvent}`);
        }
        _lastStateId = stateId;

        const { _trace, ...rest } = context;
        const traceRows = (_trace?.steps ?? []).map((s, i) => {
            if (s.service)         return `  [${i}] ⚙️  ${s.service} ok=${s.ok} (${s.ms}ms)`;
            if (s.valid === false)  return `  [${i}] ❌ ${s.stateId} "${s.value}" (${s.ms}ms)`;
            return                        `  [${i}] ✅ ${s.stateId} "${s.value}" (${s.ms}ms)`;
        }).join('\n');
        const traceHeader = _trace
            ? `_trace: session=${_trace.sessionId?.slice(0,8)}… flow=${_trace.flowId}@${_trace.flowVersion}\n${traceRows || '  (no steps yet)'}`
            : '_trace: null';
        const profileText = traceHeader + '\n\n' + JSON.stringify(rest, null, 2);
        _updatePane?.({ profileText, stateId });

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
    let contextOverrides = null;  // user-supplied initial context overrides; reset on new flow load

    // Exposed for _restoreCase in generate-traces.js — replaces direct innerHTML mutation
    window._setChatMessages = (msgs) => chatUI?._update({ messages: msgs ?? [] });

    function _activateFlow(newConfig, keepOverrides = false) {
        // Accept a fresh config object (not necessarily the same reference)
        if (!newConfig) return;

        // Reset context overrides whenever a genuinely new flow is loaded.
        if (!keepOverrides) contextOverrides = null;

        // Replace module-level config in-place so all closures over `config` see it
        config = newConfig;
        window._config = config;

        // Tear down old runtime if present
        if (window.currentRuntime) {
            try { window.currentRuntime.actor?.stop(); } catch (_) {}
        }

        visitedEdges.clear();
        _lastStateId = null;
        window._activeReplayConfig = null;   // cleared on new flow; _restoreCase sets per-case

        // Create the new runtime before wiring the chat area to it.
        window.currentRuntime = new Runtime(config, activeServices, consoleLogger);
        window.currentRuntime.contextOverrides = contextOverrides ?? {};

        // Wire the chat area to the new runtime.
        // reset() reuses the live Preact tree — avoids render(null,...) which wipes
        // Preact hook state and causes __H errors on the next render.
        // For the first load, clear the static blank-slate placeholder instead.
        if (chatUI) {
            chatUI.reset(window.currentRuntime);
        } else {
            chatMount.innerHTML = '';
            chatUI = new ChatUI(window.currentRuntime, chatMount, {
                onUserInput: () => smideRuntime?.send('CHAT_INPUT'),
            });
            chatUI.mount();
        }

        // Wire IDE rendering on top of ChatUI's snapshot handler
        const baseSnapshot = window.currentRuntime.onSnapshot;
        window.currentRuntime.onSnapshot = (snap) => {
            baseSnapshot(snap);
            renderIDE(snap);
        };

        window.currentRuntime.start();
        console.log('✅ Runtime started for flow:', config.id);

        // Persist flow so it can be restored on next page load
        _persistFlow(config, window._loadedServicesSource ?? null, contextOverrides);

        // Scroll-to-bottom observer on the messages element ChatUI created
        const _messagesEl = chatMount.querySelector('#messages');
        if (_messagesEl && window.ResizeObserver) {
            new ResizeObserver(() => {
                const d = _messagesEl.scrollHeight - _messagesEl.scrollTop - _messagesEl.clientHeight;
                if (d < 80) _messagesEl.scrollTop = _messagesEl.scrollHeight;
            }).observe(_messagesEl);
        }

    }

    // ── Restart ───────────────────────────────────────────────────────────────
    // With no arguments: restart the currently loaded flow to its initial state.
    // With a newConfig argument: load the new config and restart (used by
    // loadTestResults to restore the config that was active during the test run).
    // _isReplay: when true, suppress the LOAD_FLOW smide send so a preceding
    // REPLAY event (sent by _replayTrace) is not clobbered by LOAD_FLOW.
    window._restartRuntime = (overrideConfig, _isReplay = false) => {
        if (overrideConfig && overrideConfig !== config) {
            // Config is changing — re-activate with the new config
            _activateFlow(overrideConfig);
            if (!_isReplay) smideRuntime?.send('LOAD_FLOW');
            return;  // _activateFlow calls start(), so we're done
        }
        if (!config || !window.currentRuntime) {
            console.warn('⚠️  No flow loaded — nothing to restart');
            return;
        }
        visitedEdges.clear();
        _lastStateId = null;
        chatUI?.clear();
        window.currentRuntime.contextOverrides = contextOverrides ?? {};
        window.currentRuntime.restart();
        // Replay bar intentionally NOT cleared — useful for comparison after restart.
    };

    // Replay: restart the runtime, then after one tick pass the trace string
    // to Runtime.replay(). delayMs > 0 gives smooth step-by-step UI for manual
    // replays; automated test runs pass 0 to stay fast.
    window._replayTrace = (traceString, overrideConfig, delayMs = 350) => {
        if (!traceString) return;
        smideRuntime?.send('REPLAY');
        window._restartRuntime(overrideConfig, /* _isReplay */ true);
        setTimeout(() => window.currentRuntime?.replay(traceString, { delayMs }), 50);
    };

    // ── Save / Load Flow ──────────────────────────────────────────────────────
    window.downloadPair = async () => {
        if (!config) { console.warn('⚠️  No flow loaded'); return; }
        const flowId      = config.id || 'flow';
        const machineStr  = strToU8(JSON.stringify(config, null, 2));
        const servicesStr = strToU8(window._loadedServicesSource || '// no services loaded');
        const zipped = zipSync({
            [`${flowId}-machine.json`]: machineStr,
            [`${flowId}-services.js`]:  servicesStr,
        });
        const blob = new Blob([zipped], { type: 'application/zip' });
        const filename = `${flowId}.zip`;

        if ('showSaveFilePicker' in window) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                console.log('💾 Saved flow ZIP via FSA:', filename);
            } catch (e) {
                if (e.name !== 'AbortError') { console.error('❌ Save failed:', e); showToast('Save failed: ' + e.message); }
                else { console.log('💾 Save cancelled'); }
            }
        } else {
            const a    = document.createElement('a');
            a.href     = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            console.log('💾 Saved flow ZIP (blob fallback):', filename);
        }
    };

    // ── Save flow as separate editable files ──────────────────────────────────
    // Shift+click on Save Flow. FSA: showDirectoryPicker → writes both files at once.
    // Fallback: two sequential blob downloads.
    window.downloadFlowFiles = async () => {
        if (!config) { console.warn('⚠️  No flow loaded'); return; }
        const flowId      = config.id || 'flow';
        const machineStr  = JSON.stringify(config, null, 2);
        const servicesStr = window._loadedServicesSource || '// no services loaded';

        if ('showDirectoryPicker' in window) {
            try {
                const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
                const mh  = await dir.getFileHandle(`${flowId}-machine.json`,  { create: true });
                const sh  = await dir.getFileHandle(`${flowId}-services.js`,   { create: true });
                const mw  = await mh.createWritable(); await mw.write(machineStr);  await mw.close();
                const sw  = await sh.createWritable(); await sw.write(servicesStr); await sw.close();
                console.log(`💾 Saved ${flowId}-machine.json + ${flowId}-services.js`);
            } catch (e) {
                if (e.name !== 'AbortError') { console.error('❌ Save failed:', e); showToast('Save failed: ' + e.message); }
            }
        } else {
            const dl = (content, name, type) => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([content], { type }));
                a.download = name; a.click();
            };
            dl(machineStr,  `${flowId}-machine.json`, 'application/json');
            dl(servicesStr, `${flowId}-services.js`,  'text/javascript');
            console.log(`💾 Saved ${flowId}-machine.json + ${flowId}-services.js (blob fallback)`);
        }
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

            // Results ZIP: contains results.json at root
            if (Object.keys(unzipped).includes('results.json')) {
                window.loadTestResults?.(zipFile);
                return;
            }

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
            if (jsonFile) {
                const text = await readText(jsonFile);
                try {
                    const parsed = JSON.parse(text);
                    // Results JSON detection: has cases array or both flowId + runAt
                    if (Array.isArray(parsed.cases) || (parsed.flowId !== undefined && parsed.runAt !== undefined)) {
                        window.loadTestResults?.(jsonFile);
                        return;
                    }
                    newConfig = parsed;
                    if (!jsFile) activeServices = {};   // machine-only load — reset services
                } catch (e) { const m = `Invalid machine JSON: ${e.message}`; console.error('❌', m); showToast(m); return; }
            }
            if (jsFile) await reloadServices(await readText(jsFile), jsFile.name);
        }

        if (newConfig) {
            window._clearResultsCache?.();
            window._testResults = null;
            document.getElementById('test-results-drawer')?.remove();
            _activateFlow(newConfig);
            smideRuntime?.send('LOAD_FLOW');
        } else if (config) {
            // Services-only reload — hot-patch and restart with existing config
            smideRuntime?.send('LOAD_SERVICES');
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
        window._clearResultsCache?.();
        window._testResults = null;
        document.getElementById('test-results-drawer')?.remove();
        _activateFlow(newConfig);
        smideRuntime?.send('LOAD_FLOW');
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
            const named = Object.keys(mod).find(k => k !== 'default');
            const newServices = mod.default ?? (named ? mod[named] : { ...mod });
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
        // Show replay bar and close the context panel so it's immediately visible
        _updatePane?.({ replayVisible: true, replayValue: str, profileOpen: false });
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Test button + results drawer management
    // ─────────────────────────────────────────────────────────────────────────
    //
    // Test button toggles: 🧪 Test (idle) ↔ ⏹ Stop (running).
    // Load Results button toggles: 📋 Load Results ↔ 💾 Save Results
    //   (flips to Save Results after a test run completes or is stopped,
    //    so the user can save before the results are lost to the next run).
    // ─────────────────────────────────────────────────────────────────────────

    let _testRunning = false;

    function _setTestRunning(running, hadResults) {
        _testRunning = running;
        _updateToolbar?.({ testRunning: running });
        if (running) {
            smideRuntime?.send('RUN_TESTS');
        } else {
            _updatePane?.({ testProgress: '' });
            smideRuntime?.send(hadResults ? 'TESTS_COMPLETE' : 'TESTS_STOP');
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
            if (!badge) return;
            _pinBadge(badge);
            const text = badge.querySelector('span')?.innerText ?? badge.innerText ?? '';
            if (text) _updatePane?.({ testProgress: text });
        }, 200);
    }

    function _stopProgressPolling() {
        clearInterval(_progressInterval);
        _progressInterval = null;
    }

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

        // Touch drag on drawer header: vertical resize only (horizontal fixed by _fitTodiagramPane)
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

                // Always resize vertically — horizontal position is managed by
                // _fitTodiagramPane (Option A: drawer stays within diagram area).
                const newH = Math.max(header.offsetHeight,
                             Math.min(window.innerHeight - 60, _sh + dy));
                drawer.style.height    = newH + 'px';
                drawer.style.maxHeight = newH + 'px';
                if (isPortrait()) _fitDiagramAboveDrawer(drawer);
            }, { passive: true });

            header.addEventListener('touchend', () => {
                drawer.style.transition = '';
                if (drawer.dataset.userResized && drawer.style.height) {
                    _persistUIPrefs({ drawerHeight: drawer.style.height });
                }
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
        // In landscape the drawer floats over the diagram pane, not the right
        // pane, so the toolbar needs no extra clearance.
        if (!isPortrait()) return;
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

    // Expose so generate-traces.js can call it after snap-collapse
    window._fitDiagramAboveDrawer = _fitDiagramAboveDrawer;
    // Expose for generate-traces.js and ui-contracts.js — maps legacy state IDs to smide events.
    // Only 'results_ready' is called externally today; others included for completeness.
    window._setSmideState = (stateId) => {
        const eventMap = {
            results_ready:   'LOAD_RESULTS',
            flow_idle:       'LOAD_FLOW',
            tests_running:   'RUN_TESTS',
            results_unsaved: 'TESTS_COMPLETE',
            results_saved:   'SAVE_RESULTS',
            load_error:      'LOAD_ERROR',
        };
        const event = eventMap[stateId];
        if (event) smideRuntime?.send(event);
        else console.warn('⚠️  _setSmideState: no event mapping for', stateId);
    };

    window._onDrawerAdded = (drawer) => {
        _setupDrawer(drawer);
        const savedH = _loadUIPrefs().drawerHeight;
        if (savedH) {
            drawer.style.height        = savedH;
            drawer.style.maxHeight     = savedH;
            drawer.dataset.userResized = '1';
        }
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
    console.groupCollapsed('%c🧪 Regression contracts — quick start', 'color:#61dafb; font-weight:bold;');
    console.log(
        `── UI Contracts (current viewport: ${W}×${H}) ──\n` +
        `For a stable fixed-size window:\n` +
        `  window.open(location.href, '_blank', 'width=1024,height=768')\n` +
        `then undock DevTools before measuring.\n\n` +
        `  await window.contracts.ui()            — check (or capture) at 1024×768\n` +
        `  await window.contracts.ui('capture')   — force capture baseline\n\n` +
        `── Runtime Contracts ──\n` +
        `  await window.contracts.runtime()           — check (or capture)\n` +
        `  await window.contracts.runtime('capture')  — force capture baseline\n\n` +
        `── Smide Contracts ──\n` +
        `  await window.contracts.smide()           — check (or capture)\n` +
        `  await window.contracts.smide('capture')  — force capture baseline\n\n` +
        `── Load Contracts ──\n` +
        `  await window.contracts.load()            — toolbar DOM + load routing + ZIP round-trip\n\n` +
        `Workflow: run ('capture') once → commit *-baseline.json → run () before/after every change.`
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
    // esm.sh's ?bundle is a thin proxy with bare `import "/pkg@ver/..."` statements
    // (root-relative) that only resolve on the esm.sh domain.  The sub-modules in
    // turn use relative `import "./..."` chains.  Fix: walk the full module graph
    // and store every file at its correct path in the ZIP so root-relative imports
    // resolve naturally when the bundle is served from any static-file root.
    const ESM_SH = 'https://esm.sh';
    const XSTATE_CDN = `${ESM_SH}/xstate@5?bundle`;
    const FFLATE_CDN = `${ESM_SH}/fflate@0.8.2?bundle`;

    async function fetchModuleTree(entryUrl, entryLocalName) {
        const files = {};
        const queue = [{ url: entryUrl, local: entryLocalName }];
        const seen  = new Set();
        while (queue.length) {
            const { url, local } = queue.shift();
            if (seen.has(url)) continue;
            seen.add(url);
            const r = await fetch(url);
            if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
            const finalUrl = r.url;   // resolved URL after any redirect
            files[local] = await r.text();
            // Parse import/export specifiers (handles bare `import "..."`,
            // `from "..."`, and minified `from"..."` without space).
            const re = /(?:from|import)\s*["']([^"']+)["']/g;
            let m;
            while ((m = re.exec(files[local])) !== null) {
                const spec = m[1];
                let childUrl, childLocal;
                if (spec.startsWith('/')) {
                    // Root-relative: "/xstate@5.30.0/es2022/actors.mjs"
                    childUrl   = ESM_SH + spec;
                    childLocal = spec.slice(1);   // strip leading /
                } else if (spec.startsWith('.')) {
                    // Relative: "./actors.mjs" or "../dist/foo.mjs"
                    childUrl   = new URL(spec, finalUrl).href;
                    childLocal = new URL(spec, finalUrl).pathname.slice(1);
                } else {
                    continue;   // bare specifier — handled by importmap
                }
                if (!seen.has(childUrl)) queue.push({ url: childUrl, local: childLocal });
            }
        }
        return files;   // { 'localPath': 'source text', ... }
    }

    const [runtime, chatui, chatcss, logger_, versionjs] =
        await Promise.all([
            fetchText('Runtime.js'),
            fetchText('ChatUI.js'),
            fetchText('chat-theme.css'),
            fetchText('logger.js'),
            fetchText('version.js'),
        ]);

    const PREACT_CDN      = `${ESM_SH}/preact@10.25.4?bundle`;
    const PREACT_HOOKS_CDN = `${ESM_SH}/preact@10.25.4/hooks?bundle&external=preact`;
    const HTM_PREACT_CDN  = `${ESM_SH}/htm@3.1.1/preact?bundle&external=preact`;

    console.log('📦 Fetching xstate + fflate + preact module trees (offline-capable)…');
    const [xstateFiles, fflateFiles, preactFiles, preactHooksFiles, htmPreactFiles] = await Promise.all([
        fetchModuleTree(XSTATE_CDN, 'xstate.js'),
        fetchModuleTree(FFLATE_CDN, 'fflate.js'),
        fetchModuleTree(PREACT_CDN, 'preact.js'),
        fetchModuleTree(PREACT_HOOKS_CDN, 'preact/hooks.js'),
        fetchModuleTree(HTM_PREACT_CDN, 'htm/preact.js'),
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
          "xstate":       "./xstate.js",
          "fflate":       "./fflate.js",
          "preact":       "./preact.js",
          "preact/hooks": "./preact/hooks.js",
          "htm/preact":   "./htm/preact.js"
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

    const xstateFileList    = Object.keys(xstateFiles).map(p => `  ${p}`).join('\n');
    const fflateFileList    = Object.keys(fflateFiles).map(p => `  ${p}`).join('\n');
    const preactFileList    = Object.keys(preactFiles).map(p => `  ${p}`).join('\n');
    const preactHooksList   = Object.keys(preactHooksFiles).map(p => `  ${p}`).join('\n');
    const htmPreactFileList = Object.keys(htmPreactFiles).map(p => `  ${p}`).join('\n');
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
        `  ${machineFile}`,
        `  ${servicesFile}`,
        `  logger.js`,
        `  version.js`,
        `  MANIFEST.txt           (this file)`,
        ``,
        `xstate module tree (${Object.keys(xstateFiles).length} files, from ${XSTATE_CDN}):`,
        xstateFileList,
        ``,
        `fflate module tree (${Object.keys(fflateFiles).length} files, from ${FFLATE_CDN}):`,
        fflateFileList,
        ``,
        `preact module tree (${Object.keys(preactFiles).length} files, from ${PREACT_CDN}):`,
        preactFileList,
        ``,
        `preact/hooks module tree (${Object.keys(preactHooksFiles).length} files, from ${PREACT_HOOKS_CDN}):`,
        preactHooksList,
        ``,
        `htm/preact module tree (${Object.keys(htmPreactFiles).length} files, from ${HTM_PREACT_CDN}):`,
        htmPreactFileList,
    ].join('\n');

    const { zipSync, strToU8 } = await import('fflate');
    const zipEntries = {
        'index.html':     strToU8(minimalHtml),
        'Runtime.js':     strToU8(runtime),
        'ChatUI.js':      strToU8(chatui),
        'chat-theme.css': strToU8(chatcss),
        [machineFile]:    strToU8(JSON.stringify(config, null, 2)),
        [servicesFile]:   strToU8(services),
        'logger.js':      strToU8(logger_),
        'version.js':     strToU8(versionjs),
        'MANIFEST.txt':   strToU8(manifest),
    };
    for (const [path, src] of Object.entries(xstateFiles))    zipEntries[path] = strToU8(src);
    for (const [path, src] of Object.entries(fflateFiles))    zipEntries[path] = strToU8(src);
    for (const [path, src] of Object.entries(preactFiles))    zipEntries[path] = strToU8(src);
    for (const [path, src] of Object.entries(preactHooksFiles)) zipEntries[path] = strToU8(src);
    for (const [path, src] of Object.entries(htmPreactFiles)) zipEntries[path] = strToU8(src);
    const zipped = zipSync(zipEntries);

    const blob = new Blob([zipped], { type: 'application/zip' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `${flowId}-prod-${packedAt.slice(0,10)}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);

    const totalFiles = Object.keys(zipEntries).length;
    console.log(`✅ Production bundle downloaded: ${a.download}`);
    console.log(`   Files: ${totalFiles} | Flow: ${flowId} | Version: ${version} | Offline-ready`);
};
