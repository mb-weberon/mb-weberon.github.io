/**
 * ui-contracts.js
 *
 * Measures layout properties of all UI states — including toggled and
 * conditionally-rendered elements — and either captures a baseline or
 * compares against one.
 *
 * Baseline files are named after the viewport they were captured at:
 *   ui-baseline-1026x769.json   ← created automatically on capture
 *
 * This means the tool is machine-independent by design: each machine captures
 * its own baseline and checks against it. No constants to maintain.
 *
 * Usage (browser console):
 *   await window.ui_contracts()           — auto: check if baseline exists, else capture
 *   await window.ui_contracts('capture')  — capture baseline for current viewport
 *   await window.ui_contracts('check')    — compare against baseline for current viewport
 *
 * Workflow (first time on a machine):
 *   1. Undock DevTools to a separate window (keeps page viewport clean).
 *   2. Open the app in a stable window — any size, but keep it consistent.
 *      Quickest fixed-size window: window.open(location.href,'_blank','width=NNNN,height=NNNN')
 *      The exact inner dimensions are logged at boot: "📐 Inner viewport: W × H px"
 *   3. Wait for the first bot message + email input to appear.
 *   4. Run: await window.ui_contracts('capture')
 *      Saves ui-baseline-{W}x{H}.json — accept the Save dialog or copy the JSON.
 *   5. Commit ui-baseline-{W}x{H}.json.
 *   6. Before/after every change: await window.ui_contracts()
 *      Automatically loads the baseline for the current viewport size.
 *
 * Prerequisites for capture / check:
 *   - App must be loaded with at least the first bot message visible and
 *     #input-area populated (so controls-container has its real height).
 *   - DevTools must be undocked or closed — side/bottom docking changes
 *     window.innerWidth / innerHeight, which changes which baseline file is used.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const REGRESSION_FACTOR = 0.90;   // flag if value drops below 90% of baseline
const TOUCH_MIN_PX      = 44;     // absolute minimum for any touch target

// FIX R1 + Bug 2: raised from 60ms to 350ms.
//   - 60ms was shorter than the 0.25s CSS transition on #profile-viewer,
//     causing mid-animation measurements.
//   - 350ms = 250ms transition + 100ms compositor margin.
const RECALC_DELAY_MS   = 350;

// ── Baseline URL ──────────────────────────────────────────────────────────────
//
// Baseline files are named ui-baseline-{label}.json.
// By default the label is the actual inner viewport dimensions at call time.
// Pass an explicit label to ui_contracts() to point at a specific file — e.g.
// '1024x768' when the baseline was captured from a window.open(1024,768) session
// whose actual inner dimensions differ slightly on your platform.
//
//   await window.ui_contracts()                       — label: current WxH
//   await window.ui_contracts('check',   '1024x768')  — uses ui-baseline-1024x768.json
//   await window.ui_contracts('capture', '1024x768')  — saves ui-baseline-1024x768.json

const baselineUrl  = (label) => `./ui-baseline-${label}.json`;
const defaultLabel = ()      => `${window.innerWidth}x${window.innerHeight}`;

// ── Utilities ─────────────────────────────────────────────────────────────────

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// FIX R1: replaced offsetHeight flush + setTimeout with double-rAF + delay.
// double-rAF guarantees at least one full paint cycle has committed before we
// measure, so CSS transition state and compositor updates are settled.
const reflow = (ms = RECALC_DELAY_MS) => new Promise(r => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, ms)));
});

const getRect = (id) => document.getElementById(id)?.getBoundingClientRect() ?? null;
const getCss  = (id, prop) => {
    const el = document.getElementById(id);
    return el ? getComputedStyle(el)[prop] : null;
};

// ── Single measurement ────────────────────────────────────────────────────────

/**
 * Take one named measurement. Returns { name, value, unit }.
 * Value is always a number so baseline diffs are numeric.
 */
