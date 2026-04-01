# Dialogflow Conversation Flow Visualizer — Full Build Plan (v2)

## Overview

A single, self-contained HTML file that accepts a Dialogflow agent export (as a `.zip` or individual files), parses all intents and entities, and renders an interactive flowchart with a built-in chat simulator. No server, no install, no dependencies beyond what is loaded from a CDN.

---

## Target Dialogflow Export Structure

```
<agent_root>/
├── package.json                                  ← agent version metadata
├── agent.json                                    ← agent config (name, language, timezone, mlMinConfidence)
├── entities/
│   ├── <entity_name>.json                        ← entity definition (isRegexp, isEnum etc.)
│   └── <entity_name>_entries_en.json             ← actual regex patterns or synonym entries
└── intents/
    ├── Default Welcome Intent.json               ← main intent
    ├── Default Welcome Intent_usersays_en.json   ← training phrases
    ├── Default Fallback Intent.json              ← global fallback
    ├── ans_*.json                                ← main intents (happy path)
    ├── ans_* - fallback.json                     ← fallback child intents
    └── ans_*_usersays_en.json                    ← training phrases per intent
```

---

## File Input Methods

The tool accepts **both** input modes from the same drop zone:

### Mode 1 — ZIP Upload
- User drops or selects the raw Dialogflow `.zip` export
- **JSZip** (cdnjs, v3.10.1) unzips it entirely in the browser (client-side, no server)
- Each zip entry path is classified using the same logic as Mode 2
- CDN URL: `https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js`

### Mode 2 — Individual Files
- User multi-selects or drags all files from the unzipped folder
- Files from subdirectories (`entities/`, `intents/`) must be included
- Browser `File` objects are classified by filename pattern

---

## Step 1 — File Classification

After loading (from zip or direct), every file is classified by matching its path/name:

| Pattern | Classification |
|---|---|
| `agent.json` | Agent metadata |
| `package.json` | Package/version info |
| `entities/*.json` (not `_entries_`) | Entity definition |
| `entities/*_entries_en.json` | Entity values / regex patterns |
| `intents/*_usersays_en.json` | Training phrases |
| `intents/* - fallback.json` | Fallback child intent |
| `intents/*.json` (none of above) | Main intent |

Classification is done by simple string matching on the file path — no assumptions about folder depth.

---

## Step 2 — Parsing

### Agent Metadata (`agent.json`)
Extract:
- `displayName` → shown in header
- `defaultTimezone`
- `mlMinConfidence` → shown in header
- `language`

### Package Info (`package.json`)
Extract:
- `version` → shown in header

### Entity Definitions (`entities/<name>.json`)
Extract:
- `name`
- `isRegexp` (boolean) → if true, entries are regex patterns
- `isEnum` (boolean)
- `automatedExpansion`

### Entity Entries (`entities/<name>_entries_en.json`)
Extract:
- Array of `{ value, synonyms }` entries
- If `isRegexp: true`, `value` is the regex pattern string

### Main Intents (`intents/<name>.json`)
Extract per intent:
- `id`, `name`
- `auto` (ML enabled)
- `contexts` → input contexts (array of strings)
- `responses[0].affectedContexts` → output contexts `[{ name, lifespan }]`
- `responses[0].action`
- `responses[0].parameters` → `[{ name, dataType, required, value }]`
- `responses[0].messages` → bot responses:
  - `type: "0"` → plain text (`speech` array)
  - `type: "4"` → custom payload (`payload.text`, `payload.quick_replies`)
- `webhookUsed`
- `webhookForSlotFilling`
- `fallbackIntent` (boolean)
- `events` → e.g. `[{ name: "WELCOME" }]`
- `priority`
- `parentId` / `rootParentId` → links fallback to parent intent

### Fallback Intents (`intents/* - fallback.json`)
Same fields as main intent, plus `parentId` and `rootParentId` are always set.

### Training Phrases (`intents/<name>_usersays_en.json`)
Match to intent by stripping `_usersays_en` suffix from filename and finding the intent with matching name.

Extract per entry:
- `data[]` array — concatenate `text` fields to form the full phrase

