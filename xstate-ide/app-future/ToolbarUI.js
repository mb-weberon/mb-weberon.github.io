import { html } from 'htm/preact';
import { render } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';

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

/**
 * Build a SAMPLE_INPUTS skeleton from the machine config's text-input states.
 * Returns the full `SAMPLE_INPUTS: { ... },` block ready for injection.
 */
function _buildSampleInputsSkeleton(inputStates) {
    const lines = inputStates.map(({ id, placeholder }) => {
        const value = placeholder || 'sample value';
        return `    ${id}: '${value}',`;
    });
    return `  SAMPLE_INPUTS: {\n${lines.join('\n')}\n  },`;
}

/**
 * Inject a SAMPLE_INPUTS block into services source.
 * If one exists, replace it; otherwise insert after the export object's opening brace.
 */
function _injectBlock(source, block) {
    const keyMatch = /\bSAMPLE_INPUTS\s*:\s*\{/.exec(source);
    if (keyMatch) {
        const openBrace = source.indexOf('{', keyMatch.index);
        let depth = 0, closePos = -1;
        for (let i = openBrace; i < source.length; i++) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') { if (--depth === 0) { closePos = i; break; } }
        }
        if (closePos !== -1) {
            let lineStart = keyMatch.index;
            while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--;
            let tail = closePos + 1;
            if (source[tail] === ',') tail++;
            if (source[tail] === '\n') tail++;
            return source.slice(0, lineStart) + block + '\n' + source.slice(tail);
        }
    }
    return source.replace(
        /(\bexport\s+(?:default\s*\{|const\s+\w+\s*=\s*\{))/,
        `$1\n${block}\n`
    );
}

function SourceViewerModal({ onClose, getSourceData, onApplySource, getInputStates, initialTab }) {
    const [tab, setTab]         = useState(initialTab || 'machine');
    const [copied, setCopied]   = useState(false);
    const [error, setError]     = useState('');
    const [dirty, setDirty]     = useState(false);
    const [ready, setReady]     = useState(false);
    const [fNames, setFNames]   = useState({ machine: null, services: null, typescript: null });
    const [hintDismissed, setHintDismissed] = useState(false);

    const containerRef = useRef(null);
    const editorRef    = useRef(null);
    const modRef       = useRef(null);
    const handleRef    = useRef({ machine: null, services: null, typescript: null });
    const tabRef       = useRef(tab);
    tabRef.current     = tab;

    // Capture original data once at mount
    const origRef    = useRef(null);
    const contentRef = useRef(null);
    const metaRef    = useRef(null);
    if (!origRef.current) {
        const d = getSourceData?.() ?? {};
        origRef.current    = { machine: d.machine ?? '', services: d.services ?? '', typescript: d.typescript ?? '' };
        contentRef.current = { machine: d.machine ?? '', services: d.services ?? '', typescript: d.typescript ?? '' };
        metaRef.current    = { flowId: d.flowId ?? 'machine', tsLoaded: !!d.tsLoaded };
    }
    const { flowId, tsLoaded } = metaRef.current;

    // Mount CodeMirror lazily
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const mod = await import('./SourceEditor.js');
            if (cancelled || !containerRef.current) return;
            modRef.current = mod;
            const initTab = tabRef.current;
            const editor = mod.createSourceEditor(containerRef.current, {
                content:  contentRef.current[initTab],
                language: initTab === 'machine' ? 'json' : 'javascript',
                onChange: (text) => {
                    const t = tabRef.current;
                    contentRef.current[t] = text;
                    setDirty(text !== origRef.current[t]);
                },
            });
            editorRef.current = editor;
            setReady(true);
        })();
        return () => { cancelled = true; editorRef.current?.destroy(); };
    }, []);

    // ESC to close + collapse test results drawer while editor is open
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        const drawer = document.getElementById('test-results-drawer');
        if (drawer) drawer.style.display = 'none';
        return () => {
            window.removeEventListener('keydown', onKey);
            if (drawer) drawer.style.display = '';
        };
    }, []);

    const switchTab = (newTab) => {
        if (newTab === tab || !editorRef.current) return;
        contentRef.current[tab] = editorRef.current.getContent();
        tabRef.current = newTab;   // sync before setContent fires onChange
        setTab(newTab);
        setCopied(false);
        setError('');
        editorRef.current.setContent(contentRef.current[newTab]);
        editorRef.current.setLanguage(newTab === 'machine' ? 'json' : 'javascript');  // JS mode works for TS too
        setDirty(contentRef.current[newTab] !== origRef.current[newTab]);
    };

    const copy = () => {
        const text = editorRef.current?.getContent() ?? contentRef.current[tab];
        navigator.clipboard?.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const apply = () => {
        setError('');
        const text = editorRef.current?.getContent() ?? contentRef.current[tab];
        if (tab === 'machine') {
            let parsed;
            try { parsed = JSON.parse(text); }
            catch (e) { setError(`Invalid JSON: ${e.message}`); return; }
            if (!parsed.id || !parsed.states) { setError('Missing required fields: id, states'); return; }
            onApplySource?.('machine', parsed);
        } else if (tab === 'typescript') {
            if (!text.trim()) { setError('TypeScript source is empty'); return; }
            onApplySource?.('typescript', text);
        } else {
            if (!text.trim()) { setError('Services source is empty'); return; }
            onApplySource?.('services', text);
        }
        origRef.current[tab] = text;
        setDirty(false);
    };

    const openFile = async () => {
        try {
            const result = await modRef.current?.pickFile();
            if (!result) return;
            const targetTab = result.name.endsWith('.json') ? 'machine'
                : result.name.endsWith('.ts') ? 'typescript' : 'services';
            handleRef.current[targetTab] = result.handle;
            contentRef.current[targetTab] = result.text;
            setFNames(prev => ({ ...prev, [targetTab]: result.name }));
            if (targetTab !== tab) {
                switchTab(targetTab);
            } else {
                editorRef.current?.setContent(result.text);
                setDirty(result.text !== origRef.current[tab]);
            }
        } catch (e) {
            if (e.name !== 'AbortError') setError(e.message);
        }
    };

    const save = async () => {
        const text = editorRef.current?.getContent() ?? contentRef.current[tab];
        const handle = handleRef.current[tab];
        try {
            if (handle) {
                await modRef.current?.saveToHandle(handle, text);
            } else {
                const defaultName = tab === 'machine' ? `${flowId}-machine.json`
                    : tab === 'typescript' ? 'xstate-machine.ts' : `${flowId}-services.js`;
                const newHandle = await modRef.current?.saveFileAs(text, fNames[tab] || defaultName);
                if (newHandle) handleRef.current[tab] = newHandle;
            }
            setCopied(false);
        } catch (e) {
            if (e.name !== 'AbortError') setError(e.message);
        }
    };

    // ── SAMPLE_INPUTS hint for services tab ─────────────────────────────────
    const inputStates = getInputStates?.() ?? [];
    const servicesContent = () => editorRef.current?.getContent() ?? contentRef.current.services;
    const hasSampleInputs = () => /\bSAMPLE_INPUTS\s*:/.test(servicesContent());
    const showHint = tab === 'services' && ready && !hintDismissed
        && inputStates.length > 0 && !hasSampleInputs();

    const insertTemplate = () => {
        const block   = _buildSampleInputsSkeleton(inputStates);
        const current = servicesContent();
        const patched = _injectBlock(current, block);
        contentRef.current.services = patched;
        // Auto-apply and close — user just needs to re-click Test
        onApplySource?.('services', patched);
        origRef.current.services = patched;
        onClose();
    };

    const s = {
        overlay: `
            position:fixed; inset:0; z-index:1100;
            background:rgba(0,0,0,0.6);
            display:flex; align-items:center; justify-content:center;
        `,
        modal: `
            background:#1e1e1e; border:1px solid #444; border-radius:10px;
            width:90vw; height:85vh;
            display:flex; flex-direction:column;
            box-shadow:0 8px 32px rgba(0,0,0,0.7);
            font-family:'Segoe UI',sans-serif;
            resize:both; overflow:hidden;
            min-width:320px; min-height:200px;
        `,
        header: `
            display:flex; align-items:center; gap:6px; flex-wrap:wrap;
            padding:10px 14px; border-bottom:1px solid #333;
        `,
        tab: (active, derived) => `
            background:${active ? '#0084ff' : '#2a2a2a'};
            color:${active ? '#fff' : '#aaa'};
            border:1px solid ${active ? '#0084ff' : '#444'};
            border-radius:4px; padding:4px 12px; font-size:12px;
            cursor:pointer; font-family:'Segoe UI',sans-serif;
            ${derived ? 'font-style:italic; opacity:0.7;' : ''}
        `,
        derivedTag: `
            font-size:9px; color:#888; margin-left:2px;
            vertical-align:super;
        `,
        fileName: `font-size:11px; color:#888; margin-left:4px; font-style:italic;`,
        actions: `margin-left:auto; display:flex; gap:5px;`,
        btn: `
            background:#333; color:#ccc; border:1px solid #444;
            border-radius:4px; padding:4px 10px; font-size:11px;
            cursor:pointer; font-family:'Segoe UI',sans-serif;
        `,
        applyBtn: `
            background:#0084ff; color:#fff; border:1px solid #0084ff;
            border-radius:4px; padding:4px 10px; font-size:11px;
            cursor:pointer; font-family:'Segoe UI',sans-serif;
        `,
        editorWrap: `flex:1; overflow:hidden;`,
        loading: `
            flex:1; display:flex; align-items:center; justify-content:center;
            color:#666; font-size:13px;
        `,
        hint: `
            display:flex; align-items:center; gap:8px; flex-wrap:wrap;
            padding:6px 14px; font-size:11px; color:#b08800;
            background:#2d2a1e; border-bottom:1px solid #444;
        `,
        hintBtn: `
            background:#b08800; color:#fff; border:none;
            border-radius:4px; padding:3px 10px; font-size:11px;
            cursor:pointer; font-family:'Segoe UI',sans-serif;
        `,
        hintClose: `
            margin-left:auto; background:none; border:none;
            color:#888; cursor:pointer; font-size:13px;
        `,
        error: `
            padding:4px 14px; font-size:11px; color:#f66;
            background:#2a1a1a; border-top:1px solid #442;
        `,
    };

    return html`
        <div style=${s.overlay} onClick=${onClose}>
            <div style=${s.modal} onClick=${e => e.stopPropagation()}>
                <div style=${s.header}>
                    <button style=${s.tab(tab === 'machine', tsLoaded)}
                        onClick=${() => switchTab('machine')}
                        title=${tsLoaded ? 'Derived from loaded .ts' : 'Loaded source'}>
                        ${flowId}-machine.json${tsLoaded ? html`<span style=${s.derivedTag}> derived</span>` : ''}</button>
                    <button style=${s.tab(tab === 'services', tsLoaded)}
                        onClick=${() => switchTab('services')}
                        title=${tsLoaded ? 'Derived from loaded .ts' : 'Loaded source'}>
                        ${flowId}-services.js${tsLoaded ? html`<span style=${s.derivedTag}> derived</span>` : ''}</button>
                    <button style=${s.tab(tab === 'typescript', !tsLoaded)}
                        onClick=${() => switchTab('typescript')}
                        title=${tsLoaded ? 'Loaded source' : 'Generated from machine.json + services.js'}>
                        xstate-machine.ts${!tsLoaded ? html`<span style=${s.derivedTag}> derived</span>` : ''}</button>
                    ${fNames[tab] && html`<span style=${s.fileName}>${fNames[tab]}</span>`}
                    <div style=${s.actions}>
                        <button style=${s.btn} onClick=${openFile} disabled=${!ready}
                            title="Open file from disk">Open</button>
                        <button style=${s.btn} onClick=${save} disabled=${!ready}
                            title=${handleRef.current[tab] ? 'Save to file' : 'Save as new file'}>Save</button>
                        <button style=${s.btn} onClick=${copy} disabled=${!ready}>
                            ${copied ? 'Copied!' : 'Copy'}</button>
                        ${dirty && html`<button style=${s.applyBtn} onClick=${apply}>Apply</button>`}
                        <button style=${s.btn} onClick=${onClose}>Close</button>
                    </div>
                </div>
                ${showHint && html`<div style=${s.hint}>
                    <span>This flow has ${inputStates.length} input state${inputStates.length > 1 ? 's' : ''} without SAMPLE_INPUTS.</span>
                    <button style=${s.hintBtn} onClick=${insertTemplate}>Insert template</button>
                    <button style=${s.hintClose} onClick=${() => setHintDismissed(true)} title="Dismiss">✕</button>
                </div>`}
                ${!ready && html`<div style=${s.loading}>Loading editor...</div>`}
                <div ref=${containerRef} style=${s.editorWrap}/>
                ${error && html`<div style=${s.error}>${error}</div>`}
            </div>
        </div>
    `;
}