function measure(name, elementId, property) {
    const el = document.getElementById(elementId);
    if (!el) return { name, value: null, unit: 'px', missing: true };

    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);

    const value = (() => {
        switch (property) {
            case 'height':    return r.height;
            case 'width':     return r.width;
            case 'top':       return r.top;
            case 'bottom':    return r.bottom;
            case 'left':      return r.left;
            case 'right':     return r.right;
            case 'fontSize':  return parseFloat(s.fontSize);
            case 'zIndex':    return parseInt(s.zIndex) || 0;
            case 'opacity':   return parseFloat(s.opacity);
            case 'maxHeight': return parseFloat(s.maxHeight) || 0;
            default:          return parseFloat(s[property]) || 0;
        }
    })();

    return { name, value: parseFloat(value.toFixed(2)), unit: 'px' };
}

/**
 * Measure all toolbar buttons.
 * prefix is prepended to every metric name (e.g. 'mobile_' for mobile runs).
 */
function measureToolbarButtons(prefix = '') {
    const results = [];
    document.querySelectorAll('#toolbar button').forEach((btn, i) => {
        const r     = btn.getBoundingClientRect();
        const s     = getComputedStyle(btn);
        const label = btn.innerText.trim().replace(/\s+/g, '_').slice(0, 20);
        const base  = `${prefix}toolbar_btn_${i + 1}[${label}]`;
        results.push(
            { name: `${base}_height`,     value: parseFloat(r.height.toFixed(2)),               unit: 'px' },
            { name: `${base}_width`,      value: parseFloat(r.width.toFixed(2)),                unit: 'px' },
            { name: `${base}_fontSize`,   value: parseFloat(parseFloat(s.fontSize).toFixed(2)), unit: 'px' },
            { name: `${base}_right_edge`, value: parseFloat(r.right.toFixed(2)),                unit: 'px' }
        );
    });
    return results;
}

// ── State snapshots ───────────────────────────────────────────────────────────

/**
 * Each snapshot function:
 *   1. Saves current state
 *   2. Applies the state to measure
 *   3. Takes measurements
 *   4. Restores original state
 *   Returns an array of { name, value, unit } objects.
 */

async function snapshotDefault() {
    return [
        measure('app_width',            'app',                'width'),
        measure('app_height',           'app',                'height'),
        measure('diagram_pane_width',   'diagram-pane',       'width'),
        measure('diagram_pane_height',  'diagram-pane',       'height'),
        measure('right_pane_width',     'right-pane',         'width'),
        measure('right_pane_height',    'right-pane',         'height'),
        measure('slide_handle_width',   'slide-handle',       'width'),
        measure('slide_handle_height',  'slide-handle',       'height'),
        measure('messages_height',      'messages',           'height'),
        measure('controls_height',      'controls-container', 'height'),
        measure('controls_bottom',      'controls-container', 'bottom'),
        measure('toolbar_height',       'toolbar',            'height'),
        measure('pane_content_left',    'pane-content',       'left'),
        ...measureToolbarButtons(),
    ];
}

// profile_viewer_open_height is intentionally NOT measured here.
// The rendered height depends on how much context data is in #profile-view
// at the time of the check, which varies with conversation state. A short
// conversation produces ~83px; a full one produces ~188px — both are correct.
// What we care about is that the CSS cap (maxHeight) is correct, which is
// content-independent and tested below.
async function snapshotProfileViewerOpen() {
    const viewer  = document.getElementById('profile-viewer');
    if (!viewer) return [];
    const wasOpen = viewer.classList.contains('open');

    if (!wasOpen) { window.toggleProfile?.(); await reflow(); }

    const measurements = [
        measure('profile_viewer_open_maxHeight', 'profile-viewer', 'maxHeight'),
    ];

    if (!wasOpen) { window.toggleProfile?.(); await reflow(); }
    return measurements;
}

async function snapshotProfileViewerClosed() {
    const viewer  = document.getElementById('profile-viewer');
    if (!viewer) return [];
    const wasOpen = viewer.classList.contains('open');

    if (wasOpen) { window.toggleProfile?.(); await reflow(); }

    const measurements = [
        measure('profile_viewer_closed_height',    'profile-viewer', 'height'),
        measure('profile_viewer_closed_maxHeight', 'profile-viewer', 'maxHeight'),
    ];

    if (wasOpen) { window.toggleProfile?.(); await reflow(); }
    return measurements;
}

