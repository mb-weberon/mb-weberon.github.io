/**
 * analyze-flow.js
 *
 * Static analysis of an XState v5 machine config (JSON form).
 * No runtime execution — pure graph inspection.
 *
 * Checks:
 *   1. Unreachable states       — states never reachable from config.initial
 *   2. Guard gaps               — transition arrays where every branch has a guard
 *                                 (no fallthrough → silent miss if all guards false)
 *   3. Dead transitions         — branches shadowed by an earlier unguarded branch
 *   4. Unresolved guards        — guard names referenced in the machine but absent
 *                                 from the loaded services (when services are available)
 *   5. Missing event handlers   — reachable interactive states that omit events
 *                                 handled by other reachable states (info-level)
 *
 * Usage:
 *   window.analyzeFlow()         — analyze the currently loaded flow
 *   window._analysisReport       — last report object
 */

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Normalize any XState transition value to an array of branch objects. */
function normalizeBranches(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') return [{ target: val }];
    return [val];
}

/** Extract all target IDs from an already-normalised branch array. */
function targetsOf(branches) {
    return branches.flatMap(b => (b.target ? [b.target] : []));
}

/** Return all outbound target IDs from a single state definition. */
function outboundTargets(stateDef) {
    const targets = [];
    if (stateDef.on) {
        for (const val of Object.values(stateDef.on)) {
            targets.push(...targetsOf(normalizeBranches(val)));
        }
    }
    if (stateDef.always) {
        targets.push(...targetsOf(normalizeBranches(stateDef.always)));
    }
    if (stateDef.invoke) {
        if (stateDef.invoke.onDone)  targets.push(...targetsOf(normalizeBranches(stateDef.invoke.onDone)));
        if (stateDef.invoke.onError) targets.push(...targetsOf(normalizeBranches(stateDef.invoke.onError)));
    }
    return targets;
}

/** True when a state is a routing/passthrough state (only `always`, no `on`). */
function isPassthrough(stateDef) {
    return !!stateDef.always && !stateDef.on;
}

/** True when a state is purely invoke-driven (only `invoke`, no `on`). */
function isInvokeOnly(stateDef) {
    return !!stateDef.invoke && !stateDef.on && !stateDef.always;
}

// ── Check 1: Reachability ─────────────────────────────────────────────────────

function collectReachableStates(config) {
    const allStateIds  = Object.keys(config.states || {});
    const visited      = new Set();
    const queue        = [config.initial];

    while (queue.length) {
        const id = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);

        const stateDef = config.states[id];
        if (!stateDef) continue;   // dangling target — reported as dead transition

        for (const target of outboundTargets(stateDef)) {
            if (!visited.has(target)) queue.push(target);
        }
    }

    const unreachable = allStateIds.filter(id => !visited.has(id));
    return { reachable: visited, unreachable };
}

// ── Check 2: Guard gaps ───────────────────────────────────────────────────────

/**
 * Return source descriptors for all guarded-only branch arrays in a state.
 * A "guard gap" exists when every branch in an array carries a `guard`,
 * leaving no fallthrough: if all guards fail the event is silently swallowed
 * (or, for `always`, the machine stalls).
 */
function guardGapsForState(stateId, stateDef) {
    const gaps = [];

    function checkArray(branches, source) {
        if (branches.length === 0) return;
        const allGuarded = branches.every(b => !!b.guard);
        if (allGuarded) {
            gaps.push({
                stateId,
                source,
                guardNames: branches.map(b => b.guard),
            });
        }
    }

    if (stateDef.on) {
        for (const [event, val] of Object.entries(stateDef.on)) {
            const branches = normalizeBranches(val);
            checkArray(branches, `on.${event}`);
        }
    }
    if (stateDef.always) {
        checkArray(normalizeBranches(stateDef.always), 'always');
    }
    if (stateDef.invoke) {
        if (stateDef.invoke.onDone) {
            checkArray(normalizeBranches(stateDef.invoke.onDone), 'invoke.onDone');
        }
        if (stateDef.invoke.onError) {
            checkArray(normalizeBranches(stateDef.invoke.onError), 'invoke.onError');
        }
    }

    return gaps;
}

function findGuardGaps(config, reachable) {
    const findings = [];
    for (const stateId of reachable) {
        const stateDef = config.states[stateId];
        if (!stateDef) continue;
        for (const gap of guardGapsForState(stateId, stateDef)) {
            findings.push(gap);
        }
    }
    return findings;
}

// ── Check 3: Dead transitions ─────────────────────────────────────────────────

/**
 * Within each branch array, find branches that can never fire because an
 * earlier unguarded branch already matches unconditionally (shadowing).
 */