function SaveFlowPopover({ anchor, onClose, onSaveFlow, onExportTs, onViewSource }) {
    if (!anchor) return null;

    const bottom = window.innerHeight - anchor.top + 4;
    const left   = Math.max(4, anchor.left);

    const s = {
        popover: `
            position:fixed; bottom:${bottom}px; left:${left}px; z-index:1000;
            background:#1e1e1e; border:1px solid #444; border-radius:8px;
            padding:12px 14px; min-width:220px;
            box-shadow:0 4px 16px rgba(0,0,0,0.5);
            font-family:'Segoe UI',sans-serif; font-size:13px; color:#ccc;
        `,
        title:  `font-weight:600; color:#fff; margin-bottom:10px; font-size:13px;`,
        btn:    `
            display:block; width:100%; background:#2a2a2a; border:1px solid #444;
            border-radius:6px; color:#ccc; font-size:12px; text-align:left;
            padding:8px 12px; margin-bottom:6px; cursor:pointer;
            font-family:'Segoe UI',sans-serif;
        `,
        close:  `
            background:#333; color:#ccc; border:none; border-radius:6px;
            padding:6px 12px; font-size:12px; cursor:pointer; margin-top:4px; width:100%;
        `,
    };

    const pick = (fn) => { onClose(); fn(); };

    return html`
        <div style="position:fixed;inset:0;z-index:999;" onClick=${onClose}/>
        <div style=${s.popover}>
            <div style=${s.title}>💾 Save Flow</div>
            <button style=${s.btn}
                onMouseOver=${e => e.currentTarget.style.background='#333'}
                onMouseOut=${e  => e.currentTarget.style.background='#2a2a2a'}
                onClick=${() => pick(onSaveFlow)}>
                📦 Save as ZIP
            </button>
            <button style=${s.btn}
                onMouseOver=${e => e.currentTarget.style.background='#333'}
                onMouseOut=${e  => e.currentTarget.style.background='#2a2a2a'}
                onClick=${() => pick(onExportTs)}>
                📄 Export for XState VSCode
            </button>
            <button style=${s.btn}
                onMouseOver=${e => e.currentTarget.style.background='#333'}
                onMouseOut=${e  => e.currentTarget.style.background='#2a2a2a'}
                onClick=${() => pick(onViewSource)}>
                👁 View/Edit Source
            </button>
            <button style=${s.close} onClick=${onClose}>Cancel</button>
        </div>
    `;
}

