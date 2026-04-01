# Dialogflow Visualizer — Build Status Handoff

## Status: COMPLETE ✅ (v2 — context-aware traversal + layout improvements)

Single file: `dialogflow_visualizer.html` (~1250 lines)

---

## What Was Built

A self-contained single HTML file that:
- Accepts a Dialogflow ES agent export as a **.zip** (using JSZip from CDN) or as **individual unzipped files**
- Parses all agent files entirely in the browser (no server, no data leaves the machine)
- Runs the same context-aware graph traversal as `app.js` (the main repo's Node.js pipeline) — **ported and running fully in-browser**
- Renders an interactive **SVG flowchart** with BFS multi-column layout and a TD/LR direction toggle
- Provides a **dynamic chat simulator** that tracks active context state per turn
- Shows a **detail panel** with full intent metadata including computed "Reached From" / "Leads To" relationships
- Shows an **entities panel** with all custom entity definitions and entries
- Has a **help modal** with how-to steps and caveats

---

## Files

| File | Purpose |
|---|---|
| `dialogflow_visualizer.html` | The complete tool — open in any browser |
| `dialogflow_visualizer_plan.md` | Full build plan (updated to v2) |
| `handoff.md` | This document |
| `serenest_flow.html` | The original hardcoded SereNest visualization (earlier artifact, not maintained) |

---

## What Is Fully Implemented

### File Loading
- [x] ZIP upload via button
- [x] ZIP drag-and-drop onto drop zone
- [x] Individual file selection (multi-select)
- [x] Individual files drag-and-drop
- [x] JSZip CDN: `https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js`
- [x] File classification by path pattern (agent, package, entity-def, entity-entries, intent, fallback-intent, usersays)
- [x] "Load New Agent" resets to drop zone (resets layout direction)

### Parsing
- [x] `agent.json` → displayName, language, timezone, mlMinConfidence
- [x] `package.json` → version
- [x] `entities/*.json` → entity definition (isRegexp, isEnum, automatedExpansion)
- [x] `entities/*_entries_en.json` → entries/patterns matched to entity def
- [x] `intents/*.json` → full intent parsing (contexts, affectedContexts, parameters, messages type 0 and type 4, quickReplies, webhookUsed, events, parentId)
- [x] `intents/* - fallback.json` → fallback intent parsing with parentId linking
- [x] `intents/*_usersays_en.json` → training phrases matched to intent by name

### Graph Construction (ported from app.js)
- [x] **Context index** (`buildCtxIndex`) — maps each context name to producer/consumer intent sets
- [x] **Active context state** (`getActiveCtxState`) — lifespan decrement + output context application per turn
- [x] **Matching intent finder** (`findMatchingIntents`) — intersection requirement: ALL input contexts must be active
- [x] **Traversal with cycle detection** (`computeEdgesAndRelationships`) — DFS from root intents; cycle key: `"parent->child[ctx1,ctx2,...]"`; populates `inputIntents`, `outputIntents`, `hasOperatorRequest` on each intent
- [x] Fallback edges via `parentId` linkage (dashed amber)
- [x] Node type detection: start, question, data, fallback, global_fallback, end

### Layout
- [x] BFS level assignment using computed `outputIntents` — branches get separate columns
- [x] **Top-Down mode** (default) — level → Y, siblings spread on X, fallbacks offset right
- [x] **Left-Right mode** — level → X, siblings spread on Y, fallbacks offset below
- [x] **Layout direction toggle** in toolbar: "↕ Top-Down" / "↔ Left-Right" — re-layouts without re-parsing
- [x] Fallback nodes positioned relative to parent (not placed in BFS levels)
- [x] Unvisited non-fallback nodes placed at the end to avoid them disappearing

### SVG Renderer
- [x] Colour-coded nodes with shadow, icon, wrapped label
- [x] Bezier curve edges (vertical for TD, handles for offset nodes)
- [x] Arrowheads (solid for happy path, dashed amber for fallback)
- [x] Edge labels (quick replies or context name, truncated)
- [x] Pan (canvas drag), zoom (scroll wheel cursor-anchored + toolbar buttons), fit view
- [x] Node hover and selected (click) visual states

### Detail Panel
- [x] Slides in from right on node click
- [x] Type badge, bot message, quick replies, input/output contexts with lifespans
- [x] Parameters table: name / entity type / required
- [x] Training phrases (up to 15)
- [x] Action, webhook flags, parent intent, events
- [x] **Reached From** — computed `inputIntents` list
- [x] **Leads To** — computed `outputIntents` list
- [x] **Operator Handoff** badge — when intent sets `operator_request` context

### Entities Panel
- [x] All custom entities: name, type (regexp/synonym/enum), entries
- [x] Regexp entries shown as `/pattern/`
- [x] System entities referenced in intents listed separately
- [x] Toggled from toolbar

### Simulator
- [x] Dynamic, context-state-driven (not a pre-computed linear path)
- [x] Tracks `simCurrentIntentId` and `simActiveCtx` per turn
- [x] Starts at WELCOME-event intent
- [x] Highlights active node on canvas
- [x] Quick reply buttons rendered
- [x] **Format hints only** — no validation gate; user input always advances the flow
  - Hints appear when the current intent has a parameter with a known entity type
  - Hint is shown immediately when the intent is presented (not after send)
  - Hint persists until a terminal state (end / no match)
- [x] **↩ Fallback button** — shown when current intent has a fallback child; click to preview the fallback message without advancing the conversation state
- [x] Draggable: grab the header bar to reposition the chat widget
- [x] Restart button
- [x] System messages: "Conversation started / ended / No matching intent found / fallback triggered"

### Help Modal
- [x] How to export from Dialogflow (steps)
- [x] How to use the tool (steps)
- [x] 12 caveats/limitations with coloured badges
- [x] Dismiss by button or backdrop click

---

## Architecture

```
G (global state object)
├── agent       — parsed agent.json metadata
├── pkg         — parsed package.json version
├── entities    — { name → { def, entries[] } }
├── intents     — { id → intent object }
│                   intent.inputIntents  — computed: names of intents that lead here
│                   intent.outputIntents — computed: names of intents this leads to
│                   intent.hasOperatorRequest — computed: sets operator_request context
├── ctxIndex    — { ctxName → { input: Set<intentName>, output: Set<intentName> } }
├── nodes       — [ { id, label, type, x, y } ]
└── edges       — [ { from, to, label, dashed } ]

let layoutDir = 'TD'  // 'TD' | 'LR'
let simCurrentIntentId = null
let simActiveCtx = {}  // { ctxName: lifespan }

Key functions:
  classifyPath(path)              → file type string
  parseAgent / parsePkg / parseEntityDef / parseEntityEntries / parseIntent / attachUsersays
  processFileMap(fileMap)         → runs all parsers, populates G
  loadZip(file)                   → JSZip → processFileMap
  loadFiles(files)                → FileReader → processFileMap
  buildCtxIndex()                 → populates G.ctxIndex
  getActiveCtxState(ctx, intent)  → next ctx after intent fires (lifespan decrement + outputs)
  findMatchingIntents(activeCtx)  → non-fallback intents whose ALL inputs are active
  computeEdgesAndRelationships()  → DFS traversal; populates inputIntents/outputIntents; returns edges[]
  buildGraph()                    → calls buildCtxIndex + computeEdgesAndRelationships + layout
  detectType(intent)              → 'start'|'question'|'data'|'fallback'|'global_fallback'|'end'
  layout(nodeById)                → BFS level assignment + TD/LR coordinate assignment
  renderSVG()                     → clears + redraws entire SVG
  fitView()                       → scales SVG to fill canvas-wrap
  showDetail(nodeId)              → populates + opens detail panel
  buildEntitiesPanel()            → populates entities panel
  mkHint(dataType)                → returns format hint string (no validation)
  simFindNext()                   → next matching intent given simActiveCtx (most specific wins)
  simFindFallback(intentId)       → fallback child of given intent via dashed edge, or null
  simPresentIntent(intent)        → updates simCurrentIntentId + simActiveCtx, shows bot message
  simHandle(text)                 → processes user input, calls simContinue
  simContinue()                   → advances to next intent or shows terminal message
  startSim()                      → resets state and presents WELCOME intent
  launchApp()                     → calls buildGraph, updateHeader, renderSVG, buildEntitiesPanel, fitView
```

---

## Known Gaps / Possible Future Enhancements

1. **Drag to reposition nodes** — add mousedown/mousemove/mouseup on nodes, update x/y, re-render edges only
2. **Cyclic context loop detection** — DFS on edge graph, mark back-edges, style differently
3. **Rich response types** — type 1 (card), type 2, type 3 (image) show placeholder; extend `parseIntent` + `showDetail`
4. **Dialogflow CX** — needs separate parser branch for `flows/`, `pages/` schema
5. **Multi-language usersays** — only `_usersays_en.json` parsed
6. **Conditional responses** — `conditionalResponses` shown in detail panel but not acted on
7. **Knowledge base** — `enabledKnowledgeBaseNames` ignored
8. **Webhook simulation** — static text only
9. **Mini-map** — no overview thumbnail
10. **Export as PNG/SVG** — use canvas + drawImage on SVG blob URL
11. **Followup context skipping** — `app.js` skips contexts ending in `-followup`; dfviz does not; minor edge difference for agents using Dialogflow built-in followup intents

---

## Test Agent

The SereNest agent (`serenest_services_df.zip`) was used as the primary test case. It has:
- 1 Welcome intent (start node)
- 1 Global Fallback intent
- 5 main data-collection intents
- 4 fallback child intents
- 1 custom entity (`name_regex`, regexp type)
- Context chain: welcome → security_usage → security_history → install_address → customer_name → customer_phone → customer_email

This exercises all node types, all edge types, the BFS multi-column layout, the dynamic simulator, and the custom entity hint path.

---

## How to Resume in Another Thread

Share with Claude:
1. This handoff document (`handoff.md`)
2. The plan (`dialogflow_visualizer_plan.md`)
3. The current HTML file (`dialogflow_visualizer.html`)

Then say: **"Here is the current state of the Dialogflow Visualizer. Please [enhancement/fix]."**

### Suggested resume prompts:

- **"Add drag-to-reposition nodes"** → add mousedown/mousemove/mouseup on `.node` elements; update `n.x`, `n.y`; re-render only edges on drag, full render on mouseup
- **"Support type 1 card responses"** → extend `parseIntent` message loop and `showDetail` rendering for `m.type === '1'`
- **"Add a PNG export button"** → create `<canvas>`, draw SVG blob URL via `drawImage`, trigger download
- **"Add a mini-map"** → small fixed `<canvas>` in corner, re-render at small scale on graph change
- **"Detect and highlight cyclic flows"** → DFS on edge graph, mark back-edges, style with a different colour
- **"Skip -followup contexts in traversal"** → add `if(ctx.endsWith('-followup')) continue;` in `findMatchingIntents` to match app.js behaviour
