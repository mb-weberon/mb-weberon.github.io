/**
 * SourceEditor.js — CodeMirror 6 wrapper + File System Access helpers.
 *
 * Lazy-loaded by SourceViewerModal (ToolbarUI.js) on first open.
 * Uses absolute esm.sh URLs so no importmap entries are needed;
 * CodeMirror modules only load when this file is imported.
 */

import { EditorView }              from 'https://esm.sh/@codemirror/view@6';
import { EditorState, Compartment } from 'https://esm.sh/@codemirror/state@6';
import { basicSetup }              from 'https://esm.sh/codemirror@6.0.1';
import { json }                    from 'https://esm.sh/@codemirror/lang-json@6';
import { javascript }              from 'https://esm.sh/@codemirror/lang-javascript@6';
import { oneDark }                 from 'https://esm.sh/@codemirror/theme-one-dark@6';

// ── Editor factory ───────────────────────────────────────────────────────────

export function createSourceEditor(container, { content = '', language = 'json', onChange }) {
    const langComp = new Compartment();
    const langExt  = language === 'javascript' ? javascript() : json();

    const view = new EditorView({
        parent: container,
        state: EditorState.create({
            doc: content,
            extensions: [
                basicSetup,
                langComp.of(langExt),
                oneDark,
                EditorView.updateListener.of(u => {
                    if (u.docChanged) onChange?.(u.state.doc.toString());
                }),
                EditorView.theme({
                    '&':           { height: '100%' },
                    '.cm-scroller': { overflow: 'auto' },
                }),
            ],
        }),
    });

    return {
        getContent()       { return view.state.doc.toString(); },
        setContent(text)   { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); },
        setLanguage(lang)  { view.dispatch({ effects: langComp.reconfigure(lang === 'javascript' ? javascript() : json()) }); },
        focus()            { view.focus(); },
        destroy()          { view.destroy(); },
    };
}

// ── File System Access helpers ───────────────────────────────────────────────

export const fsaSupported = typeof window.showOpenFilePicker === 'function';

export async function pickFile() {
    if (fsaSupported) {
        const [handle] = await window.showOpenFilePicker({
            types: [{ description: 'Source files', accept: { 'text/plain': ['.json', '.js', '.ts'] } }],
        });
        const file = await handle.getFile();
        return { text: await file.text(), name: file.name, handle };
    }
    // Fallback for Firefox / Safari
    return new Promise(resolve => {
        const input  = document.createElement('input');
        input.type   = 'file';
        input.accept = '.json,.js,.ts';
        input.onchange = async () => {
            const f = input.files?.[0];
            if (!f) { resolve(null); return; }
            resolve({ text: await f.text(), name: f.name, handle: null });
        };
        input.click();
    });
}

export async function saveToHandle(handle, content) {
    const w = await handle.createWritable();
    await w.write(content);
    await w.close();
}

export async function saveFileAs(content, suggestedName) {
    if (fsaSupported) {
        const ext  = suggestedName.endsWith('.json') ? '.json'
                   : suggestedName.endsWith('.ts') ? '.ts' : '.js';
        const mime = ext === '.json' ? 'application/json' : 'text/javascript';
        const handle = await window.showSaveFilePicker({
            suggestedName,
            types: [{ description: 'Source file', accept: { [mime]: [ext] } }],
        });
        await saveToHandle(handle, content);
        return handle;
    }
    // Fallback: blob download
    const a  = document.createElement('a');
    a.href     = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    a.download = suggestedName;
    a.click();
    return null;
}
