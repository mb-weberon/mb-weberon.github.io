let chatConfig = null;
let currentState = "";
let lastState = null;
let context = {};
let historyStack = [];
let isReplaying = false; 

async function init() {
    try {
        if (!chatConfig) {
            const response = await fetch('config.json');
            chatConfig = await response.json();
        }
        resetEngine();
        
        mermaid.initialize({ 
            startOnLoad: false, 
            theme: 'neutral',
            flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' }
        });
        
        setupKeyboardShortcuts();
    } catch (err) {
        console.error("Initialization failed:", err);
    }
}

function resetEngine() {
    if (!chatConfig) return;
    currentState = chatConfig.initial;
    lastState = null;
    context = {};
    historyStack = [];
    
    document.getElementById('messages').innerHTML = '';
    document.getElementById('error-display').innerText = '';
    
    logEvent("RESET_FLOW", { state: currentState });
    render();
}

/**
 * Replay Feature: Accepts an array of strings.
 * For choices, it matches based on the start of the label (e.g., "1" matches "1-Rent").
 */
async function replayFlow(inputs) {
    if (isReplaying || !inputs || !Array.isArray(inputs)) return;
    isReplaying = true;
    resetEngine();

    for (const input of inputs) {
        // Delay to allow the user to follow the visual changes
        await new Promise(resolve => setTimeout(resolve, 800));
        
        const state = chatConfig.states[currentState];
        if (!state) break;

        if (state.inputType === "text") {
            handleUserAction(input, state.onValid, state.storeKey);
        } else if (state.choices) {
            // Flexible matching: check full label OR if label starts with input (e.g. "1")
            const choice = state.choices.find(c => 
                c.label === input || c.label.startsWith(input)
            );
            if (choice) {
                handleUserAction(choice.label, choice.next, state.storeKey);
            }
        }
    }
    isReplaying = false;
    render(); 
}

function logEvent(type, details) {
    const entry = {
        timestamp: new Date().toLocaleTimeString(),
        type: type,
        ...details,
        currentContext: { ...context }
    };
    historyStack.push(entry);
}

function dumpStackToConsole() {
    console.group("🚀 Flow Execution Trace");
    console.table(historyStack);
    
    // Generate a copy-pasteable replay array for the user
    const replayArray = historyStack
        .filter(e => e.type === "USER_ACTION")
        .map(e => e.label);
    
    console.log("📋 Replay Script (JSON Array):");
    console.log(JSON.stringify(replayArray));
    console.groupEnd();
}

async function render() {
    const state = chatConfig.states[currentState];
    
    if (state.type === "logic") {
        const val = context[state.condition];
        const nextState = state.map[val] || Object.values(state.map)[0];
        
        logEvent("LOGIC_GATE_TRANSITION", { gate: currentState, value: val, target: nextState });

        lastState = currentState;
        currentState = nextState;
        return render();
    }

    updateDiagram();
    document.getElementById('profile-viewer').innerText = "Lead Profile: " + JSON.stringify(context, null, 2);
    
    addMessage(state.message, 'bot');

    const area = document.getElementById('input-area');
    area.innerHTML = ''; 

    if (isReplaying) {
        area.innerHTML = '<div style="color: #ff4757; font-weight: bold; text-align:center;">⏳ Replaying sequence...</div>';
        return;
    }

    if (state.inputType === "text") {
        renderTextInput(state);
    } else if (state.choices && state.choices.length > 0) {
        renderChoices(state);
    } else {
        renderExit();
    }
    
    renderControlButtons();
}

function renderControlButtons() {
    const area = document.getElementById('input-area');
    const controlGroup = document.createElement('div');
    controlGroup.style.cssText = "margin-top: 20px; display: flex; flex-wrap: wrap; gap: 10px; justify-content: center;";

    const traceBtn = document.createElement('button');
    traceBtn.innerText = "🔍 Trace";
    traceBtn.className = "debug-btn";
    traceBtn.onclick = dumpStackToConsole;

    const resetBtn = document.createElement('button');
    resetBtn.innerText = "🔄 Restart";
    resetBtn.className = "debug-btn restart-btn";
    resetBtn.onclick = () => { if(confirm("Restart flow?")) resetEngine(); };

    const importReplayBtn = document.createElement('button');
    importReplayBtn.innerText = "📥 Import Replay";
    importReplayBtn.className = "debug-btn";
    importReplayBtn.onclick = renderReplayImport;

    controlGroup.append(traceBtn, resetBtn, importReplayBtn);
    area.appendChild(controlGroup);
}

