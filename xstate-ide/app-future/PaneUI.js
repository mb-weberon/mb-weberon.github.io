/**
 * PaneUI.js
 *
 * Preact components for the right-pane UI elements that sit outside the chat area:
 *   • Titlebar     — app name, version badge, fullscreen-exit button
 *   • ProfileSection — "CONTEXT & STATE" toggle + collapsible viewer + ctx-edit panel
 *   • ReplayBar    — hidden-until-triggered replay input row
 *
 * Usage:
 *   const { update: _updatePane, toggle: _toggleProfile } = mountPaneUI(
 *       { titlebar, profile, replay },   // DOM mount points
 *       { version, callbacks... }
 *   );
 *
 *   // Later — any subset of keys:
 *   _updatePane({ profileText, stateId });
 *   _updatePane({ replayVisible: true, replayValue: '["a","b"]' });
 *   _updatePane({ profileOpen: false });
 *
 * Mount-point layout requirements (index.html):
 *   titlebar  — replaces #app-titlebar; plain div, #app-titlebar rendered inside
 *   profile   — replaces #profile-toggle + #profile-viewer; must have display:contents
 *               so its two children are direct flex-children of #pane-content
 *   replay    — replaces #replay-bar; plain div, #replay-bar rendered inside
 */

import { html }                         from 'htm/preact';
import { render }                       from 'preact';
import { useState, useRef, useEffect }  from 'preact/hooks';

// ── Titlebar ──────────────────────────────────────────────────────────────────

function Titlebar({ version }) {
    return html`<div id="app-titlebar">
        <span id="app-title">SM-IDE</span>
        <span id="version-badge"><span id="version-label">${version || '—'}</span></span>
        <button id="fs-exit-btn" title="Exit fullscreen"
            onClick=${() => { document.exitFullscreen?.(); document.body.classList.remove('in-fullscreen'); }}>⛶</button>
    </div>`;
}

// ── CtxEditPanel — mounted/unmounted by ProfileSection ─────────────────────────

function CtxEditPanel({ initialValue, onApply, onCancel }) {
    const [value, setValue] = useState(initialValue ?? '');
    const [error, setError] = useState('');
    const areaRef = useRef(null);

    // Focus textarea on first render (panel just opened)
    useEffect(() => { setTimeout(() => areaRef.current?.focus(), 50); }, []);

    const apply = () => {
        let parsed;
        try { parsed = JSON.parse(value); }
        catch (e) { setError(`Invalid JSON: ${e.message}`); return; }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            setError('Must be a JSON object'); return;
        }
        setError('');
        onApply(parsed);
    };

    return html`<div id="ctx-edit-panel" style="margin-bottom:8px;">
        <div style="font-size:10px; color:#aaa; margin-bottom:4px;">
            Edit initial context — applies on restart. Internal fields (_trace, trace) excluded.
        </div>
        <textarea ref=${areaRef} id="ctx-edit-area" spellcheck="false" style="
            width:100%; box-sizing:border-box;
            height:120px; resize:vertical;
            background:#1a1d23; color:#61dafb;
            border:1px solid #444; border-radius:4px;
            font-family:'Courier New',monospace; font-size:11px;
            padding:6px; outline:none;
        " onInput=${e => { setValue(e.target.value); setError(''); }}>${value}</textarea>
        <div id="ctx-edit-error" style="font-size:10px; color:#f66; min-height:14px; margin:2px 0;">${error}</div>
        <div style="display:flex; gap:6px;">
            <button onClick=${apply} style="flex:1; background:#0084ff; color:#fff; border:none; border-radius:4px; padding:4px 8px; font-size:11px; cursor:pointer;">Apply & Restart</button>
            <button onClick=${onCancel} style="background:#444; color:#ccc; border:none; border-radius:4px; padding:4px 8px; font-size:11px; cursor:pointer;">Cancel</button>
        </div>
    </div>`;
}

// ── ProfileSection — toggle strip + collapsible viewer ─────────────────────────

function ProfileSection({ open, profileText, stateId, testProgress, copyBtnEnabled,
                          onToggle, getCtxEditValue, onApplyCtx }) {
    const [ctxEditOpen,      setCtxEditOpen]      = useState(false);
    const [ctxInitialValue,  setCtxInitialValue]  = useState('');

    const openCtxEdit = () => {
        setCtxInitialValue(getCtxEditValue?.() ?? '{}');
        setCtxEditOpen(true);
    };

    // display:contents makes this wrapper invisible to the flex layout in #pane-content,
    // so #profile-toggle and #profile-viewer remain direct flex children — same trick
    // as ChatRoot. The profile-mount div in index.html also has display:contents.
    return html`<div style="display:contents">

        <div id="profile-toggle" class=${open ? 'open' : ''} onClick=${onToggle}>
            <span>CONTEXT & STATE</span>
            <span id="test-progress">${testProgress || ''}</span>
            <span id="profile-toggle-arrow" style=${{ transform: open ? 'rotate(180deg)' : '' }}>▼</span>
        </div>

        <div id="profile-viewer" class=${open ? 'open' : ''}>
            <div id="profile-viewer-inner">
                <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                    <strong>CONTEXT (REAL-TIME)</strong>
                    <div style="display:flex; gap:4px;">
                        <button onClick=${openCtxEdit}
                            title="Override initial context values"
                            style="font-size:10px; padding:2px 6px; background:#444;">⚙ Initial</button>
                        <button id="copy-btn" onClick=${() => window.copyTrace?.()}
                            disabled=${!copyBtnEnabled}
                            style=${{ fontSize: '10px', padding: '2px 6px', background: '#444',
                                      opacity: copyBtnEnabled ? '' : '0.4', cursor: copyBtnEnabled ? '' : 'not-allowed' }}>📋 Copy Trace</button>
                    </div>
                </div>

                ${ctxEditOpen && html`<${CtxEditPanel}
                    initialValue=${ctxInitialValue}
                    onApply=${(parsed) => { setCtxEditOpen(false); onApplyCtx?.(parsed); }}
                    onCancel=${() => setCtxEditOpen(false)}
                />`}

                <pre id="profile-view">${profileText || '{}'}</pre>
                <div id="state-id" style="font-size:10px; color:#888; margin-top:4px;">State: ${stateId || 'loading…'}</div>
            </div>
        </div>

    </div>`;
}

