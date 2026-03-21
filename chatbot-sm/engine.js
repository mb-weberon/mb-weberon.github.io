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

async function replayFlow(inputs) {
    if (isReplaying || !inputs || !Array.isArray(inputs)) return;
    isReplaying = true;
    resetEngine();

    for (const input of inputs) {
        await new Promise(resolve => setTimeout(resolve, 800));
        
        const state = chatConfig.states[currentState];
        if (!state) break;

        if (state.inputType === "text") {
            handleUserAction(input, state.onValid, state.storeKey);
        } else if (state.choices) {
            const choice = state.choices.find(c => 
                c.label === input || c.label.startsWith(input)
            );
            if (choice) {
                handleUserAction(choice.label, choice.next, state.storeKey);
            }
        }
    }
    
    isReplaying = false;
    refreshInputArea(); 
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

function refreshInputArea() {
    const state = chatConfig.states[currentState];
    const area = document.getElementById('input-area');
    area.innerHTML = ''; 

    if (state.inputType === "text") {
        renderTextInput(state);
    } else if (state.choices && state.choices.length > 0) {
        renderChoices(state);
    } else {
        renderExit();
    }
    renderControlButtons();
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

    const replayArray = historyStack
        .filter(e => e.type === "USER_ACTION")
        .map(e => e.label);

    // NEW UI: Replay Script is now a TEXTAREA that you can edit and RUN
    document.getElementById('profile-viewer').innerHTML = `
        <div style="min-height: 450px; display: flex; flex-direction: column;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                <strong>Replay Script (Editable):</strong>
                <button id="run-script-btn" class="debug-btn" style="background: #2ed573; color: white; padding: 2px 10px;">▶️ Run</button>
            </div>
            <textarea id="live-replay-script" style="background: #eee; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-family: monospace; font-size: 11px; height: 100px; resize: vertical; margin-bottom: 15px;">${JSON.stringify(replayArray)}</textarea>
            
            <div style="flex-grow: 1;">
                <strong>Lead Profile:</strong>
                <pre style="font-size: 13px; background: #fff; padding: 10px; border: 1px solid #ddd; border-radius: 4px; height: 250px; overflow-y: auto;">${JSON.stringify(context, null, 2)}</pre>
            </div>
        </div>
    `;

    // Attach listener to the new "Run" button in the profile area
    document.getElementById('run-script-btn').onclick = () => {
        try {
            const rawData = document.getElementById('live-replay-script').value;
            const data = JSON.parse(rawData);
            replayFlow(data);
        } catch (e) {
            alert("Invalid JSON format in the script area.");
        }
    };
    
    addMessage(state.message, 'bot');

    const area = document.getElementById('input-area');
    area.innerHTML = ''; 

    if (isReplaying) {
        area.innerHTML = '<div style="color: #ff4757; font-weight: bold; text-align:center;">⏳ Replaying sequence...</div>';
        return;
    }

    refreshInputArea();
}

function renderControlButtons() {
    const area = document.getElementById('input-area');
    const controlGroup = document.createElement('div');
    controlGroup.style.cssText = "margin-top: 20px; display: flex; gap: 10px; justify-content: center;";

    const resetBtn = document.createElement('button');
    resetBtn.innerText = "🔄 Restart";
    resetBtn.className = "debug-btn restart-btn";
    resetBtn.onclick = () => { if(confirm("Restart flow?")) resetEngine(); };

    controlGroup.append(resetBtn);
    area.appendChild(controlGroup);
}

function renderTextInput(state) {
    const container = document.getElementById('input-area');
    const input = document.createElement('input');
    input.type = "text";
    input.className = "chat-input";
    input.placeholder = state.placeholder || "";

    const submit = () => {
        const val = input.value.trim();
        if (new RegExp(state.regEx || ".*").test(val)) handleUserAction(val, state.onValid, state.storeKey);
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
    const d = document.createElement('div');
    d.className = `msg ${side}`;
    d.innerText = text;
    m.appendChild(d);
    m.scrollTop = m.scrollHeight;
}

function renderExit() {
    const container = document.getElementById('input-area');
    const exitDiv = document.createElement('div');
    exitDiv.style.cssText = "text-align:center; padding: 10px; font-weight: bold;";
    exitDiv.innerText = "Flow Completed.";
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
        } catch (err) { alert("Error: " + err.message); }
    };
    reader.readAsText(file);
});

init();