function renderReplayImport() {
    const area = document.getElementById('input-area');
    area.innerHTML = `
        <div style="width: 100%; text-align: center; background: #f8f9fa; padding: 15px; border-radius: 8px;">
            <p style="font-size: 12px; color: #666; margin-bottom: 8px;">Paste Replay Array (JSON):</p>
            <textarea id="replay-data" placeholder='["email@test.com", "1", "2"]' style="width: 90%; height: 60px; font-family: monospace; padding: 5px;"></textarea><br>
            <button id="run-import-btn" class="debug-btn" style="background: #2ed573; color: white; margin-top: 10px;">▶️ Run</button>
            <button id="cancel-import-btn" class="debug-btn" style="margin-top: 10px;">Cancel</button>
        </div>
    `;

    document.getElementById('run-import-btn').onclick = () => {
        try {
            const data = JSON.parse(document.getElementById('replay-data').value);
            replayFlow(data);
        } catch (e) {
            alert("Invalid format. Please provide a JSON array of strings.");
        }
    };
    document.getElementById('cancel-import-btn').onclick = render;
}

function renderTextInput(state) {
    const container = document.getElementById('input-area');
    const input = document.createElement('input');
    input.type = "text";
    input.className = "chat-input";
    input.placeholder = state.placeholder || "";

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const val = input.value.trim();
            if (new RegExp(state.regEx || ".*").test(val)) {
                handleUserAction(val, state.onValid, state.storeKey);
            }
        }
    });

    const btn = document.createElement('button');
    btn.innerText = "Submit";
    btn.onclick = () => {
        const val = input.value.trim();
        if (new RegExp(state.regEx || ".*").test(val)) handleUserAction(val, state.onValid, state.storeKey);
    };
    container.append(input, btn);
    input.focus();
}

function renderChoices(state) {
    const container = document.getElementById('input-area');
    const grid = document.createElement('div');
    grid.className = 'button-grid';

    state.choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.innerHTML = choice.label.replace(/^(\d+)/, "<strong>$1</strong>");
        btn.onclick = () => handleUserAction(choice.label, choice.next, state.storeKey);
        grid.appendChild(btn);
    });
    container.appendChild(grid);
}

function handleUserAction(label, nextState, storeKey) {
    if (storeKey && storeKey !== "undefined") context[storeKey] = label;
    logEvent("USER_ACTION", { from: currentState, to: nextState, label: label });
    addMessage(label, 'user');
    lastState = currentState;
    currentState = nextState;
    render();
}

async function updateDiagram() {
    let graph = `graph TD\n`;
    const stateKeys = Object.keys(chatConfig.states).sort();

    stateKeys.forEach(id => {
        const s = chatConfig.states[id];
        const safeId = id.replace(/[^a-zA-Z0-9]/g, '_');
        if (s.choices) {
            s.choices.forEach(c => graph += `  ${safeId} -->|"${c.label}"| ${c.next.replace(/[^a-zA-Z0-9]/g, '_')}\n`);
        } else if (s.onValid) {
            graph += `  ${safeId} -->|"Valid"| ${s.onValid.replace(/[^a-zA-Z0-9]/g, '_')}\n`;
        } else if (s.type === "logic") {
            graph += `  ${safeId}{"${s.condition}"}\n`;
            Object.entries(s.map).sort().forEach(([val, target]) => {
                graph += `  ${safeId} -->|"${val}"| ${target.replace(/[^a-zA-Z0-9]/g, '_')}\n`;
            });
        }
    });

    graph += `\n  class ${currentState.replace(/[^a-zA-Z0-9]/g, '_')} activeNode;`;
    graph += `\n  classDef activeNode fill:#ff4757,stroke:#ff6b81,stroke-width:4px,color:#fff;`;

    try {
        const { svg } = await mermaid.render('mermaid-svg-' + Date.now(), graph);
        document.getElementById('mermaid-container').innerHTML = svg;
    } catch (e) { console.error(e); }
}

function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        if (isReplaying) return;
        const state = chatConfig.states[currentState];
        if (state && state.inputType === "choice" && e.target.tagName !== 'INPUT') {
            const matched = state.choices.find(c => c.label.startsWith(e.key));
            if (matched) { e.preventDefault(); handleUserAction(matched.label, matched.next, state.storeKey); }
        }
    });
}

function addMessage(text, side) {
    const m = document.getElementById('messages');
    const d = document.createElement('div');
    d.className = `msg ${side}`;
    d.innerText = text;
    m.appendChild(d);
    m.scrollTop = m.scrollHeight;
}

function renderExit() {
    const container = document.getElementById('input-area');
    container.innerHTML = '<div style="text-align:center; padding: 10px; font-weight: bold;">Flow Completed.</div>';
}

document.getElementById('config-upload').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            chatConfig = JSON.parse(e.target.result);
            resetEngine(); 
        } catch (err) { alert("Error: " + err.message); }
    };
    reader.readAsText(file);
});

init();
