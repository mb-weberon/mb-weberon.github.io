let chatConfig = null;
let currentState = "";
let lastState = null;
let context = {};
let historyStack = [];

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

// Centralized reset function to wipe memory and UI
function resetEngine() {
    if (!chatConfig) return;
    
    currentState = chatConfig.initial;
    lastState = null;
    context = {};
    historyStack = [];
    
    // Clear UI elements
    document.getElementById('messages').innerHTML = '';
    document.getElementById('error-display').innerText = '';
    
    logEvent("RESET_FLOW", { state: currentState });
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
    console.groupEnd();
}

async function render() {
    const state = chatConfig.states[currentState];
    
    // Logic Gate Handler
    if (state.type === "logic") {
        const val = context[state.condition];
        const nextState = state.map[val] || Object.values(state.map)[0];
        
        logEvent("LOGIC_GATE_TRANSITION", { 
            gate: currentState, 
            condition: state.condition, 
            value: val, 
            target: nextState 
        });

        lastState = currentState;
        currentState = nextState;
        return render();
    }

    updateDiagram();
    
    // Update Profile Viewer
    document.getElementById('profile-viewer').innerText = "Lead Profile: " + JSON.stringify(context, null, 2);
    
    addMessage(state.message, 'bot');

    const area = document.getElementById('input-area');
    const err = document.getElementById('error-display');
    area.innerHTML = '';
    err.innerText = ''; 

    // Render Inputs based on state type
    if (state.inputType === "text") {
        renderTextInput(state);
    } else if (state.choices && state.choices.length > 0) {
        renderChoices(state);
    } else {
        renderExit();
    }
    
    // Add Debug and Reset buttons at every stage
    renderControlButtons();
}

function renderControlButtons() {
    const area = document.getElementById('input-area');
    const controlGroup = document.createElement('div');
    controlGroup.style.marginTop = "20px";
    controlGroup.style.display = "flex";
    controlGroup.style.gap = "10px";
    controlGroup.style.justifyContent = "center";

    // Trace Button
    const traceBtn = document.createElement('button');
    traceBtn.innerText = "🔍 Trace";
    traceBtn.className = "debug-btn";
    traceBtn.onclick = dumpStackToConsole;

    // Global Reset Button
    const resetBtn = document.createElement('button');
    resetBtn.innerText = "🔄 Restart";
    resetBtn.className = "debug-btn"; // You can style this differently in CSS
    resetBtn.style.background = "#6c757d";
    resetBtn.onclick = () => {
        if(confirm("Are you sure you want to restart the flow?")) resetEngine();
    };

    controlGroup.append(traceBtn, resetBtn);
    area.appendChild(controlGroup);
}

function renderTextInput(state) {
    const container = document.getElementById('input-area');
    const input = document.createElement('input');
    input.type = "text";
    input.placeholder = state.placeholder || "";
    input.className = "chat-input";

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const val = input.value.trim();
            const regex = new RegExp(state.regEx || ".*");
            if (regex.test(val)) {
                handleUserAction(val, state.onValid, state.storeKey);
            } else {
                document.getElementById('error-display').innerText = state.errorMessage || "Invalid Input";
                input.style.borderColor = "red";
            }
        }
    });

    const btn = document.createElement('button');
    btn.innerText = "Submit";
    btn.onclick = () => {
        const val = input.value.trim();
        const regex = new RegExp(state.regEx || ".*");
        if (regex.test(val)) {
            handleUserAction(val, state.onValid, state.storeKey);
        } else {
            document.getElementById('error-display').innerText = state.errorMessage || "Invalid";
        }
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
    if (storeKey && storeKey !== "undefined") {
        context[storeKey] = label;
    }
    
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
            s.choices.forEach((c) => {
                const safeNext = c.next.replace(/[^a-zA-Z0-9]/g, '_');
                graph += `  ${safeId} -->|"${c.label}"| ${safeNext}\n`;
            });
        } 
        else if (s.onValid) {
            const safeNext = s.onValid.replace(/[^a-zA-Z0-9]/g, '_');
            graph += `  ${safeId} -->|"Valid"| ${safeNext}\n`;
        } 
        else if (s.type === "logic") {
            graph += `  ${safeId}{"${s.condition}"}\n`;
            Object.entries(s.map).sort().forEach(([val, target]) => {
                const safeTarget = target.replace(/[^a-zA-Z0-9]/g, '_');
                graph += `  ${safeId} -->|"${val}"| ${safeTarget}\n`;
            });
        }
    });

    const safeCurrent = currentState.replace(/[^a-zA-Z0-9]/g, '_');
    graph += `\n  class ${safeCurrent} activeNode;`;
    graph += `\n  classDef activeNode fill:#ff4757,stroke:#ff6b81,stroke-width:4px,color:#fff;`;

    try {
        const { svg } = await mermaid.render('mermaid-svg-' + Date.now(), graph);
        document.getElementById('mermaid-container').innerHTML = svg;
    } catch (e) { console.error("Mermaid Render Error", e); }
}

function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        const state = chatConfig.states[currentState];
        if (state && state.inputType === "choice" && e.target.tagName !== 'INPUT') {
            const matchedChoice = state.choices.find(c => 
                c.label.startsWith(e.key) || c.label.startsWith(e.key + "-")
            );
            if (matchedChoice) {
                e.preventDefault(); 
                handleUserAction(matchedChoice.label, matchedChoice.next, state.storeKey);
            }
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
    const exitText = document.createElement('div');
    exitText.innerText = "Flow Completed.";
    exitText.style.marginBottom = "10px";
    container.appendChild(exitText);

    // Keyboard listener specifically for the "R" or Enter key at the end
    const exitHandler = (e) => {
        if (e.key.toLowerCase() === 'r' || e.key === 'Enter') {
            window.removeEventListener('keydown', exitHandler);
            resetEngine();
        }
    };
    window.addEventListener('keydown', exitHandler);
}

// File Upload Handler
document.getElementById('config-upload').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            chatConfig = JSON.parse(e.target.result);
            resetEngine(); 
        } catch (err) { alert("Error parsing JSON: " + err.message); }
    };
    reader.readAsText(file);
});

init();
