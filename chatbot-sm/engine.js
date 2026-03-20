let chatConfig = null;
let currentState = "";
let lastState = null; 
let context = {};

async function init() {
    try {
        if (!chatConfig) {
            const response = await fetch('config.json');
            chatConfig = await response.json();
        }
        currentState = chatConfig.initial;

        mermaid.initialize({ 
            startOnLoad: false, 
            theme: 'neutral',
            flowchart: { useMaxWidth: true, htmlLabels: true }
        });
        
        setupKeyboardShortcuts();
        render();
    } catch (err) {
        console.error("Initialization failed:", err);
    }
}

async function render() {
    const state = chatConfig.states[currentState];
    
    // Handle Logic Gates immediately
    if (state.type === "logic") {
        const val = context[state.condition];
        const nextState = state.map[val] || Object.values(state.map)[0];
        lastState = currentState;
        currentState = nextState;
        return render();
    }

    // Update Visuals
    updateDiagram();
    document.getElementById('profile-viewer').innerText = "Lead Profile: " + JSON.stringify(context, null, 2);
    
    // Add Bot Message
    addMessage(state.message, 'bot');

    const area = document.getElementById('input-area');
    const err = document.getElementById('error-display');
    area.innerHTML = '';
    err.innerText = ''; 

    // Determine which input method to render
    if (state.inputType === "text") {
        renderTextInput(state);
    } else if (state.choices && state.choices.length > 0) {
        renderChoices(state);
    } else {
        renderExit();
    }
}

function renderTextInput(state) {
    const container = document.getElementById('input-area');
    const input = document.createElement('input');
    input.type = "text";
    input.placeholder = state.placeholder || "";

    const btn = document.createElement('button');
    btn.innerText = "Submit";
    btn.onclick = () => {
        const val = input.value.trim();
        const regex = new RegExp(state.regEx || ".*");
        if (regex.test(val)) {
            handleUserAction(val, state.onValid, state.storeKey);
        } else {
            const err = document.getElementById('error-display');
            err.innerText = state.errorMessage || "Invalid Input";
            input.style.borderColor = "red";
        }
    };
    container.append(input, btn);
}

function renderChoices(state) {
    const container = document.getElementById('input-area');
    const err = document.getElementById('error-display');
    const grid = document.createElement('div');
    grid.className = 'button-grid';

    err.innerHTML = `<span style="color: #888; font-weight: normal;">⌨️ Press a number key to select:</span>`;

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
    addMessage(label, 'user');
    lastState = currentState;
    currentState = nextState;
    render();
}

async function updateDiagram() {
    let graph = `graph TD\n`;
    let edgeIndex = 0;
    let highlightIndex = -1;

    for (const [id, s] of Object.entries(chatConfig.states)) {
        if (s.choices) {
            s.choices.forEach(c => {
                graph += `  ${id} -->|"${c.label}"| ${c.next}\n`;
                if (id === lastState && c.next === currentState) highlightIndex = edgeIndex;
                edgeIndex++;
            });
        } else if (s.onValid) {
            graph += `  ${id} -->|Valid| ${s.onValid}\n`;
            if (id === lastState && s.onValid === currentState) highlightIndex = edgeIndex;
            edgeIndex++;
        } else if (s.type === "logic") {
            graph += `  ${id}{"Gate: ${s.condition}"}\n`;
            for (const [val, target] of Object.entries(s.map)) {
                graph += `  ${id} --> ${target}\n`;
                if (id === lastState && target === currentState) highlightIndex = edgeIndex;
                edgeIndex++;
            }
        }
    }

    graph += `\n  class ${currentState} activeNode;`;
    if (highlightIndex !== -1) graph += `\n  linkStyle ${highlightIndex} stroke:#ff4757,stroke-width:4px;`;
    graph += `\n  classDef activeNode fill:#ff4757,stroke:#ff6b81,stroke-width:4px,color:#fff;`;

    try {
        const { svg } = await mermaid.render('mermaid-svg-' + Date.now(), graph);
        const container = document.getElementById('mermaid-container');
        container.innerHTML = svg;
        const svgElement = container.querySelector('svg');
        if (svgElement) {
            svgElement.style.maxHeight = "100%";
            svgElement.style.width = "auto";
        }
    } catch (e) { console.error(e); }
}

function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        const state = chatConfig.states[currentState];
        if (state && state.inputType === "choice" && e.target.tagName !== 'INPUT') {
            const matchedChoice = state.choices.find(c => 
                c.label.startsWith(e.key) || c.label.startsWith(e.key + "-")
            );
            if (matchedChoice) handleUserAction(matchedChoice.label, matchedChoice.next, state.storeKey);
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
    const btn = document.createElement('button');
    btn.innerText = "Restart Flow";
    btn.onclick = () => location.reload();
    container.appendChild(btn);
}

// File Upload Handler
document.getElementById('config-upload').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            chatConfig = JSON.parse(e.target.result);
            currentState = chatConfig.initial;
            lastState = null;
            context = {};
            document.getElementById('messages').innerHTML = '';
            render();
        } catch (err) { alert("Error parsing JSON: " + err.message); }
    };
    reader.readAsText(file);
});

init();
