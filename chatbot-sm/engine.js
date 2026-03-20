let chatConfig = null;
let currentState = "";
let lastState = null; // Track where we came from
let context = {};
// init

// 1. Updated Initialization for Fitting
async function init() {
    try {
        // Only fetch if chatConfig hasn't been set by an upload
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

        render();
    } catch (err) {
        console.error("Default config not found. Please upload a JSON file.");
    }
}


async function render() {
    const state = chatConfig.states[currentState];
    if (state.type === "logic") {
        const val = context[state.condition];
        currentState = state.map[val] || Object.values(state.map)[0];
        return render();
    }

    updateDiagram();
    document.getElementById('profile-viewer').innerText = "Lead Profile: " + JSON.stringify(context, null, 2);
    addMessage(state.message, 'bot');

    const area = document.getElementById('input-area');
    const err = document.getElementById('error-display');
    area.innerHTML = '';
    err.innerText = ''; // Clear error on new state

    if (state.inputType === "text") {
        const input = document.createElement('input');
        input.type = "text";
        input.placeholder = state.placeholder;

        const btn = document.createElement('button');
        btn.innerText = "Submit";
        btn.onclick = () => {
            const val = input.value.trim();
            const regex = new RegExp(state.regEx || ".*");
            if (regex.test(val)) {
                context[state.storeKey] = val;
                addMessage(val, 'user');
                currentState = state.onValid;
                render();
            } else {
                err.innerText = state.errorMessage || "Invalid input.";
                input.style.borderColor = "red";
            }
        };
        area.append(input, btn);
    } else {
        const grid = document.createElement('div');
        grid.className = 'button-grid';
        state.choices.forEach(choice => {
            const btn = document.createElement('button');
            btn.innerText = choice.label;
            btn.onclick = () => {
                context[state.storeKey] = choice.label;
                addMessage(choice.label, 'user');
                currentState = choice.next;
                setTimeout(render, 400);
            };
            grid.appendChild(btn);
        });
        area.appendChild(grid);
    }
}

function renderTextInput(state) {
    const container = document.getElementById('input-area');
    const input = document.createElement('input');
    input.type = "text";
    input.placeholder = state.placeholder;

    const btn = document.createElement('button');
    btn.innerText = "Submit";
    btn.onclick = () => {
        const val = input.value.trim();
        const regex = new RegExp(state.regEx || ".*");

        if (regex.test(val)) {
            // Use the central handler
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
    const grid = document.createElement('div');
    grid.className = 'button-grid';

    state.choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.innerText = choice.label;
        btn.onclick = () => {
            // Use the central handler
            handleUserAction(choice.label, choice.next, state.storeKey);
        };
        grid.appendChild(btn);
    });
    container.appendChild(grid);
}

function renderExit(container) {
    const btn = document.createElement('button');
    btn.innerText = "Restart Flow";
    btn.onclick = () => { location.reload(); };
    container.appendChild(btn);
}

function addMessage(text, side) {
    const m = document.getElementById('messages');
    const d = document.createElement('div');
    d.className = `msg ${side}`;
    d.innerText = text;
    m.appendChild(d);
    m.scrollTop = m.scrollHeight;
}

function handleUserAction(label, nextState, storeKey) {
    // Only save to the profile if a storeKey is actually provided
    if (storeKey && storeKey !== "undefined") {
        context[storeKey] = label;
    }

    addMessage(label, 'user');

    lastState = currentState;
    currentState = nextState;

    render();
}

// updateDiagram

// 2. Updated Diagram Logic (Edge Highlighting)
async function updateDiagram() {
    let graph = `graph TD\n`;
    let edgeIndex = 0;
    let highlightIndex = -1;

    // We must iterate the states in the exact same order every time
    for (const [id, s] of Object.entries(chatConfig.states)) {

        // Handle Choice Transitions
        if (s.inputType === "choice" && s.choices) {
            s.choices.forEach(c => {
                graph += `  ${id} -->|"${c.label}"| ${c.next}\n`;
                if (id === lastState && c.next === currentState) {
                    highlightIndex = edgeIndex;
                }
                edgeIndex++;
            });
        }

        // Handle Text Input Validations
        else if (s.onValid) {
            graph += `  ${id} -->|Valid| ${s.onValid}\n`;
            if (id === lastState && s.onValid === currentState) {
                highlightIndex = edgeIndex;
            }
            edgeIndex++;
        }

        // Handle Logic Gates (Must match the two-branch structure)
        else if (s.type === "logic") {
            // Branch 1
            graph += `  ${id}{"Gate: ${s.condition}"} --> P6_Near\n`;
            if (id === lastState && currentState === "P6_Near") highlightIndex = edgeIndex;
            edgeIndex++;

            // Branch 2
            graph += `  ${id} --> P6_Far\n`;
            if (id === lastState && currentState === "P6_Far") highlightIndex = edgeIndex;
            edgeIndex++;
        }
    }

    // Apply Node Highlight
    graph += `\n  class ${currentState} activeNode;`;

    // Apply Single Edge Highlight if found
    if (highlightIndex !== -1) {
        graph += `\n  linkStyle ${highlightIndex} stroke:#ff4757,stroke-width:4px;`;
    }

    graph += `\n  classDef activeNode fill:#ff4757,stroke:#ff6b81,stroke-width:4px,color:#fff;`;

    try {
        const { svg } = await mermaid.render('mermaid-svg-' + Date.now(), graph);
        const container = document.getElementById('mermaid-container');
        container.innerHTML = svg;
    } catch (e) { console.error("Render Error:", e); }
}

// Listener for File Upload
document.getElementById('config-upload').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const newConfig = JSON.parse(e.target.result);

            // Validate basic structure before switching
            if (!newConfig.states || !newConfig.initial) {
                throw new Error("Invalid Config: Missing 'states' or 'initial' key.");
            }

            // 1. Swap the config
            chatConfig = newConfig;

            // 2. Reset the session
            currentState = chatConfig.initial;
            lastState = null;
            context = {};

            // 3. Clear the UI
            document.getElementById('messages').innerHTML = '';

            // 4. Re-run the engine
            render();

            console.log("Engine hot-swapped with new configuration.");
        } catch (err) {
            alert("Error parsing JSON: " + err.message);
        }
    };
    reader.readAsText(file);
});

init();


