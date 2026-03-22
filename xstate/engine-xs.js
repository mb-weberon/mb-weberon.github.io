import { createMachine, createActor, assign } from 'xstate';
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, theme: 'neutral' });

const validators = {
    email: (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
    phone: (val) => /^\d{7,15}$/.test(val),
    default: (val) => val.trim().length > 0
};

export async function initEngine(jsonPath) {
    const response = await fetch(jsonPath);
    let config = await response.json();
    
    let actor;
    let lastStateId = null;
    let currentChoices = [];

    const createNewActor = (conf) => createActor(createMachine(conf).provide({
        actions: {
            record: assign({ trace: ({context, event}) => [...context.trace, event.value || event.type] }),
            storeEmail: assign({ user_email: ({event}) => event.value }),
            setRent: assign({ status: 'rent' }),
            setOwn: assign({ status: 'own' }),
            setSoon: assign({ timing: 'soon' }),
            setLater: assign({ timing: 'later' }),
            storePhone: assign({ phone: ({event}) => event.value }),
            emailCallback: ({context}) => console.log("📧 Mock Email Sent to:", context.user_email),
            serverUploadCallback: ({context}) => console.log("🚀 Mock Server Upload:", context)
        }
    }));

    // --- FIXED KEYBOARD SHORTCUTS ---
    window.addEventListener('keydown', (e) => {
        // CRITICAL: If any input or textarea is focused, do NOT intercept numbers
        const activeTag = document.activeElement.tagName;
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

        const num = parseInt(e.key);
        if (!isNaN(num) && num > 0 && num <= currentChoices.length) {
            const ev = currentChoices[num - 1];
            addBubble(`${num}: ${ev}`, 'user');
            actor.send({ type: ev });
        }
    });

    window.restartEngine = () => {
        if (actor) actor.stop();
        document.getElementById('messages').innerHTML = '';
        lastStateId = null;
        actor = createNewActor(config);
        actor.subscribe(subscriptionLogic);
        actor.start();
    };

    // --- COPY TRACE LOGIC ---
    window.copyTrace = () => {
        const traceText = document.getElementById('current-trace-data').innerText;
        navigator.clipboard.writeText(traceText).then(() => {
            const btn = document.getElementById('copy-btn');
            const originalText = btn.innerText;
            btn.innerText = "✅ Copied!";
            btn.style.background = "#28a745";
            setTimeout(() => {
                btn.innerText = originalText;
                btn.style.background = "";
            }, 2000);
        });
    };

    window.downloadConfig = () => {
        const blob = new Blob([JSON.stringify(config, null, 2)], {type:'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'machine.json'; a.click();
    };

    window.loadNewConfig = (file) => {
        const reader = new FileReader();
        reader.onload = (e) => { config = JSON.parse(e.target.result); window.restartEngine(); };
        reader.readAsText(file);
    };

    window.runReplay = async (traceString) => {
        if(!traceString) return;
        const trace = JSON.parse(traceString);
        window.restartEngine();
        for (const item of trace) {
            await new Promise(r => setTimeout(r, 600));
            const snap = actor.getSnapshot();
            const curr = typeof snap.value === 'string' ? snap.value : Object.keys(snap.value)[0];
            const meta = config.states[curr]?.meta;
            
            if (meta?.input === 'text') {
                addBubble(item, 'user');
                actor.send({ type: 'SUBMIT', value: item });
            } else {
                addBubble(item, 'user');
                actor.send({ type: item });
            }
        }
    };

    function subscriptionLogic(snapshot) {
        const current = typeof snapshot.value === 'string' ? snapshot.value : Object.keys(snapshot.value)[0];
        if (current === 'logic_check' || current === 'upload_data') return;

        const stateDef = config.states[current];
        const meta = stateDef?.meta || {};
        
        // Update Profile & Trace
        document.getElementById('profile-viewer').innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
                <strong style="color:#61dafb">LEAD PROFILE</strong>
                <button id="copy-btn" onclick="window.copyTrace()" style="padding:4px 8px; font-size:10px; background:#444; color:white; border:none; border-radius:3px; cursor:pointer;">📋 Copy Trace</button>
            </div>
            <pre style="margin:0; font-size:11px; color:#abb2bf">${JSON.stringify(snapshot.context, null, 1)}</pre>
            <div id="current-trace-data" style="display:none">${JSON.stringify(snapshot.context.trace)}</div>
        `;

        if (current !== lastStateId && meta.text) {
            const text = meta.text.replace(/{{(\w+)}}/g, (_, k) => snapshot.context[k] || "...");
            addBubble(text, 'bot');
            lastStateId = current;
        }

        const ctrl = document.getElementById('input-area');
        ctrl.innerHTML = '';
        currentChoices = [];

        if (meta.input === 'text') {
            const i = document.createElement('input');
            const b = document.createElement('button');
            i.type = "text"; 
            i.id = "active-input";
            i.placeholder = "Type here...";
            b.innerText = "Send";
            
            const go = () => {
                const val = i.value.trim();
                if(validators[meta.pattern || 'default'](val)){
                    addBubble(val, 'user');
                    actor.send({ type: 'SUBMIT', value: val });
                } else { 
                    i.style.border = "2px solid red"; 
                    setTimeout(()=> i.style.border="", 500); 
                }
            };
            i.onkeydown = (e) => { if(e.key === 'Enter') { e.preventDefault(); go(); } };
            b.onclick = go;
            ctrl.append(i, b);
            // Small timeout ensures the DOM has painted before focusing
            setTimeout(() => i.focus(), 10);
        }

        const events = stateDef.on ? Object.keys(stateDef.on) : [];
        currentChoices = events.filter(e => e !== 'SUBMIT');
        currentChoices.forEach((ev, idx) => {
            const b = document.createElement('button');
            b.innerText = `(${idx+1}) ${ev}`;
            b.onclick = () => { addBubble(ev, 'user'); actor.send({ type: ev }); };
            ctrl.append(b);
        });

        drawDiagram(config, current);
    }

    window.restartEngine();
}

function addBubble(text, side) {
    const m = document.getElementById('messages');
    const d = document.createElement('div');
    d.className = `msg ${side}`; d.innerText = text;
    m.appendChild(d);
    m.scrollTop = m.scrollHeight;
}

async function drawDiagram(config, current) {
    let graph = `graph TD\n`;
    Object.keys(config.states).forEach(id => {
        const style = (id === current) ? `:::activeNode` : "";
        graph += `  ${id}["${id}"]${style}\n`;
        if (config.states[id].on) {
            Object.entries(config.states[id].on).forEach(([ev, target]) => {
                const tId = typeof target === 'string' ? target : target.target;
                graph += `  ${id} -- "${ev}" --> ${tId}\n`;
            });
        }
    });
    graph += `\nclassDef activeNode fill:#ff4757,stroke:#ff6b81,stroke-width:4px,color:#fff;`;
    const { svg } = await mermaid.render('mermaid-svg-' + Date.now(), graph);
    document.getElementById('mermaid-container').innerHTML = svg;
}
