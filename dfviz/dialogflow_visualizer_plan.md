# Dialogflow Conversation Flow Visualizer — Full Build Plan

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
- `mlMinConfidence` → shown in help/caveats
- `language`

### Package Info (`package.json`)
Extract:
- `version` → shown in header/footer

### Entity Definitions (`entities/<name>.json`)
Extract:
- `name`
- `isRegexp` (boolean) → if true, entries are regex patterns
- `isEnum` (boolean)
- `isOverridable`

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
- Annotated segments: `{ text, meta, alias }` where `meta` is the entity type

---

## Step 3 — Graph Construction

### Intent Linking (Context Chain)
For each pair of intents A and B:
- If any string in B's `contexts` (input) matches any name in A's `affectedContexts` (output) → draw edge A → B
- Edge label: the shared context name or the training phrase triggers (quick replies if available)
- Edge style: solid for happy path, dashed for fallback

### Fallback Linking
- Fallback intent's `parentId` directly identifies its parent
- Draw a dashed edge from parent → fallback
- Fallback node is positioned to the right of its parent

### Node Type Detection
| Condition | Type |
|---|---|
| Has `events: [{ name: "WELCOME" }]` | `start` |
| `fallbackIntent: true` and no `parentId` | `global_fallback` |
| `fallbackIntent: true` and has `parentId` | `fallback` |
| Output contexts lead to no other intent | `end` |
| Has parameters with `@sys.*` or custom entity | `data` |
| Everything else | `question` |

### Layout Algorithm
- **Happy path** (main chain): vertical, top-to-bottom, centred on X=400
- **Fallback nodes**: horizontally offset (+280px) from their parent node, same Y
- **Global fallback**: top-right corner
- **Y spacing**: 160px between main chain nodes
- Future improvement: force-directed layout for complex agents

---

## Step 4 — UI Components

### 4.1 Drop Zone (initial screen)
- Large centred drop target
- Accepts `.zip` file OR multi-file selection
- Two clearly labelled buttons: "Upload ZIP" and "Select Files"
- Drag-over highlight state
- On load: parse files, transition to flow view
- Error display if files are invalid or unrecognised

### 4.2 Header
- Agent `displayName` (from `agent.json`)
- Language and timezone
- Agent version (from `package.json`)
- "Load New Agent" button → resets to drop zone

### 4.3 Toolbar
- Zoom In / Zoom Out / Reset View
- Toggle: Simulate
- Toggle: Entities Panel
- Help button → opens Help Modal

### 4.4 Flow Canvas
- SVG element inside a scrollable/pannable container
- Pan: mouse drag
- Zoom: scroll wheel + toolbar buttons
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
- Happy path: solid line, grey, arrowhead
- Fallback: dashed line, amber, arrowhead
- Highlighted (on node select): purple, thicker

### 4.5 Detail Panel (slide-in, right side)
Shown when a node is clicked. Sections:
- Intent name + type badge
- Bot message(s) — verbatim
- Quick replies (if any)
- Input contexts (with lifespan badges)
- Output contexts (with lifespan badges)
- Parameters table: name / entity type / required / default
- Training phrases (collapsible list)
- Action string
- Webhook used / slot filling flags
- Parent intent (for fallback nodes)

### 4.6 Entities Panel (slide-in or bottom drawer)
Toggled from toolbar. Shows:
- Table of all custom entities: name / type (regex/enum/synonym) / language
- For each entity: expandable row showing all entries/patterns
- System entities referenced in intents listed separately (`@sys.email`, `@sys.phone-number`, etc.)
- Which intents reference each entity

### 4.7 Simulator (bottom-left chat widget)
- Walks the detected conversation flow
- Highlights active node on canvas as conversation progresses
- Shows quick reply buttons where defined
- Input validation:
  - `@sys.email` → JS `/\S+@\S+\.\S+/` regex
  - `@sys.phone-number` → JS `/[\d\s\-\+\(\)]{7,}/` regex
  - `@sys.any` → accepts anything
  - `@sys.given-name` → accepts any non-empty string
  - Custom entity with `isRegexp: true` → uses actual pattern from `_entries_en.json`
  - Custom entity with synonyms → checks if input matches any synonym value
- On validation failure: shows fallback bot message, highlights fallback node
- Reset button to restart conversation