---

## Step 3 — Context Index & Graph Construction

### 3.1 Context Index (`buildCtxIndex`)
Builds `G.ctxIndex`: maps each context name to the sets of intents that consume it (input) and produce it (output).

### 3.2 Active Context State (`getActiveCtxState`)
Given a `{ ctxName: lifespan }` map and a fired intent:
- Decrement all current lifespans by 1, remove expired (lifespan ≤ 0)
- Apply the intent's `affectedContexts`, overwriting with the higher lifespan if already present

### 3.3 Matching Intents (`findMatchingIntents`)
Returns non-fallback intents whose **every** input context is currently active (intersection requirement). Intents with no input contexts (roots) are excluded here and seeded separately.

### 3.4 Edge & Relationship Computation (`computeEdgesAndRelationships`)
BFS/DFS traversal from all root intents (no input contexts, non-fallback):

```
for each root intent:
  traverse(intentName, parentName=null, activeCtx={})
    → record edge parent→intent
    → compute newCtx = getActiveCtxState(activeCtx, intent)
    → for each next = findMatchingIntents(newCtx): recurse
```

Cycle detection key: `"parentName->intentName[ctx1,ctx2,...]"` — same two intents can connect via different context states, but the exact same `(parent, child, activeCtx)` triple is only traversed once.

Populates on each intent:
- `intent.inputIntents` — names of intents that lead to this one
- `intent.outputIntents` — names of intents this leads to
- `intent.hasOperatorRequest` — true if `affectedContexts` contains `operator_request`

Fallback edges added separately via `parentId` linkage (dashed amber edges).

### 3.5 Node Type Detection
| Condition | Type |
|---|---|
| Has `events: [{ name: "WELCOME" }]` | `start` |
| `fallbackIntent: true` and no `parentId` | `global_fallback` |
| `fallbackIntent: true` and has `parentId` | `fallback` |
| Output contexts lead to no other intent | `end` |
| Has parameters | `data` |
| Everything else | `question` |

### 3.6 Layout Algorithm
BFS level assignment using computed `outputIntents`, with two direction modes:

**Top-Down (TD)** — default:
- Level drives Y (Y0=70, DY=160px)
- Nodes within a level spread on X (centred at CX=420, DX=240px between siblings)
- Fallback nodes: offset right of parent (FB_DX=260px), same Y

**Left-Right (LR)**:
- Level drives X (X0=80, DX=260px)
- Nodes within a level spread on Y (centred at CY=300, DY=160px)
- Fallback nodes: below parent (FB_DY=160px), same X

User can toggle between TD and LR via the toolbar button without re-parsing.

---

## Step 4 — UI Components

### 4.1 Drop Zone (initial screen)
- Large centred drop target
- Accepts `.zip` file OR multi-file selection
- Two labelled buttons: "Upload ZIP" and "Select Unzipped Files"
- Drag-over highlight state
- On load: parse files, transition to flow view
- Error display if files are invalid

### 4.2 Header
- Agent `displayName`
- Language, timezone, version, ML confidence threshold
- "Load New Agent" button → resets to drop zone (resets `layoutDir` to TD)

### 4.3 Toolbar
- Zoom In / Zoom Out / Fit View
- **Layout Direction** toggle: "↕ Top-Down" ↔ "↔ Left-Right" (re-layouts without re-parsing)
- Toggle: Simulate
- Toggle: Entities Panel
- Help button → opens Help Modal
- Legend: colour dots for each node type

### 4.4 Flow Canvas
- SVG element with transform-based pan/zoom
- Pan: mouse drag on canvas background
- Zoom: scroll wheel (cursor-anchored) + toolbar buttons
- Fit: scales and centres all nodes in view
- Node click → opens Detail Panel

#### Node visual styles
| Type | Fill | Stroke | Icon |
|---|---|---|---|
| start | Deep indigo | Indigo | 🏠 |
| question | Deep blue | Sky blue | ❓ |
| data | Deep green | Emerald | 📋 |
| fallback | Deep amber | Amber | ⚠️ |
| global_fallback | Deep orange | Orange | 🚫 |
| end | Deep red | Red | ✅ |

