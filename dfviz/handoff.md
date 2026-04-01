# Dialogflow Visualizer — Build Status Handoff

## Status: COMPLETE ✅

The tool has been fully built and delivered as a single file:
`dialogflow_visualizer.html`

---

## What Was Built

A self-contained single HTML file (~580 lines) that:
- Accepts a Dialogflow ES agent export as a **.zip** (using JSZip from CDN) or as **individual unzipped files**
- Parses all agent files entirely in the browser (no server, no data leaves the machine)
- Renders an interactive **SVG flowchart** of the conversation
- Provides a **chat simulator** that walks the flow step by step
- Shows a **detail panel** with full intent metadata on node click
- Shows an **entities panel** with all custom entity definitions and entries
- Has a **help modal** with how-to steps and caveats

---

## Files Delivered

| File | Purpose |
|---|---|
| `dialogflow_visualizer.html` | The complete tool — open in any browser |
| `dialogflow_visualizer_plan.md` | Full original build plan |
| `serenest_flow.html` | The original hardcoded SereNest visualization (earlier artifact) |

---

## What Is Fully Implemented

### File Loading
- [x] ZIP upload via button
- [x] ZIP drag-and-drop onto drop zone
- [x] Individual file selection (multi-select)
- [x] Individual files drag-and-drop
- [x] JSZip CDN: `https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js`
- [x] File classification by path pattern (agent, package, entity-def, entity-entries, intent, fallback-intent, usersays)
- [x] "Load New Agent" resets to drop zone

### Parsing
- [x] `agent.json` → displayName, language, timezone, mlMinConfidence
- [x] `package.json` → version
- [x] `entities/*.json` → entity definition (isRegexp, isEnum)
- [x] `entities/*_entries_en.json` → entries/patterns matched to entity def
- [x] `intents/*.json` → full intent parsing (contexts, affectedContexts, parameters, messages type 0 and type 4, quickReplies, webhookUsed, events, parentId)
- [x] `intents/* - fallback.json` → fallback intent parsing with parentId linking
- [x] `intents/*_usersays_en.json` → training phrases matched to intent by name

### Graph
- [x] Node type detection: start, question, data, fallback, global_fallback, end
- [x] Edge construction via context chain matching + parentId fallback linking
- [x] BFS topological layout (happy path vertical, fallbacks offset right)
- [x] SVG rendering: colour-coded nodes, shadow, icon, wrapped label
- [x] Arrowheads (solid for happy path, dashed amber for fallback)
- [x] Edge labels (quick replies or context name)
- [x] Pan (drag), zoom (scroll + buttons), fit view

### Detail Panel
- [x] Slides in from right on node click
- [x] Shows: type badge, bot message, quick replies, input/output contexts with lifespans, parameters table, training phrases (up to 15), action, webhook flags, parent intent, events
- [x] Node highlights (selected state) on click

### Entities Panel
- [x] Lists all custom entities with type, entries, and which intents reference them
- [x] Regexp entries shown as `/pattern/`
- [x] System entities referenced in intents listed separately
- [x] Toggled from toolbar

### Simulator
- [x] Walks happy path from start node
- [x] Highlights active node on canvas
- [x] Quick reply buttons rendered
- [x] Validation per entity type:
  - `@sys.email` → `/\S+@\S+\.\S+/`
  - `@sys.phone-number` → `/[\d\s\-\+\(\)]{7,}/`
  - `@sys.number` → `/\d+/`
  - `@sys.given-name` → any non-empty string
  - `@sys.any` → always passes
  - Custom regexp entity → uses actual pattern from `_entries_en.json`
  - Custom synonym entity → checks input against synonym list
- [x] On validation failure: shows fallback message, highlights fallback node
- [x] Restart button
- [x] Conversation ended message at end node

### Help Modal
- [x] How to export from Dialogflow (steps)
- [x] How to use the tool (steps)
- [x] 12 caveats/limitations with coloured badges
- [x] Dismiss by button or backdrop click

---

## Known Gaps / Possible Future Enhancements

These were documented in the plan as out of scope for v1:

1. **Drag to reposition nodes** — layout is fixed; complex agents may have overlapping edges
2. **Cyclic context loop detection** — loops are not detected and may render strangely
3. **Rich response types** — type 1 (card), type 2 (quick reply list), type 3 (image) show no special rendering
4. **Dialogflow CX support** — CX uses a completely different export schema
5. **Multi-language usersays** — only `_usersays_en.json` files parsed
6. **Conditional responses** — `conditionalResponses` array not evaluated
7. **Knowledge base** — `enabledKnowledgeBaseNames` ignored
8. **Webhook simulation** — static text only, webhook not called
9. **Mini-map** — no overview thumbnail for large agents
10. **Export as PNG/SVG** — no download of the rendered graph

---

## How to Resume in Another Thread

Share with Claude:
1. This handoff document (`handoff.md`)
2. The plan (`dialogflow_visualizer_plan.md`)
3. The current HTML file (`dialogflow_visualizer.html`)

Then say: **"Here is the current state of the Dialogflow Visualizer. Please [enhancement/fix]."**

### Suggested resume prompts for enhancements:

- **"Add drag-to-reposition nodes"** → add mousedown/mousemove/mouseup on nodes, update x/y, re-render edges only
- **"Support type 1 card responses in detail panel"** → extend `parseIntent` message loop and `showDetail` rendering
- **"Add a PNG export button"** → use `canvas` element + `drawImage` on SVG blob URL
- **"Add a mini-map"** → small fixed `<canvas>` in corner, re-render at small scale on graph change
- **"Detect and highlight cyclic flows"** → DFS on edge graph, mark back-edges, style them differently
- **"Support Dialogflow CX export format"** → CX uses `flows/`, `pages/`, `intents/` with different schema; needs separate parser branch

---

## Architecture Summary (for a new Claude to understand the code)

```
G (global state object)
├── agent       — parsed agent.json metadata
├── pkg         — parsed package.json version
├── entities    — { name → { def, entries[] } }
├── intents     — { id → intent object }
├── nodes       — [ { id, label, type, x, y } ]
├── edges       — [ { from, to, label, dashed } ]
└── simFlow     — [ { nodeId, botText, quickReplies, validator, fallbackText, fallbackNodeId } ]

Key functions:
  classifyPath(path)         → file type string
  parseAgent / parsePkg / parseEntityDef / parseEntityEntries / parseIntent / attachUsersays
  processFileMap(fileMap)    → runs all parsers, populates G
  loadZip(file)              → JSZip → processFileMap
  loadFiles(files)           → FileReader → processFileMap
  buildGraph()               → populates G.nodes + G.edges
  detectType(intent)         → 'start'|'question'|'data'|'fallback'|'global_fallback'|'end'
  layout(nodeById)           → assigns x,y to each node
  renderSVG()                → clears + redraws entire SVG
  showDetail(nodeId)         → populates + opens detail panel
  buildEntitiesPanel()       → populates entities panel
  buildSimFlow()             → builds G.simFlow ordered walk
  mkValidator(dataType)      → returns v=>boolean function
  simStep(idx)               → advances simulator to step idx
  simHandle(text)            → processes user input
  launchApp()                → calls all of the above in sequence
```

---

## Test Agent

The SereNest agent (`serenest_services_df.zip`) was used as the primary test case during development. It has:
- 1 Welcome intent
- 1 Global Fallback intent
- 5 main data-collection intents
- 4 fallback child intents
- 1 custom entity (`name_regex`, regexp type)
- Context chain: welcome → security_usage → security_history → install_address → customer_name → customer_phone → customer_email

This exercises all node types, all edge types, and the custom entity validator path.