// FIX Bug 1: extracted as a private helper called only from within
// snapshotMobileLayout(), where force-mobile-layout is already active and
// the .pane-collapsed CSS rule actually fires.
// The old standalone snapshotPaneCollapsed() no longer exists — on desktop
// there is no CSS rule for .pane-collapsed so the class had no effect and
// the measurements were identical to the default section.
async function _measurePaneCollapsed(prefix = '') {
    const pane = document.getElementById('right-pane');
    if (!pane) return [];
    const wasCollapsed = pane.classList.contains('pane-collapsed');

    if (!wasCollapsed) {
        pane.classList.add('pane-collapsed');
        await reflow();
    }

    const measurements = [
        measure(`${prefix}pane_collapsed_width`,         'right-pane',   'width'),
        measure(`${prefix}slide_handle_collapsed_width`, 'slide-handle', 'width'),
    ];

    if (!wasCollapsed) {
        pane.classList.remove('pane-collapsed');
        await reflow();
    }
    return measurements;
}

// FIX Bug 5 + Bug 1: snapshotMobileLayout now runs all four sub-snapshots
// (base metrics, profile open, profile closed, pane collapsed) while
// force-mobile-layout is active, so mobile behaviour is fully covered.
// Previously only base metrics + toolbar buttons were measured in mobile mode.
async function snapshotMobileLayout() {
    const wasMobile = document.body.classList.contains('force-mobile-layout');
    if (!wasMobile) {
        window._forceMobileLayout = true;
        document.body.classList.add('force-mobile-layout');
        await reflow();
    }

    // Base mobile layout measurements
    const measurements = [
        measure('mobile_right_pane_width',    'right-pane',   'width'),
        measure('mobile_right_pane_zIndex',   'right-pane',   'zIndex'),
        measure('mobile_diagram_pane_zIndex', 'diagram-pane', 'zIndex'),
        measure('mobile_diagram_pane_width',  'diagram-pane', 'width'),
        ...measureToolbarButtons('mobile_'),
    ];

    // Profile viewer open — measured in mobile context
    const mobileProfileOpen = await snapshotProfileViewerOpen();
    mobileProfileOpen.forEach(m => measurements.push({ ...m, name: `mobile_${m.name}` }));

    // Profile viewer closed — measured in mobile context
    const mobileProfileClosed = await snapshotProfileViewerClosed();
    mobileProfileClosed.forEach(m => measurements.push({ ...m, name: `mobile_${m.name}` }));

    // Pane collapsed — FIX Bug 1: only meaningful here, inside mobile context
    const mobileCollapsed = await _measurePaneCollapsed('mobile_');
    measurements.push(...mobileCollapsed);

    if (!wasMobile) {
        window._forceMobileLayout = false;
        document.body.classList.remove('force-mobile-layout');
        await reflow();
    }
    return measurements;
}

