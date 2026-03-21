let chatConfig = null;
let currentState = "";
let lastState = null;
let context = {};
let historyStack = [];
let isReplaying = false; 

/**
 * CORE ENGINE STARTUP
 */
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
    
    const msgContainer = document.getElementById('messages');
    if (msgContainer) msgContainer.innerHTML = '';
    
    logEvent("RESET_FLOW", { state: currentState });
    render();
}

/**
 * REPLAY LOGIC
 */
async function replayFlow(inputs) {
    if (isReplaying || !inputs || !Array.isArray(inputs)) return;
    isReplaying = true;
    resetEngine();

    for (const input of inputs) {
        await new Promise(resolve => setTimeout(resolve, 800));
        
        const state = chatConfig.states[currentState];
        if (!state) break;

        let validated = false;

        if (state.inputType === "text") {
            const regex = new RegExp(state.regEx || ".*");
            if (regex.test(input)) {
                handleUserAction(input, state.onValid, state.storeKey);
                validated = true;
            } else {
                addMessage(`⚠️ Validation Failed: "${input}" doesn't match pattern for ${currentState}`, 'bot');
            }
        } else if (state.choices) {
            const choice = state.choices.find(c => 
                c.label === input || c.label.startsWith(input)
            );
            if (choice) {
                handleUserAction(choice.label, choice.next, state.storeKey);
                validated = true;
            } else {
                addMessage(`⚠️ Choice Error: "${input}" not valid in ${currentState}`, 'bot');
            }
        }

        if (!validated) {
            isReplaying = false;
            refreshInputArea();
            return; 
        }
    }
    
    isReplaying = false;
    refreshInputArea(); 
}

function logEvent(type, details) {
    const entry = {
        timestamp: new Date().toLocaleTimeString(),
        type: type,
        from: details.from || lastState || "START",
        to: details.to || currentState || "END",
        label: details.label || "N/A",
        context_snapshot: { ...context }
    };

    // Restore the console "State Table" dump
    console.groupCollapsed(`%c FLOW_EVENT: ${type} @ ${entry.timestamp}`, "color: #ff4757; font-weight: bold;");
    console.table({
        "Event Type": entry.type,
        "From State": entry.from,
        "To State": entry.to,
        "Input/Label": entry.label,
        "Timestamp": entry.timestamp
    });
    console.log("Context Snapshot:", entry.context_snapshot);
    console.groupEnd();

    historyStack.push(entry);
}

/**
 * FILE DOWNLOAD HELPER
 */
function downloadTrace(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flow-trace-${new Date().getTime()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * UI RENDERING LOGIC
 */
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

    const sessionTrace = historyStack
        .filter(e => e.type === "USER_ACTION")
        .map(e => e.label);

    const profileViewer = document.getElementById('profile-viewer');
    
    // Inject the Sidebar structure if not present
    if (!profileViewer.querySelector('#replay-command-text')) {
        profileViewer.innerHTML = `
            <div style="min-height: 550px; display: flex; flex-direction: column; gap: 15px;">
                <div style="text-align: right;">
                    <a href="help.html" target="_blank" style="font-size: 12px; color: #57606f; text-decoration: none; font-weight: bold;">❓ User Guide</a>
                </div>

                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <strong>📥 Replay Command (Input)</strong>
                        <button id="run-script-btn" style="background: #2ed573; color: white; border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-weight: bold;">▶️ Run</button>
                    </div>
                    <textarea id="replay-command-text" placeholder='Paste JSON array here...' 
                        style="width: 100%; height: 60px; font-family: monospace; font-size: 11px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; resize: vertical; box-sizing: border-box;"></textarea>
                </div>

                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <strong>📋 Live Session Trace (Output)</strong>
                        <button id="download-trace-btn" style="background: #57606f; color: white; border: none; padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 10px;">💾 Save .json</button>
                    </div>
                    <pre id="live-trace-display" style="background: #e9ecef; padding: 10px; border: 1px dashed #adb5bd; border-radius: 4px; word-break: break-all; white-space: pre-wrap; font-size: 11px; color: #495057; margin-top: 5px;"></pre>
                </div>

                <div style="flex-grow: 1;">
                    <strong>👤 Lead Profile</strong>
                    <pre id="profile-display" style="background: #fff; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; height: 180px; overflow-y: auto; margin-top: 5px;"></pre>
                </div>
            </div>
        `;

        document.getElementById('run-script-btn').onclick = () => {
            try {
                const raw = document.getElementById('replay-command-text').value.trim();
                if (!raw) return;
                replayFlow(JSON.parse(raw));
            } catch (e) { alert("Invalid JSON format."); }
        };

        document.getElementById('download-trace-btn').onclick = () => {
            const trace = historyStack.filter(e => e.type === "USER_ACTION").map(e => e.label);
            downloadTrace(trace);
        };
    }

    document.getElementById('live-trace-display').innerText = JSON.stringify(sessionTrace);
    document.getElementById('profile-display').innerText = JSON.stringify(context, null, 2);
    
    addMessage(state.message, 'bot');
    refreshInputArea();
}

function refreshInputArea() {
    const state = chatConfig.states[currentState];
    const area = document.getElementById('input-area');
    area.innerHTML = ''; 

    if (isReplaying) {
        area.innerHTML = '<div style="color: #ff4757; font-weight: bold; text-align:center; padding: 10px;">⏳ Running Replay Path...</div>';
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
    controlGroup.style.cssText = "margin-top: 20px; display: flex; gap: 10px; justify-content: center;";

    const resetBtn = document.createElement('button');
    resetBtn.innerText = "🔄 Restart Flow";
    resetBtn.className = "debug-btn restart-btn";
    resetBtn.onclick = () => { if(confirm("Clear current progress and restart?")) resetEngine(); };

    controlGroup.append(resetBtn);
    area.appendChild(controlGroup);
}

function renderTextInput(state) {
    const container = document.getElementById('input-area');
    const input = document.createElement('input');
    input.type = "text";
    input.className = "chat-input";
    input.placeholder = state.placeholder || "Type here...";

    const submit = () => {
        const val = input.value.trim();
        if (new RegExp(state.regEx || ".*").test(val)) {
            handleUserAction(val, state.onValid, state.storeKey);
        } else {
            input.style.borderColor = "#ff4757";
            setTimeout(() => input.style.borderColor = "#ddd", 1000);
        }
    };

    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    const btn = document.createElement('button');
    btn.innerText = "Submit";
    btn.onclick = submit;
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
    if (!m) return;
    const d = document.createElement('div');
    d.className = `msg ${side}`;
    d.innerText = text;
    m.appendChild(d);
    m.scrollTop = m.scrollHeight;
}

function renderExit() {
    const container = document.getElementById('input-area');
    const exitDiv = document.createElement('div');
    exitDiv.style.cssText = "text-align:center; padding: 15px; font-weight: bold; background: #f1f2f6; border-radius: 8px;";
    exitDiv.innerText = "✅ Flow Sequence Completed.";
    container.appendChild(exitDiv);
}

document.getElementById('config-upload').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            chatConfig = JSON.parse(e.target.result);
            resetEngine(); 
        } catch (err) { alert("Error loading JSON: " + err.message); }
    };
    reader.readAsText(file);
});

init();