function Toolbar(props) {
    const {
        enabledBtns    = [],
        testRunning    = false,
        shareResult    = null,
        onTest, onRestart, onSaveResults, onSaveFlow, onSaveFlowFiles, onLoad, onAnalyze, onPackProd,
        onShare, onShareClose, onShareCopy, onShareLoad, onExportTs,
        getSourceData, onApplySource, getInputStates,
    } = props;

    const [saveAnchor, setSaveAnchor] = useState(null);
    const [sourceOpen, setSourceOpen] = useState(false);

    // Allow external callers to open the source editor via _updateToolbar({ sourceOpen: true })
    if (props.sourceOpen && !sourceOpen) {
        setSourceOpen(true);
    }

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
            title="Save flow"
            onClick=${(e) => setSaveAnchor(e.currentTarget.getBoundingClientRect())}>💾<br/>Save<br/>Flow</button>

        <${SaveFlowPopover}
            anchor=${saveAnchor}
            onClose=${() => setSaveAnchor(null)}
            onSaveFlow=${onSaveFlow}
            onExportTs=${onExportTs}
            onViewSource=${() => setSourceOpen(true)}/>

        ${sourceOpen && html`<${SourceViewerModal}
            onClose=${() => { setSourceOpen(false); props.onSourceClose?.(); }}
            initialTab=${props.sourceInitialTab ?? 'machine'}
            getSourceData=${getSourceData}
            onApplySource=${onApplySource}
            getInputStates=${getInputStates}/>`}

        <button id="load-btn"
            disabled=${!en('load-btn')}
            style=${st('load-btn')}
            title="Load flow (.zip, .json, .js, .ts) or test results (.zip, .json)"
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
            accept=".zip,.json,.js,.ts" multiple
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
        onExportTs:      () => {},
        getSourceData:   () => ({}),
        onApplySource:   () => {},
        getInputStates:  () => [],
        sourceOpen:      false,
        sourceInitialTab: 'machine',
        onSourceClose:   () => {},
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