// FIX R2 + Bug 4:
//   R2: added double-rAF wait (via reflow()) after _showResultsDrawer() so
//       the drawer's internal rAF callbacks (applyCollapsed, auto-selectRow)
//       have fully run before measurements are taken.
//   Bug 4: replaced viewport-absolute drawer_header_top with
//       drawer_header_bottom_offset — the distance from the bottom of the
//       header to the viewport bottom edge — which is stable regardless of
//       window height differences between capture and check sessions.
async function snapshotResultsDrawer() {
    const existing       = document.getElementById('test-results-drawer');
    const alreadyPresent = !!existing;

    if (!alreadyPresent) {
        const mockResults = {
            runAt:  new Date().toISOString(),
            flowId: 'ui-contract-mock',
            total: 2, passed: 1, failed: 1,
            config: window._config ?? { id: 'mock', states: {} },
            cases: [
                { path: 1, passed: true,  expected: ['a'], actual: ['a'],
                  diffs: [], finalStateId: 'state_a', finalContext: {},
                  bubbles: [], visitedEdges: [] },
                { path: 2, passed: false, expected: ['a','b'], actual: ['a'],
                  diffs: ['length mismatch'], finalStateId: 'state_b',
                  finalContext: {}, bubbles: [], visitedEdges: [] },
            ]
        };

        if (window._showResultsDrawer) {
            window._showResultsDrawer(mockResults);
        } else {
            console.warn('⚠️  ui-contracts: window._showResultsDrawer not found — expose it in main.js for drawer coverage');
            return [];
        }

        // FIX R2: reflow() here is a double-rAF + delay, which is enough for
        // the drawer's own requestAnimationFrame callbacks to finish running.
        await reflow();
    }

    const drawer = document.getElementById('test-results-drawer');
    if (!drawer) return [];

    const header     = drawer.firstElementChild;
    const headerRect = header?.getBoundingClientRect();
    const drawerRect = drawer.getBoundingClientRect();

    // FIX Bug 4: bottom_offset = distance from header bottom to viewport bottom.
    // This is window-height-independent, unlike the old absolute `top` value.
    const headerBottomOffset = headerRect
        ? parseFloat((window.innerHeight - headerRect.bottom).toFixed(2))
        : 0;

    const measurements = [
        { name: 'drawer_width',                value: parseFloat(drawerRect.width.toFixed(2)),          unit: 'px' },
        { name: 'drawer_right_edge',           value: parseFloat(drawerRect.right.toFixed(2)),           unit: 'px' },
        { name: 'drawer_header_height',        value: parseFloat((headerRect?.height ?? 0).toFixed(2)), unit: 'px' },
        { name: 'drawer_header_bottom_offset', value: headerBottomOffset,                                unit: 'px' },
    ];

    if (!alreadyPresent) {
        drawer.remove();
        await reflow();
    }

    return measurements;
}

// ── Full measurement suite ────────────────────────────────────────────────────

async function measureAll() {
    const timestamp  = new Date().toISOString();
    const appVersion = window._appVersion ?? null;
    const viewport   = { width: window.innerWidth, height: window.innerHeight };

    // FIX Bug 1: standalone pane_collapsed section removed.
    // Pane-collapsed is now measured inside mobile_layout (the only context
    // where the CSS rule fires), under mobile_pane_collapsed_* keys.
    const sections = {
        default:               await snapshotDefault(),
        profile_viewer_open:   await snapshotProfileViewerOpen(),
        profile_viewer_closed: await snapshotProfileViewerClosed(),
        mobile_layout:         await snapshotMobileLayout(),
        results_drawer:        await snapshotResultsDrawer(),
    };

    return { timestamp, appVersion, viewport, sections };
}

// ── Comparison ────────────────────────────────────────────────────────────────