function findDeadTransitions(config, reachable) {
    const findings = [];

    function checkArray(branches, stateId, source) {
        for (let i = 0; i < branches.length; i++) {
            if (!branches[i].guard) {
                // Unguarded branch — any branch AFTER this is shadowed
                for (let j = i + 1; j < branches.length; j++) {
                    findings.push({
                        stateId,
                        source,
                        branchIndex: j,
                        reason: 'shadowed',
                        message: `${stateId} › ${source} branch[${j}] is unreachable — shadowed by unguarded branch[${i}]`,
                    });
                }
                break;   // stop scanning after first unguarded branch
            }
        }
    }

    for (const stateId of reachable) {
        const stateDef = config.states[stateId];
        if (!stateDef) continue;

        if (stateDef.on) {
            for (const [event, val] of Object.entries(stateDef.on)) {
                checkArray(normalizeBranches(val), stateId, `on.${event}`);
            }
        }
        if (stateDef.always) {
            checkArray(normalizeBranches(stateDef.always), stateId, 'always');
        }
        if (stateDef.invoke) {
            if (stateDef.invoke.onDone)  checkArray(normalizeBranches(stateDef.invoke.onDone),  stateId, 'invoke.onDone');
            if (stateDef.invoke.onError) checkArray(normalizeBranches(stateDef.invoke.onError), stateId, 'invoke.onError');
        }
    }

    return findings;
}

// ── Check 4: Unresolved guard names ──────────────────────────────────────────

/**
 * Collect all guard name strings referenced in the machine, then compare
 * against the set of guard names provided by the loaded services.
 * Only reported when services are available (knownGuards.size > 0).
 */
function findUnresolvedGuards(config, reachable, knownGuards) {
    if (!knownGuards || knownGuards.size === 0) return [];

    const findings = [];
    const seen     = new Set();  // avoid duplicate guard-name reports

    function checkBranches(branches, stateId, source) {
        for (let i = 0; i < branches.length; i++) {
            const g = branches[i].guard;
            if (g && typeof g === 'string' && !knownGuards.has(g) && !seen.has(g)) {
                seen.add(g);
                findings.push({
                    stateId,
                    source,
                    branchIndex: i,
                    guardName: g,
                    message: `Guard '${g}' (used in ${stateId} › ${source}) has no implementation in the loaded services`,
                });
            }
        }
    }

    for (const stateId of reachable) {
        const stateDef = config.states[stateId];
        if (!stateDef) continue;

        if (stateDef.on) {
            for (const [event, val] of Object.entries(stateDef.on)) {
                checkBranches(normalizeBranches(val), stateId, `on.${event}`);
            }
        }
        if (stateDef.always) {
            checkBranches(normalizeBranches(stateDef.always), stateId, 'always');
        }
        if (stateDef.invoke) {
            if (stateDef.invoke.onDone)  checkBranches(normalizeBranches(stateDef.invoke.onDone),  stateId, 'invoke.onDone');
            if (stateDef.invoke.onError) checkBranches(normalizeBranches(stateDef.invoke.onError), stateId, 'invoke.onError');
        }
    }

    return findings;
}

// ── Check 5: Missing event handlers ──────────────────────────────────────────

/**
 * For each reachable, interactive (non-final, non-passthrough, non-invoke-only) state
 * that has at least one event handler, report events it doesn't handle that other
 * reachable interactive states do handle.
 *
 * Severity: info — often intentional, but useful when a global event (e.g. CANCEL)
 * is handled in most states but accidentally omitted in one.
 */
function findMissingHandlers(config, reachable, allEvents) {
    const findings = [];

    for (const stateId of reachable) {
        const stateDef = config.states[stateId];
        if (!stateDef) continue;
        if (stateDef.type === 'final') continue;
        if (isPassthrough(stateDef)) continue;
        if (isInvokeOnly(stateDef)) continue;
        if (!stateDef.on) continue;   // no event handlers at all — skip (not an omission)

        const handled = new Set(Object.keys(stateDef.on));
        const missing = [...allEvents].filter(e => !handled.has(e));
        if (missing.length > 0) {
            findings.push({ stateId, missing });
        }
    }

    return findings;
}

// ── Build report ──────────────────────────────────────────────────────────────