### 4.8 Help Modal
Triggered by Help button in toolbar. Two sections:

#### How to Use
1. Go to your Dialogflow console
2. Click the gear icon (Agent Settings) → Export and Import tab
3. Click "Export as ZIP" and download the file
4. Open this tool in any modern browser
5. Drop the downloaded `.zip` onto the drop zone (or click "Upload ZIP")
6. Alternatively, unzip it first and drag all the files/folders onto the drop zone
7. The flow renders automatically
8. Click any node to inspect its full intent definition
9. Click "Simulate" to walk through the conversation interactively
10. Click "Entities" to view all custom entity definitions

#### Caveats & Limitations
- **Simulator uses approximate NLU** — the real Dialogflow uses ML-based intent matching at a configured confidence threshold (`mlMinConfidence`). This tool uses regex/pattern matching only.
- **Webhook fulfillment is not called** — intents with `webhookUsed: true` will show the static fallback message in the simulator instead of the real webhook response.
- **Slot filling not simulated** — `webhookForSlotFilling` behaviour is not replicated.
- **Only English training phrases parsed** — files matching `*_usersays_en.json` are loaded. Other language files (`_usersays_de.json` etc.) are ignored.
- **Conditional responses not evaluated** — `conditionalResponses` fields are displayed in the detail panel but not acted upon in the simulator.
- **Google Assistant fields ignored** — `googleAssistant`, `voiceType`, `capabilities` etc. are not visualised.
- **Layout is heuristic** — the graph layout is computed from context chains using a simple vertical algorithm. Agents with complex branching, loops, or many parallel paths may have overlapping edges. A manual drag-to-reposition feature is not included in v1.
- **System entities are name-matched only** — `@sys.date`, `@sys.number` etc. are recognised by name and shown in the detail panel, but the simulator does not validate against Google's actual system entity extractors.
- **Multi-turn context loops** — if your agent has cycles (context A leads back to context A), the layout algorithm will not detect the loop and may render incorrectly.
- **No support for Mega Agents or sub-agents** — only standard single-agent exports are supported.
- **No support for Knowledge Bases** — `enabledKnowledgeBaseNames` entries are not parsed or visualised.
- **Rich response types** — only `type: "0"` (text) and `type: "4"` (custom payload with quick replies) are fully rendered. Card responses, image responses, etc. show a placeholder.

---

## Step 5 — External Dependencies

All loaded from CDN, no install required:

| Library | Version | Purpose | CDN URL |
|---|---|---|---|
| JSZip | 3.10.1 | Unzip `.zip` files in browser | `https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js` |

No other dependencies. SVG rendering, pan/zoom, and all UI are hand-written vanilla JS + CSS.

---

## Step 6 — Build Order

Build in this sequence to allow incremental testing:

1. **HTML shell** — full page layout: drop zone, header, toolbar, canvas area, panel placeholders, modal placeholder
2. **CSS** — all visual styles, colour tokens, transitions, responsive behaviour
3. **File loader** — ZIP detection, JSZip unzip, multi-file fallback, file classification function
4. **JSON parsers** — agent, package, entities (definition + entries), intents (main + fallback + usersays)
5. **Graph builder** — context chain linking, node type detection, edge construction
6. **Layout engine** — assign X/Y coordinates to nodes and edges
7. **SVG renderer** — draw nodes, edges, labels, arrowheads; pan/zoom interaction
8. **Detail panel** — populate all sections from parsed intent data on node click
9. **Entities panel** — render entity table with expandable rows
10. **Simulator** — conversation walker, node highlighting, entity-aware validation, reset
11. **Help modal** — static content, open/close behaviour
12. **Polish** — loading states, error handling, empty states, edge cases

---

## Output

A single file: `dialogflow_visualizer.html`

- ~800–1000 lines
- No build step
- Open in any modern browser (Chrome, Firefox, Safari, Edge)
- Works fully offline after initial CDN load (JSZip)
- Shareable — send the `.html` file to anyone; they just open it

---

## Resume Instructions (if build is interrupted)

If code generation is cut off mid-build, resume by saying:

> "Continue the build from Step N — [component name]"

Reference the Build Order in Step 6 above. Each step is independently testable before moving to the next.