#### Edge styles
- Happy path: solid grey line, arrowhead
- Fallback: dashed amber line, arrowhead
- Selected node: purple drop-shadow highlight

### 4.5 Detail Panel (slide-in, right side)
Shown when a node is clicked. Sections:
- Intent name + type badge
- Bot message(s) — verbatim
- Quick replies
- Input contexts
- Output contexts (with lifespan)
- Parameters table: name / entity type / required
- Training phrases (up to 15, collapsible)
- Action string
- Webhook used / slot filling flags
- Parent intent (for fallback nodes)
- Events
- **Reached From** — intent names that lead to this node (from computed `inputIntents`)
- **Leads To** — intent names this node leads to (from computed `outputIntents`)
- **Operator Handoff** badge — if intent sets `operator_request` context

### 4.6 Entities Panel (slide-in, right side)
Toggled from toolbar. Shows:
- All custom entities: name / type (regexp/enum/synonym) / entries
- Regexp entries shown as `/pattern/`
- System entities referenced in intent parameters listed separately
- Which intents use each entity

### 4.7 Simulator (bottom-left floating chat widget)
- Draggable: grab the header bar to reposition anywhere on screen
- Dynamic, context-state-driven: tracks `simCurrentIntentId` and `simActiveCtx` per turn
- Starts at the WELCOME-event intent; each user reply advances to the next matching intent
- Highlights active node on canvas
- Quick reply buttons rendered where defined
- **Format hints** (no validation): shown below the input field for known entity types
  - `@sys.email` → hint text, not a gate
  - `@sys.phone-number`, `@sys.number`, `@sys.given-name`, `@sys.date` → hint text
  - Custom regexp entity → shows the pattern as a hint
  - Custom synonym entity → shows first 3 example values
- **↩ Fallback button**: appears when the current intent has a fallback child; click to see the fallback message without advancing the conversation
- Restart button to replay from the beginning
- System messages for "Conversation ended" and "No matching intent found"

### 4.8 Help Modal
Triggered by Help button. Two sections:
- How to export from Dialogflow (steps)
- How to use the tool (steps)
- Caveats & Limitations (12 items with coloured badges)
- Dismiss by button or backdrop click

---

## Step 5 — External Dependencies

| Library | Version | Purpose | CDN URL |
|---|---|---|---|
| JSZip | 3.10.1 | Unzip `.zip` files in browser | `https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js` |

No other dependencies. SVG rendering, pan/zoom, and all UI are hand-written vanilla JS + CSS.

---

## Step 6 — Build Order (original, completed)

1. HTML shell — layout, drop zone, panels, modal
2. CSS — styles, colour tokens, transitions
3. File loader — ZIP + multi-file + classification
4. JSON parsers — agent, package, entities, intents, usersays
5. Graph builder — context index, traversal, node type detection, edge construction
6. Layout engine — BFS levels, TD/LR branching, fallback positioning
7. SVG renderer — nodes, edges, labels, arrowheads, pan/zoom
8. Detail panel — full intent metadata on node click
9. Entities panel — entity table
10. Simulator — dynamic context-aware walk, hints, fallback button
11. Help modal — static content
12. Polish — loading states, error handling, header, reset

---

## Output

A single file: `dialogflow_visualizer.html`

- ~1250 lines
- No build step
- Open in any modern browser (Chrome, Firefox, Safari, Edge)
- Works fully offline after initial CDN load (JSZip)
- All agent data stays in the browser — nothing is sent to any server

---

## Known Gaps / Possible Future Enhancements

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
11. **Followup context skipping** — `app.js` skips contexts ending in `-followup` during traversal; dfviz does not; may cause minor edge differences for agents using Dialogflow's built-in followup intent system

---

## Resume Instructions

If making changes, resume by sharing:
1. This plan (`dialogflow_visualizer_plan.md`)
2. The handoff document (`handoff.md`)
3. The current HTML file (`dialogflow_visualizer.html`)

Then say: **"Here is the current state of the Dialogflow Visualizer. Please [enhancement/fix]."**