function compareToBaseline(current, baseline) {
    const failures    = [];
    const warnings    = [];
    const passed      = [];
    const newKeys     = [];
    const missingKeys = [];

    // Version mismatch — warn only, never fail.
    const cv = current.appVersion  ?? '(unknown)';
    const bv = baseline.appVersion ?? '(unknown)';
    if (cv !== bv) {
        warnings.push(
            `app version changed: baseline captured at ${bv}, running ${cv} — ` +
            `check out ${bv} to reproduce the baseline state`
        );
    }

    // Metrics whose values are driven by runtime content rather than CSS rules.
    // Comparing them to a baseline captured at a different conversation state
    // produces false failures. Skipped in comparison but still captured for docs.
    const DYNAMIC_HEIGHT_METRICS = new Set([
        'profile_viewer_open_height',
        'mobile_profile_viewer_open_height',
    ]);

    for (const [sectionName, measurements] of Object.entries(current.sections)) {
        const baseSection = baseline.sections[sectionName];
        if (!baseSection) {
            newKeys.push(sectionName);
            continue;
        }

        const baseMap = Object.fromEntries(baseSection.map(m => [m.name, m]));

        for (const m of measurements) {
            if (m.missing) {
                warnings.push(`${sectionName} / ${m.name}: element not found`);
                continue;
            }

            // Skip content-dependent metrics — see DYNAMIC_HEIGHT_METRICS above.
            if (DYNAMIC_HEIGHT_METRICS.has(m.name)) {
                passed.push(`${sectionName}/${m.name} (dynamic — skipped)`);
                continue;
            }

            const base = baseMap[m.name];
            if (!base) {
                newKeys.push(`${sectionName}/${m.name}`);
                continue;
            }

            if (base.value === null) {
                warnings.push(`${sectionName} / ${m.name}: baseline value was null`);
                continue;
            }

            const ratio         = base.value > 0 ? m.value / base.value : 1;
            const dropped       = ratio < REGRESSION_FACTOR;
            // Touch-minimum check applies only to mobile-context metrics.
            // Desktop drawer header is intentionally 36px (< 44px) by design —
            // it is not a touch target. Only metrics prefixed with 'mobile_' or
            // inside the mobile_layout section are actual touch targets.
            const isMobileContext = m.name.startsWith('mobile_') || sectionName === 'mobile_layout';
            const isTouchTarget   = isMobileContext &&
                                    m.name.includes('height') &&
                                    (m.name.includes('btn') || m.name.includes('drawer_header'));

            // Absolute minimum check for touch targets
            if (isTouchTarget && m.value < TOUCH_MIN_PX) {
                failures.push({
                    section:  sectionName,
                    name:     m.name,
                    reason:   `below touch minimum`,
                    baseline: base.value,
                    current:  m.value,
                    delta:    parseFloat((m.value - base.value).toFixed(2))
                });
                continue;
            }

            // Regression check against baseline
            if (dropped) {
                failures.push({
                    section:  sectionName,
                    name:     m.name,
                    reason:   `dropped ${((1 - ratio) * 100).toFixed(1)}% below baseline`,
                    baseline: base.value,
                    current:  m.value,
                    delta:    parseFloat((m.value - base.value).toFixed(2))
                });
                continue;
            }

            // Notable increase (not a failure, but worth flagging)
            if (ratio > 1.25 && base.value > 5) {
                warnings.push(
                    `${sectionName} / ${m.name}: grew ${((ratio - 1) * 100).toFixed(1)}% above baseline ` +
                    `(${base.value} → ${m.value})`
                );
            }

            passed.push(`${sectionName}/${m.name}`);
        }

        // Keys present in baseline but absent from current
        const currentNames = new Set(measurements.map(m => m.name));
        baseSection.forEach(b => {
            if (!currentNames.has(b.name)) missingKeys.push(`${sectionName}/${b.name}`);
        });
    }

    return { failures, warnings, passed, newKeys, missingKeys };
}

// ── Reporting ─────────────────────────────────────────────────────────────────

function report(comparison, currentViewport, baselineViewport, currentVersion, baselineVersion) {
    const { failures, warnings, passed, newKeys, missingKeys } = comparison;
    const allPassed = failures.length === 0;

    console.group(
        `%c🧪 UI Contracts — ${allPassed ? '✅ PASSED' : '❌ FAILED'} ` +
        `(${passed.length} passed, ${failures.length} failed, ${warnings.length} warnings)`,
        `color:${allPassed ? '#98c379' : '#e06c75'}; font-weight:bold; font-size:13px;`
    );

    console.log(
        `Viewport: ${currentViewport.width}×${currentViewport.height}  |  ` +
        `Baseline captured at: ${baselineViewport.width}×${baselineViewport.height}\n` +
        `App version: ${currentVersion ?? '(unknown)'}  |  ` +
        `Baseline version: ${baselineVersion ?? '(unknown)'}`
    );

    if (failures.length) {
        console.group(`❌ Failures (${failures.length})`);
        failures.forEach(f => {
            console.error(
                `  ❌ [${f.section}] ${f.name}\n` +
                `     ${f.reason} — baseline: ${f.baseline}px, now: ${f.current}px (Δ ${f.delta}px)`
            );
        });
        console.groupEnd();
    }

    if (warnings.length) {
        console.group(`⚠️  Warnings (${warnings.length})`);
        warnings.forEach(w => console.warn(`  ⚠️  ${w}`));
        console.groupEnd();
    }

    if (newKeys.length) {
        console.group(`🆕 New measurements (not in baseline — run capture to update)`);
        newKeys.forEach(k => console.log(`  + ${k}`));
        console.groupEnd();
    }

    if (missingKeys.length) {
        console.group(`🗑️  Removed measurements (were in baseline, now gone)`);
        missingKeys.forEach(k => console.log(`  - ${k}`));
        console.groupEnd();
    }

    if (allPassed && !warnings.length) {
        console.log('%c  No regressions detected.', 'color:#98c379;');
    }

    console.groupEnd();

    return allPassed;
}

