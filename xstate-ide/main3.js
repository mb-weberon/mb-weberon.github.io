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

    // ── Start runtime + ChatUI ─────────────────────────────────────────────────
    console.log('🚀 Starting Runtime…');
    window.currentRuntime = new Runtime(config, realtorServices, consoleLogger);

    const chatMount = document.getElementById('chat-mount');
    const chatUI    = new ChatUI(window.currentRuntime, chatMount);
    chatUI.mount();

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

    // ─────────────────────────────────────────────────────────────────────────
    // Test button + results drawer management
    // ─────────────────────────────────────────────────────────────────────────
    //
    // Test button toggles between 🧪 Test (idle) and ⏹ Stop (running).
    //
    // Results drawer (#test-results-drawer) is created by generate-traces.js
    // and appended to document.body as position:fixed.  We:
    //   1. Cap its default height so it can't open above #profile-toggle.
    //   2. Let the user drag it taller (up to the top of the screen).
    //   3. Prepend two action icons to every result row:
    //        📋  — copy trace string into #replay-input and collapse drawer
    //        ▶   — replay the trace immediately
    //   4. On portrait mobile, shrink #diagram-pane to fit above the drawer.
    // ─────────────────────────────────────────────────────────────────────────

    const testBtn    = document.getElementById('test-btn');
    const progressEl = document.getElementById('test-progress');
    let _testRunning = false;

    function _setTestRunning(running) {
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
            if (!window.runAllTraces) {
                console.warn('⚠️  runAllTraces not ready yet');
                return;
            }
            _setTestRunning(true);
            _startProgressPolling();
            window.runAllTraces().finally(() => {
                _stopProgressPolling();
                _setTestRunning(false);
            });
        }
    });

    // ── Portrait mobile helpers ───────────────────────────────────────────────
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
                th.style.cssText = 'width:52px; padding:3px 4px;';
                headerRow.insertBefore(th, headerRow.firstChild);
            }
        }

        // ── 3. Slim the drawer: replace collapse btn with 💾, hide subHeader ───
        // Structure: drawer.children = [header, subHeader, tableWrap]
        const mainHeader = drawer.children[0];
        const subHeader  = drawer.children[1];
        const tableWrap  = drawer.children[2];

        if (mainHeader && subHeader && tableWrap) {
            // Replace the ▼ collapse button with 💾 (download)
            // collapseBtn is the second-to-last child of mainHeader (before ✕)
            const headerChildren = Array.from(mainHeader.children);
            const collapseBtn = headerChildren[headerChildren.length - 2];
            if (collapseBtn && (collapseBtn.textContent === '▼' || collapseBtn.textContent === '▲')) {
                collapseBtn.textContent = '💾';
                collapseBtn.title       = 'Download test results as JSON';
                collapseBtn.onclick = (e) => {
                    e.stopPropagation();
                    window.downloadTestResults?.();
                };
            }

            // Make clicking the header bar itself toggle collapse (desktop)
            // generate-traces wires this for mobile; add for desktop too.
            mainHeader.style.cursor = 'pointer';
            mainHeader.style.userSelect = 'none';
            let _drawerCollapsed = false;
            mainHeader.addEventListener('click', (e) => {
                if (e.target.tagName === 'BUTTON') return; // let buttons be
                _drawerCollapsed = !_drawerCollapsed;
                if (tableWrap) tableWrap.style.display = _drawerCollapsed ? 'none' : '';
                subHeader.style.display = _drawerCollapsed ? 'none' : '';
            });

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

        // 📋 Copy-to-replay button
        const copyBtn = document.createElement('button');
        copyBtn.className   = 'row-icon-btn row-icon-copy';
        copyBtn.textContent = '📋';
        copyBtn.title       = 'Copy trace to replay field';
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const trace = _getTraceFromRow(tr);
            const str   = _traceToReplayString(trace);
            if (!str) { console.warn('row icon: no trace found', tr._caseIndex, window._testResults); return; }
            const input = document.getElementById('replay-input');
            if (input) input.value = str;
            // Collapse the drawer
            const drawer = document.getElementById('test-results-drawer');
            if (drawer) _collapseDrawer(drawer);
        });

        // ▶ Replay button
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

        iconTd.appendChild(copyBtn);
        iconTd.appendChild(replayBtn);

        // Prepend to the row before whatever generate-traces.js put there
        tr.insertBefore(iconTd, tr.firstChild);
    }

    // ── Drawer collapse helper ────────────────────────────────────────────────
    function _collapseDrawer(drawer) {
        // generate-traces.js opens drawers by setting explicit height/maxHeight.
        // The simplest cross-compatible collapse is to give it a minimal height
        // matching just its header row (~40px), which the user can drag back up.
        const header = drawer.firstElementChild;
        const headerH = header ? header.offsetHeight : 40;
        drawer.style.height    = headerH + 'px';
        drawer.style.maxHeight = headerH + 'px';
        _fitDiagramAboveDrawer(drawer);
    }

    // ── Drawer height cap + drag + portrait diagram resize ────────────────────
    function _setupDrawer(drawer) {
        // Default max-height: top of drawer can't be above #profile-toggle.
        // The drawer is position:fixed so we measure profile-toggle's screen top.
        function _applyHeightCap() {
            const toggle = document.getElementById('profile-toggle');
            if (!toggle) return;
            const toggleTop  = toggle.getBoundingClientRect().top;
            const drawerBottom = parseInt(drawer.style.bottom) || 0;
            // max-height = distance from bottom of drawer to top of profile-toggle
            const maxH = window.innerHeight - drawerBottom - toggleTop;
            // Only apply cap if drawer hasn't been manually dragged taller already
            if (!drawer.dataset.userResized) {
                drawer.style.maxHeight = Math.max(80, maxH) + 'px';
            }
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

    // ── Drawer lifecycle (called by index3.html's inline observer) ────────────
    window._onDrawerAdded = (drawer) => {
        _setupDrawer(drawer);
    };

    window._onDrawerRemoved = () => {
        // Reset diagram pane height when drawer is gone
        const dp = document.getElementById('diagram-pane');
        if (dp) dp.style.maxHeight = '';
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
    console.log(`   Files: 10 | Flow: ${flowId} | Version: ${version}`);
};