// ── SmideObserverSection — IDE LOG accordion ──────────────────────────────────

function SmideObserverSection({ open, messages, onToggle }) {
    const viewerRef = useRef(null);

    // Auto-scroll the scrollable viewer (not the inner list) to bottom
    useEffect(() => {
        if (open && viewerRef.current) {
            viewerRef.current.scrollTop = viewerRef.current.scrollHeight;
        }
    }, [messages.length, open]);

    return html`<div style="display:contents">

        <div id="observer-toggle" class=${open ? 'open' : ''} onClick=${onToggle}>
            <span>IDE LOG</span>
            <span id="observer-toggle-arrow" style=${{ transform: open ? 'rotate(180deg)' : '' }}>▼</span>
        </div>

        <div id="observer-viewer" class=${open ? 'open' : ''} ref=${viewerRef}>
            <div id="observer-list">
                ${messages.map((m, i) => {
                    if (m.type === 'system') return html`<div key=${i} class="obs-sys">${m.text}</div>`;
                    if (m.type === 'user')   return html`<div key=${i} class="msg user">${m.text}</div>`;
                    return                        html`<div key=${i} class="msg bot">${m.text}</div>`;
                })}
            </div>
        </div>

    </div>`;
}

// ── ReplayBar ─────────────────────────────────────────────────────────────────

function ReplayBar({ visible, value, onReplay, onClear }) {
    const inputRef  = useRef(null);
    const [local, setLocal] = useState('');

    // Sync externally supplied value (e.g. from copyTrace) into local state
    useEffect(() => { setLocal(value ?? ''); }, [value]);

    // Focus input whenever the bar becomes visible
    useEffect(() => {
        if (visible) setTimeout(() => inputRef.current?.focus(), 50);
    }, [visible]);

    return html`<div id="replay-bar" class=${visible ? 'visible' : ''}>
        <button id="replay-go-btn" title="Replay trace"
            onClick=${() => onReplay?.(local)}>▶</button>
        <button id="replay-clear-btn" title="Clear and hide replay bar"
            onClick=${onClear}>✕</button>
        <input type="text" id="replay-input" ref=${inputRef}
            placeholder="Replay string…"
            value=${local}
            onInput=${e => setLocal(e.target.value)}
        />
    </div>`;
}

// ── mountPaneUI ───────────────────────────────────────────────────────────────

/**
 * @param {{ titlebar: Element, profile: Element, observer: Element, replay: Element }} mounts
 * @param {{ version?, profileText?, stateId?, profileOpen?, testProgress?,
 *           copyBtnEnabled?, replayVisible?, replayValue?,
 *           observerMessages?, observerOpen?,
 *           getCtxEditValue?, onApplyCtx?, onReplay? }} options
 * @returns {{ update(patch): void, toggle(): void }}
 */
export function mountPaneUI(mounts, {
    version          = '',
    profileText      = '{}',
    stateId          = 'loading…',
    profileOpen      = false,
    testProgress     = '',
    copyBtnEnabled   = false,
    replayVisible    = false,
    replayValue      = '',
    observerMessages = [],
    observerOpen     = false,
    getCtxEditValue  = null,
    onApplyCtx       = null,
    onReplay         = null,
} = {}) {

    const state = {
        version, profileText, stateId, profileOpen,
        testProgress, copyBtnEnabled, replayVisible, replayValue,
        observerMessages, observerOpen,
    };

    function rerender() {
        if (mounts.titlebar) {
            render(html`<${Titlebar} version=${state.version}/>`, mounts.titlebar);
        }
        if (mounts.profile) {
            render(html`<${ProfileSection}
                open=${state.profileOpen}
                profileText=${state.profileText}
                stateId=${state.stateId}
                testProgress=${state.testProgress}
                copyBtnEnabled=${state.copyBtnEnabled}
                onToggle=${toggle}
                getCtxEditValue=${getCtxEditValue}
                onApplyCtx=${onApplyCtx}
            />`, mounts.profile);
        }
        if (mounts.observer) {
            render(html`<${SmideObserverSection}
                open=${state.observerOpen}
                messages=${state.observerMessages}
                onToggle=${toggleObserver}
            />`, mounts.observer);
        }
        if (mounts.replay) {
            render(html`<${ReplayBar}
                visible=${state.replayVisible}
                value=${state.replayValue}
                onReplay=${onReplay}
                onClear=${() => update({ replayVisible: false, replayValue: '' })}
            />`, mounts.replay);
        }
    }

    function update(patch) {
        Object.assign(state, patch);
        rerender();
    }

    function toggle() {
        update({ profileOpen: !state.profileOpen });
    }

    function toggleObserver() {
        update({ observerOpen: !state.observerOpen });
    }

    rerender();
    return { update, toggle, toggleObserver };
}
