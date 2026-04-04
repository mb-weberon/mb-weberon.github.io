import { html } from 'htm/preact';
import { render } from 'preact';
import { useState } from 'preact/hooks';

/**
 * ToolbarUI.js — Preact component for the IDE toolbar.
 *
 * Replaces the static #toolbar HTML and the imperative DOM mutations that
 * _setSmideState / _setTestRunning used to perform. All visual state is
 * driven by props; callers update via the function returned by mountToolbar().
 *
 * Usage:
 *   const updateToolbar = mountToolbar(
 *     document.getElementById('toolbar-mount'),
 *     { onTest, onRestart, onSaveResults, onSaveFlow, onSaveFlowFiles, onLoad, onPackProd, onShare, onShareClose, onShareCopy }
 *   );
 *
 *   // Later, update any subset of state:
 *   updateToolbar({ enabledBtns: ['test-btn', 'restart-btn'] });
 *   updateToolbar({ testRunning: true });
 *   updateToolbar({ shareResult: { url, included } });   // show share popover
 *   updateToolbar({ shareResult: null });                 // hide share popover
 */

function SharePopover({ shareResult, onShareClose, onShareCopy, onShareLoad }) {
    if (!shareResult) return null;

    const [pasteVal, setPasteVal] = useState('');

    const style = {
        popover: `
            position:fixed; bottom:75px; right:8px; z-index:1000;
            background:#1e1e1e; border:1px solid #444; border-radius:8px;
            padding:12px 14px; min-width:260px; max-width:340px;
            box-shadow:0 4px 16px rgba(0,0,0,0.5);
            font-family:'Segoe UI',sans-serif; font-size:13px; color:#ccc;
        `,
        title:   `font-weight:600; color:#fff; margin-bottom:8px; font-size:13px;`,
        sub:     `color:#aaa; font-size:12px; margin-bottom:10px;`,
        url:     `
            background:#111; border:1px solid #333; border-radius:4px;
            padding:6px 8px; font-size:11px; font-family:'Courier New',monospace;
            color:#61dafb; word-break:break-all; margin-bottom:10px;
        `,
        divider: `border:none; border-top:1px solid #333; margin:10px 0;`,
        loadLabel: `color:#aaa; font-size:11px; margin-bottom:5px;`,
        loadRow: `display:flex; gap:6px; margin-bottom:4px;`,
        input:   `
            flex:1; background:#111; border:1px solid #444; border-radius:4px;
            padding:5px 8px; font-size:11px; font-family:'Courier New',monospace;
            color:#ccc; min-width:0;
        `,
        row:     `display:flex; gap:8px; justify-content:flex-end;`,
        btnCopy: `
            background:#0084ff; color:#fff; border:none; border-radius:6px;
            padding:6px 14px; font-size:12px; cursor:pointer;
        `,
        btnLoad: `
            background:#0084ff; color:#fff; border:none; border-radius:4px;
            padding:5px 10px; font-size:11px; cursor:pointer; white-space:nowrap;
        `,
        btnClose: `
            background:#333; color:#ccc; border:none; border-radius:6px;
            padding:6px 12px; font-size:12px; cursor:pointer;
        `,
    };

    const loadSection = html`
        <hr style=${style.divider}/>
        <div style=${style.loadLabel}>Load from shared link (any instance):</div>
        <div style=${style.loadRow}>
            <input style=${style.input}
                placeholder="Paste URL here…"
                value=${pasteVal}
                onInput=${e => setPasteVal(e.target.value)}
                onKeyDown=${e => { if (e.key === 'Enter' && pasteVal.trim()) { onShareLoad(pasteVal.trim()); setPasteVal(''); } }}
            />
            <button style=${style.btnLoad}
                disabled=${!pasteVal.trim()}
                onClick=${() => { onShareLoad(pasteVal.trim()); setPasteVal(''); }}>Load</button>
        </div>
    `;

    if (shareResult.tooLarge) {
        return html`
            <div style=${style.popover}>
                <div style=${style.title}>❌ Too large to share as URL</div>
                <div style=${style.sub}>
                    Share the files manually instead:<br/>
                    download the flow ZIP and/or test results JSON<br/>
                    and send them directly.
                </div>
                ${loadSection}
                <div style=${style.row}>
                    <button style=${style.btnClose} onClick=${onShareClose}>Close</button>
                </div>
            </div>
        `;
    }

    if (shareResult.noFlow) {
        return html`
            <div style=${style.popover}>
                <div style=${style.title}>🔗 Load from shared link</div>
                ${loadSection}
                <div style=${style.row}>
                    <button style=${style.btnClose} onClick=${onShareClose}>Close</button>
                </div>
            </div>
        `;
    }

    const { url, included } = shareResult;
    const summary = included.length === 3
        ? 'Full snapshot — machine, services & results'
        : included.length === 2
            ? 'Machine + services (results too large)'
            : 'Machine only (services too large)';
    const display = url.length > 64 ? url.slice(0, 61) + '…' : url;

    return html`
        <div style=${style.popover}>
            <div style=${style.title}>🔗 Share link ready</div>
            <div style=${style.sub}>${summary}</div>
            <div style=${style.url}>${display}</div>
            <div style=${style.row}>
                <button style=${style.btnCopy} onClick=${() => onShareCopy(url)}>Copy Link</button>
                <button style=${style.btnClose} onClick=${onShareClose}>✕</button>
            </div>
            ${loadSection}
        </div>
    `;
}

