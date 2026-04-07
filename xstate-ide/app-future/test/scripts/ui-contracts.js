/**
 * ui-contracts.js
 *
 * Measures layout properties of all UI states — including toggled and
 * conditionally-rendered elements — and either captures a baseline or
 * compares against one.
 *
 * Baseline files are named after the viewport they were captured at:
 *   ui-baseline-1024x768.json   ← created automatically on capture
 *
 * Usage (browser console):
 *   await window.contracts.ui()           — one-call: opens popup, loads fixture, checks (or captures)
 *   await window.contracts.ui('capture')  — force capture baseline
 *   await window.contracts.ui('check')    — force check against baseline
 *
 * Fixture: app/test/smide-test-results.json
 *   contracts.ui loads this pre-baked results file which puts the IDE in results_ready
 *   state — the only state where all toolbar buttons (including Save Flow) are
 *   visible. Generate it once by running tests on the smide-machine and saving
 *   the results, then commit as app/test/smide-test-results.json.
 *
 * Workflow (first time / after UI changes):
 *   1. Generate the fixture (once):
 *      Load smide-machine.json + smide-services.js → Test → Save Results →
 *      commit the downloaded file as app/test/smide-test-results.json.
 *   2. Capture baseline:
 *      await window.contracts.ui('capture')
 *      Opens a 1024×768 popup, loads the fixture, downloads ui-baseline-1024x768.json.
 *      Commit it alongside the fixture.
 *   3. Before/after every change:
 *      await window.contracts.ui()
 *      Opens popup, loads fixture, checks against the saved baseline.
 *
 * Prerequisites for capture / check:
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
// Baseline files are named ui-baseline-{label}.json where label = WxH of the
// inner viewport at capture time. ui_full() always uses 1024x768.
//
// Pass an explicit label to contracts.ui() to target a specific file:
//   await window.contracts.ui('check',   '1024x768')  — uses ui-baseline-1024x768.json
//   await window.contracts.ui('capture', '1024x768')  — saves ui-baseline-1024x768.json

const baselineUrl  = (label) => `./test/baselines/ui-baseline-${label}.json`;
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
    let visibleIndex = 0;
    document.querySelectorAll('#toolbar button').forEach((btn) => {
        const r = btn.getBoundingClientRect();
        // Skip hidden buttons (display:none or otherwise not rendered).
        // State-driven visibility means some buttons are intentionally absent;
        // measuring them at height:0 would trigger false touch-minimum failures.
        if (r.height === 0) return;
        visibleIndex++;
        const s     = getComputedStyle(btn);
        const label = btn.innerText.trim().replace(/\s+/g, '_').slice(0, 20);
        const base  = `${prefix}toolbar_btn_${visibleIndex}[${label}]`;
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
        measure('diagram_pane_right',   'diagram-pane',       'right'),
        measure('right_pane_left',      'right-pane',         'left'),
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

async function snapshotObserverViewerOpen() {
    const viewer  = document.getElementById('observer-viewer');
    if (!viewer) return [];
    const wasOpen = viewer.classList.contains('open');

    if (!wasOpen) { window.toggleObserver?.(); await reflow(); }

    const measurements = [
        measure('observer_toggle_height',      'observer-toggle', 'height'),
        measure('observer_viewer_open_maxHeight', 'observer-viewer', 'maxHeight'),
    ];

    if (!wasOpen) { window.toggleObserver?.(); await reflow(); }
    return measurements;
}

async function snapshotObserverViewerClosed() {
    const viewer  = document.getElementById('observer-viewer');
    if (!viewer) return [];
    const wasOpen = viewer.classList.contains('open');

    if (wasOpen) { window.toggleObserver?.(); await reflow(); }

    const measurements = [
        measure('observer_toggle_height',        'observer-toggle', 'height'),
        measure('observer_viewer_closed_height', 'observer-viewer', 'height'),
    ];

    if (wasOpen) { window.toggleObserver?.(); await reflow(); }
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

    // Drawer position in mobile context — catches translateY-over-negative-bottom stacking
    const mobileDrawer = await _measureDrawerInMobile();
    measurements.push(...mobileDrawer);

    if (!wasMobile) {
        window._forceMobileLayout = false;
        document.body.classList.remove('force-mobile-layout');
        await reflow();
    }
    return measurements;
}

// Measures the drawer while in mobile context (called from snapshotMobileLayout so
// force-mobile-layout is already active). Checks that the collapsed drawer header
// is within the viewport — catches the translateY-over-negative-bottom stacking bug.
async function _measureDrawerInMobile() {
    const existing       = document.getElementById('test-results-drawer');
    const alreadyPresent = !!existing;

    if (!alreadyPresent) {
        const mockResults = {
            runAt:  new Date().toISOString(),
            flowId: 'ui-contract-mock-mobile',
            total: 1, passed: 1, failed: 0,
            config: window._config ?? { id: 'mock', states: {} },
            cases: [
                { path: 1, passed: true, expected: ['a'], actual: ['a'],
                  diffs: [], finalStateId: 'state_a', finalContext: {},
                  bubbles: [], visitedEdges: [] },
            ]
        };
        if (!window._showResultsDrawer) return [];
        window._showResultsDrawer(mockResults);
        await reflow();
    }

    const drawer = document.getElementById('test-results-drawer');
    if (!drawer) return [];

    // Measure the collapsed state (drawer should be visible as a bottom strip)
    const rect   = drawer.getBoundingClientRect();
    const header = drawer.firstElementChild;
    const hRect  = header?.getBoundingClientRect();

    // header_top_in_viewport: should be < window.innerHeight (header visible at bottom)
    // A value >= window.innerHeight means the header was pushed below the viewport.
    const headerTopInViewport = parseFloat((hRect?.top ?? rect.top).toFixed(2));

    const measurements = [
        { name: 'mobile_drawer_bottom_viewport_distance',
          value: parseFloat((window.innerHeight - rect.bottom).toFixed(2)), unit: 'px' },
        { name: 'mobile_drawer_header_top_in_viewport',
          value: headerTopInViewport, unit: 'px' },
    ];

    if (!alreadyPresent) {
        drawer.remove();
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

    // drawer_bottom_viewport_distance: distance from drawer bottom edge to viewport bottom.
    // Should be ~0 when the drawer is correctly pinned at bottom:0 (fixed position).
    // A negative value means the drawer has been pushed below the viewport — the exact
    // symptom of the mobile/desktop resize bug (bottom:-238px stacked with translateY).
    const drawerBottomDist = parseFloat((window.innerHeight - drawerRect.bottom).toFixed(2));

    const measurements = [
        { name: 'drawer_width',                    value: parseFloat(drawerRect.width.toFixed(2)),          unit: 'px' },
        { name: 'drawer_right_edge',               value: parseFloat(drawerRect.right.toFixed(2)),           unit: 'px' },
        { name: 'drawer_top',                      value: parseFloat(drawerRect.top.toFixed(2)),             unit: 'px' },
        { name: 'drawer_bottom_viewport_distance', value: drawerBottomDist,                                  unit: 'px' },
        { name: 'drawer_header_height',            value: parseFloat((headerRect?.height ?? 0).toFixed(2)), unit: 'px' },
        { name: 'drawer_header_bottom_offset',     value: headerBottomOffset,                                unit: 'px' },
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
        default:                  await snapshotDefault(),
        profile_viewer_open:      await snapshotProfileViewerOpen(),
        profile_viewer_closed:    await snapshotProfileViewerClosed(),
        observer_viewer_open:     await snapshotObserverViewerOpen(),
        observer_viewer_closed:   await snapshotObserverViewerClosed(),
        mobile_layout:            await snapshotMobileLayout(),
        results_drawer:           await snapshotResultsDrawer(),
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

    // Metrics that should be ~0 at baseline. The standard ratio check is useless
    // when base.value===0 (ratio always 1). Instead we check abs(current) <= tolerance.
    // 4px tolerance allows for sub-pixel rounding; anything beyond is a real shift.
    const NEAR_ZERO_METRICS = new Set([
        'drawer_bottom_viewport_distance',
        'mobile_drawer_bottom_viewport_distance',
    ]);
    const NEAR_ZERO_TOL_PX = 4;

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

            // Near-zero metrics: ratio is meaningless when baseline ≈ 0.
            // Fail if |current| exceeds tolerance — catches off-screen positioning.
            if (NEAR_ZERO_METRICS.has(m.name)) {
                if (Math.abs(m.value) > NEAR_ZERO_TOL_PX) {
                    failures.push({
                        section:  sectionName,
                        name:     m.name,
                        reason:   `expected ~0px but got ${m.value}px (tolerance ±${NEAR_ZERO_TOL_PX}px)`,
                        baseline: base.value,
                        current:  m.value,
                        delta:    parseFloat((m.value - base.value).toFixed(2))
                    });
                } else {
                    passed.push(`${sectionName}/${m.name}`);
                }
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
        `Prerequisite — generate the fixture file once:\n` +
        `  Load smide-machine.json + smide-services.js → Test → Save Results\n` +
        `  Commit as app/test/smide-test-results.json\n\n` +
        `Then capture a baseline (opens a 1024×768 popup automatically):\n` +
        `  await window.contracts.ui('capture')  ← recommended\n\n` +
        `Or manually in a 1024×768 window with DevTools undocked:\n` +
        `  await window.contracts.ui('capture', '1024x768')\n\n` +
        `To check against the baseline:\n` +
        `  await window.contracts.ui()           ← recommended\n` +
        `  await window.contracts.ui('check', '1024x768')\n\n` +
        `To auto-detect viewport (uses current ${W}×${H} as label):\n` +
        `  await window.contracts.ui()`
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

        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        console.log(`💾 Downloading ${filename}…`);

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
            console.info(`   Run: await window.contracts.ui('capture', '${label}')  to create one.`);
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

// ── ui_full — one-call orchestration ──────────────────────────────────────────
//
// Opens a fixed-size popup if needed, loads the smide test fixture, then runs
// ui_contracts. Intended for developer use from the DevTools console:
//
//   await window.contracts.ui()           — check (or capture if no baseline)
//   await window.contracts.ui('capture')  — force capture
//   await window.contracts.ui('check')    — force check

const UI_FULL_W = 1024;
const UI_FULL_H = 768;

// Always resolves to the app/ entry point (app/index.html) regardless of the
// current browser URL. import.meta.url is the URL of this module file
// (app/test/scripts/ui-contracts.js), so '../../' reliably points to app/.
const APP_URL = new URL('../../', import.meta.url).href;

async function _waitFor(predicate, timeoutMs = 6000, intervalMs = 100) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return true;
        await wait(intervalMs);
    }
    return false;
}

// ── Fixture loader ────────────────────────────────────────────────────────────
//
// Loads app/test/smide-test-results.json, which puts the IDE in results_ready
// state — the only state where all toolbar buttons (including Save Flow) are
// visible. This replicates what loadTestResults() does but via fetch so it can
// be called programmatically without a user file-picker gesture.

async function _loadFixture(win = window) {
    console.log('  _loadFixture: fetching smide-test-results.json…');
    const res = await fetch('./test/fixtures/smide-test-results.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(
        `Cannot load fixture (HTTP ${res.status}).\n` +
        `Generate it: Load smide-machine.json + smide-services.js → Test → Save Results\n` +
        `then commit the file as app/test/smide-test-results.json.`
    );
    const results = await res.json();
    console.log(`  _loadFixture: fixture parsed (flowId=${results.flowId}, cases=${results.cases?.length})`);
    console.log(`  _loadFixture: smide state before load = ${win._smideState ?? '(unknown)'}`);
    win._testResults = results;
    if (results.servicesSource && win._reloadServicesFromSource) {
        console.log('  _loadFixture: reloading services from source…');
        await win._reloadServicesFromSource(results.servicesSource, `${results.flowId}-services.js`);
        console.log(`  _loadFixture: services reloaded | smide = ${win._smideState}`);
    }
    if (results.config && win._restartRuntime) {
        console.log('  _loadFixture: restarting runtime…');
        win._restartRuntime(results.config);
        console.log(`  _loadFixture: runtime restarted | smide = ${win._smideState}`);
    }
    // Reset pane offset and panel open states so saved uiPrefs don't affect measurements.
    win._resetPanePrefs?.();
    console.log('  _loadFixture: showing results drawer…');
    win._showResultsDrawer?.(results, win._replayTrace);
    console.log(`  _loadFixture: drawer shown | smide = ${win._smideState}`);
    console.log('  _loadFixture: setting smide state → results_ready');
    win._setSmideState?.('results_ready');
    console.log(`  _loadFixture: done | smide = ${win._smideState}`);
}

// Stable reference to the popup — avoids re-navigating it on repeated ui_full() calls.
// window.open(url, name) navigates the named window even when url is unchanged,
// which resets the page mid-test. Holding a direct reference and skipping
// window.open() on reuse prevents this.
let _uiTestPopup = null;

async function ui_full(mode, label = `${UI_FULL_W}x${UI_FULL_H}`) {
    const rightSize = () => window.innerWidth === UI_FULL_W && window.innerHeight === UI_FULL_H;

    if (!rightSize()) {
        let w;
        if (_uiTestPopup && !_uiTestPopup.closed) {
            w = _uiTestPopup;
            console.log('ℹ️  ui_full: reusing existing popup (no navigation)');
        } else {
            console.log(`🪟 ui_full: opening popup ${UI_FULL_W}×${UI_FULL_H} → ${APP_URL}`);
            w = window.open(APP_URL + '?_regression_test=1', 'ui-test', `width=${UI_FULL_W},height=${UI_FULL_H},left=100,top=100`);
            if (!w) { console.error('❌ Popup blocked — allow popups for this page and retry'); return null; }
            _uiTestPopup = w;
        }

        if (w.document.readyState !== 'complete') {
            console.log('⏳ ui_full: waiting for popup load event…');
            await new Promise(r => w.addEventListener('load', r, { once: true }));
            console.log('✅ ui_full: popup load event fired');
        }

        console.log('⏳ ui_full: waiting for app to boot (_restartRuntime + smide stable state)…');
        const TRANSIENT = ['render_ui', 'booting', 'restoring_flow'];
        const booted = await _waitFor(
            () => typeof w._restartRuntime === 'function' &&
                  typeof w._setSmideState  === 'function' &&
                  typeof w._smideState     === 'string'   &&
                  !TRANSIENT.includes(w._smideState),
            8000
        );
        if (!booted) {
            console.error('❌ App boot timeout — smide did not reach a stable state.', w._smideState ?? '(unknown)');
            console.info('   Check popup DevTools for module import errors.');
            return null;
        }
        console.log(`✅ ui_full: app booted | smide = ${w._smideState}`);

        console.log('⏳ ui_full: loading fixture (smide-test-results.json)…');
        try {
            await _loadFixture(w);
        } catch (e) {
            console.error('❌ _loadFixture failed:', e.message);
            return null;
        }
        console.log('✅ ui_full: fixture loaded');

        // Wait for the machine to settle into results_ready with all toolbar
        // buttons rendered (including Save Flow which is only visible here).
        console.log('⏳ ui_full: waiting for UI ready (#input-area controls)…');
        const ready = await _waitFor(
            () => !!w.document.querySelector('#input-area button, #input-area input'),
            8000
        );
        if (!ready) {
            console.error('❌ UI ready timeout — machine did not reach a stable state with #input-area controls.');
            console.info('   Current smide state:', w._smideState ?? '(unknown)');
            return null;
        }
        console.log('✅ ui_full: UI ready');

        // contracts._uiLowLevel is assigned at module evaluation time; by the time
        // the app has booted it must exist — but guard to give a clear error if not.
        if (typeof w.contracts?._uiLowLevel !== 'function') {
            console.error('❌ w.contracts._uiLowLevel is not a function — ui-contracts.js may not have loaded in the popup.');
            return null;
        }

        console.log(`▶️  contracts.ui: running _uiLowLevel('${mode ?? 'auto'}', '${label}') in popup…`);

        // Mirror the popup's console output into the caller's console so the
        // developer doesn't have to open the popup's DevTools to see results.
        const METHODS = ['log', 'warn', 'error', 'info', 'group', 'groupCollapsed', 'groupEnd'];
        const originals = {};
        for (const m of METHODS) {
            originals[m] = w.console[m];
            w.console[m] = (...args) => { originals[m].apply(w.console, args); console[m](...args); };
        }

        let result;
        try {
            result = await w.contracts._uiLowLevel(mode, label);
        } finally {
            for (const m of METHODS) w.console[m] = originals[m];
        }

        localStorage.removeItem('xstate-ide:regression-flow');
        return result;
    }

    // Already the right size — run in-place.
    console.log('ℹ️  ui_full: viewport is already 1024×768 — running in current window');
    console.log('⏳ ui_full: loading fixture…');
    try {
        await _loadFixture(window);
    } catch (e) {
        console.error('❌ _loadFixture failed:', e.message);
        return null;
    }
    console.log('✅ ui_full: fixture loaded');

    console.log('⏳ ui_full: waiting for UI ready…');
    const ready = await _waitFor(
        () => !!document.querySelector('#input-area button, #input-area input'),
        8000
    );
    if (!ready) {
        console.error('❌ UI ready timeout — machine did not reach a stable state with #input-area controls.');
        console.info('   Current smide state:', window._smideState ?? '(unknown)');
        return null;
    }
    console.log('✅ ui_full: UI ready');

    console.log(`▶️  contracts.ui: running ui_contracts('${mode ?? 'auto'}', '${label}')…`);
    const result = await ui_contracts(mode, label);
    localStorage.removeItem('xstate-ide:regression-flow');
    return result;
}

// ── Expose on window ──────────────────────────────────────────────────────────

window.contracts       = window.contracts       || {};
window.contracts.ui    = ui_full;
window.contracts._uiLowLevel = ui_contracts;  // low-level: pass explicit viewport label