function buildReport(config, reachabilityResult, guardGaps, deadTransitions, unresolvedGuards, missingHandlers) {
    const findings = [];

    // Unreachable states → error
    for (const stateId of reachabilityResult.unreachable) {
        findings.push({
            severity: 'error',
            type:     'unreachable_state',
            stateId,
            message:  `State '${stateId}' is unreachable from the initial state '${config.initial}'`,
            detail:   { stateId },
        });
    }

    // Guard gaps → warn
    for (const gap of guardGaps) {
        findings.push({
            severity: 'warn',
            type:     'guard_gap',
            stateId:  gap.stateId,
            message:  `${gap.stateId} › ${gap.source}: all ${gap.guardNames.length} branch(es) are guarded — no fallthrough (silent miss if all guards fail)`,
            detail:   gap,
        });
    }

    // Dead transitions → error
    for (const dt of deadTransitions) {
        findings.push({
            severity: 'error',
            type:     'dead_transition',
            stateId:  dt.stateId,
            message:  dt.message,
            detail:   dt,
        });
    }

    // Unresolved guards → warn
    for (const ug of unresolvedGuards) {
        findings.push({
            severity: 'warn',
            type:     'unresolved_guard',
            stateId:  ug.stateId,
            message:  ug.message,
            detail:   ug,
        });
    }

    // Missing handlers → info
    for (const mh of missingHandlers) {
        findings.push({
            severity: 'info',
            type:     'missing_handler',
            stateId:  mh.stateId,
            message:  `${mh.stateId} does not handle: ${mh.missing.join(', ')}`,
            detail:   mh,
        });
    }

    // Sort: errors → warns → info; within each, alphabetically by stateId
    const order = { error: 0, warn: 1, info: 2 };
    findings.sort((a, b) =>
        order[a.severity] - order[b.severity] ||
        a.stateId.localeCompare(b.stateId)
    );

    const totalStates     = Object.keys(config.states || {}).length;
    const reachableStates = reachabilityResult.reachable.size;

    return {
        flowId:      config.id || '(unknown)',
        analyzedAt:  new Date().toISOString(),
        counts: {
            totalStates,
            reachableStates,
            unreachableStates: reachabilityResult.unreachable.length,
            guardGaps:         guardGaps.length,
            deadTransitions:   deadTransitions.length,
            unresolvedGuards:  unresolvedGuards.length,
            missingHandlers:   missingHandlers.length,
        },
        findings,
    };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * analyzeFlow(config, services?)
 *
 * Runs all static-analysis checks on a machine config object.
 * Logs a grouped report to the console and returns the report.
 * Also stores the report in window._analysisReport.
 *
 * @param {object} config   — XState v5 machine config (from _config / machine JSON)
 * @param {object} services — optional services object; its `.guards` keys are used
 *                            to detect unresolved guard names
 * @returns {object} report
 */
export function analyzeFlow(config, services = {}) {
    if (!config || !config.states) {
        console.warn('⚠️  analyzeFlow: no machine config provided');
        return null;
    }

    const knownGuards = new Set(Object.keys(services?.guards ?? {}));

    const reachabilityResult  = collectReachableStates(config);
    const { reachable }       = reachabilityResult;

    // Collect all events handled by any reachable state (for missing-handler check)
    const allEvents = new Set();
    for (const stateId of reachable) {
        const stateDef = config.states[stateId];
        if (stateDef?.on) {
            for (const event of Object.keys(stateDef.on)) {
                allEvents.add(event);
            }
        }
    }

    const guardGaps         = findGuardGaps(config, reachable);
    const deadTransitions   = findDeadTransitions(config, reachable);
    const unresolvedGuards  = findUnresolvedGuards(config, reachable, knownGuards);
    const missingHandlers   = findMissingHandlers(config, reachable, allEvents);

    const report = buildReport(config, reachabilityResult, guardGaps, deadTransitions, unresolvedGuards, missingHandlers);

    // ── Console output ────────────────────────────────────────────────────────
    const { counts } = report;
    const errors = report.findings.filter(f => f.severity === 'error');
    const warns  = report.findings.filter(f => f.severity === 'warn');
    const infos  = report.findings.filter(f => f.severity === 'info');

    console.group(`🔍 Static Analysis: ${report.flowId}  (${counts.reachableStates}/${counts.totalStates} states reachable)`);

    if (errors.length) {
        console.group(`❌ Errors (${errors.length})`);
        errors.forEach(f => console.error(f.message, f.detail));
        console.groupEnd();
    }
    if (warns.length) {
        console.group(`⚠️  Warnings (${warns.length})`);
        warns.forEach(f => console.warn(f.message, f.detail));
        console.groupEnd();
    }
    if (infos.length) {
        console.group(`ℹ️  Info (${infos.length})`);
        infos.forEach(f => console.log(f.message, f.detail));
        console.groupEnd();
    }
    if (!report.findings.length) {
        console.log('✅ No issues found');
    }

    console.log('💾 Full report → window._analysisReport');
    console.groupEnd();

    window._analysisReport = report;

    // ── Toast summary ─────────────────────────────────────────────────────────
    const errCount  = errors.length;
    const warnCount = warns.length;
    if (errCount === 0 && warnCount === 0) {
        window.showToast?.(`🔍 ${report.flowId}: no issues found`, 'info');
    } else {
        const parts = [];
        if (errCount)  parts.push(`${errCount} error${errCount  > 1 ? 's' : ''}`);
        if (warnCount) parts.push(`${warnCount} warning${warnCount > 1 ? 's' : ''}`);
        const type = errCount > 0 ? 'error' : 'warn';
        window.showToast?.(`🔍 ${report.flowId}: ${parts.join(', ')} — see console`, type);
    }

    return report;
}