function Toolbar(props) {
    const {
        enabledBtns    = [],
        testRunning    = false,
        shareResult    = null,
        onTest, onRestart, onSaveResults, onSaveFlow, onSaveFlowFiles, onLoad, onAnalyze, onPackProd,
        onShare, onShareClose, onShareCopy, onShareLoad,
    } = props;

    const en = (id) => enabledBtns.includes(id);

    // Disabled buttons get reduced opacity and a not-allowed cursor.
    const st = (id, extra = {}) => ({
        opacity: en(id) ? '' : '0.4',
        cursor:  en(id) ? '' : 'not-allowed',
        ...extra,
    });

    return html`<div id="toolbar">

        <button id="test-btn"
            class=${testRunning ? 'test-btn-stop' : ''}
            disabled=${!en('test-btn')}
            style=${st('test-btn')}
            title=${testRunning
                ? 'Stop the running tests'
                : 'Auto-generate all paths and run as tests'}
            onClick=${onTest}>
            ${testRunning ? '⏹' : '🧪'}<br/>${testRunning ? 'Stop' : 'Test'}
        </button>

        <button id="restart-btn" class="restart-btn"
            disabled=${!en('restart-btn')}
            style=${st('restart-btn')}
            title="Restart conversation"
            onClick=${onRestart}>🔄<br/>Restart</button>

        <button id="save-results-btn"
            disabled=${!en('save-results-btn')}
            style=${st('save-results-btn')}
            title="Save test results as ZIP"
            onClick=${onSaveResults}>💾<br/>Save<br/>Results</button>

        <button id="save-flow-btn"
            disabled=${!en('save-flow-btn')}
            style=${st('save-flow-btn', { display: en('save-flow-btn') ? '' : 'none' })}
            title="Save flow as ZIP (Shift+click: save machine.json + services.js separately)"
            onClick=${(e) => e.shiftKey ? onSaveFlowFiles() : onSaveFlow()}>💾<br/>Save<br/>Flow</button>

        <button id="load-btn"
            disabled=${!en('load-btn')}
            style=${st('load-btn')}
            title="Load flow (.zip, .json, .js) or test results (.zip, .json)"
            onClick=${onLoad}>📂<br/>Load</button>

        <button id="analyze-btn"
            disabled=${!en('analyze-btn')}
            style=${st('analyze-btn')}
            title="Static analysis — detect unreachable states, guard gaps, dead transitions"
            onClick=${onAnalyze}>🔍<br/>Analyze</button>

        <button id="pack-prod-btn"
            disabled=${!en('pack-prod-btn')}
            style=${st('pack-prod-btn')}
            title="Pack and download standalone production bundle (no IDE)"
            onClick=${onPackProd}>📦<br/>Pack<br/>Prod</button>

        <button id="share-btn"
            disabled=${!en('share-btn')}
            style=${st('share-btn')}
            title="Share flow as a compressed URL"
            onClick=${onShare}>🔗<br/>Share</button>

        <input type="file" id="upload" style="display:none"
            accept=".zip,.json,.js" multiple
            onChange=${(e) => { window.loadPair?.(e.target.files); e.target.value = ''; }}/>

        ${shareResult && html`<div style="position:fixed; inset:0; z-index:999;" onClick=${onShareClose}/>`}
        <${SharePopover} shareResult=${shareResult} onShareClose=${onShareClose} onShareCopy=${onShareCopy} onShareLoad=${onShareLoad}/>

    </div>`;
}

export function mountToolbar(container, initialCallbacks = {}) {
    // All mutable toolbar state lives here. Preact reads it on each render.
    const state = {
        enabledBtns:     [],
        testRunning:     false,
        shareResult:     null,
        onTest:          () => {},
        onRestart:       () => {},
        onSaveResults:   () => {},
        onSaveFlow:      () => {},
        onSaveFlowFiles: () => {},
        onLoad:          () => {},
        onAnalyze:       () => {},
        onPackProd:      () => {},
        onShare:         () => {},
        onShareClose:    () => {},
        onShareCopy:     () => {},
        onShareLoad:     () => {},
        ...initialCallbacks,
    };

    const rerender = () => render(html`<${Toolbar} ...${state}/>`, container);
    rerender();   // initial render — DOM elements exist synchronously after this

    // Returns an update function. Callers pass a partial state object;
    // only the supplied keys are updated, then the component re-renders.
    return (patch) => {
        Object.assign(state, patch);
        rerender();
    };
}