// ── Hint ──────────────────────────────────────────────────────────────────────

function _printHint(label) {
    const W = window.innerWidth, H = window.innerHeight;
    console.groupCollapsed('%c📐 UI Contracts — no baseline found', 'color:#e5c07b; font-weight:bold;');
    console.log(
        `Looked for: ui-baseline-${label}.json  (viewport: ${W}×${H})\n\n` +
        `For a stable fixed-size window, run:\n` +
        `  window.open(location.href, '_blank', 'width=1024,height=768')\n` +
        `then undock DevTools before measuring.\n\n` +
        `To capture a baseline:\n` +
        `  await window.ui_contracts('capture', '1024x768')  ← saves ui-baseline-1024x768.json\n\n` +
        `To check against a specific baseline:\n` +
        `  await window.ui_contracts('check', '1024x768')\n\n` +
        `To auto-detect (uses current ${W}×${H} as label):\n` +
        `  await window.ui_contracts()`
    );
    console.groupEnd();
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * @param {string} [mode]  'capture' | 'check' — auto-detected if omitted
 * @param {string} [label] baseline label, e.g. '1024x768' — defaults to
 *                         current window.innerWidth×window.innerHeight
 */
async function ui_contracts(mode, label) {
    label     = label ?? defaultLabel();
    const url = baselineUrl(label);

    // Auto-detect mode based on whether a baseline exists for this label.
    if (!mode) {
        try {
            const res = await fetch(url, { cache: 'no-store' });
            mode = res.ok ? 'check' : 'capture';
            if (mode === 'capture') _printHint(label);
        } catch {
            mode = 'capture';
            _printHint(label);
        }
    }

    console.group(`🧪 UI Contracts [${mode}] — ${label}  (viewport: ${window.innerWidth}×${window.innerHeight})`);

    if (mode === 'capture') {
        console.log(`📐 Measuring all UI states...`);
        const data = await measureAll();

        const json     = JSON.stringify(data, null, 2);
        const filename = `ui-baseline-${label}.json`;
        console.log(
            `%c✅ Baseline captured. Copy the JSON below into ${filename} and commit it.`,
            'color:#98c379; font-weight:bold;'
        );
        console.log(json);

        if (window.showSaveFilePicker) {
            try {
                const fh = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
                });
                const writable = await fh.createWritable();
                await writable.write(json);
                await writable.close();
                console.log(`💾 Saved directly to ${filename} via File System Access API`);
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.warn('⚠️  File System Access API save failed:', e.message);
                }
            }
        }

        console.groupEnd();
        return data;

    } else {
        // Check mode — load the named baseline.
        let baseline;
        try {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            baseline = await res.json();
        } catch (e) {
            console.error(`❌ Could not load baseline from ${url}: ${e.message}`);
            console.info(`   Run: await window.ui_contracts('capture', '${label}')  to create one.`);
            console.groupEnd();
            return null;
        }

        console.log(`📐 Measuring all UI states...`);
        const current    = await measureAll();
        const comparison = compareToBaseline(current, baseline);
        const allPassed  = report(
            comparison,
            current.viewport,   baseline.viewport,
            current.appVersion, baseline.appVersion
        );

        console.groupEnd();
        return { allPassed, comparison, current, baseline };
    }
}

// ── Expose on window ──────────────────────────────────────────────────────────

window.ui_contracts = ui_contracts;
