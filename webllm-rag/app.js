let index = [];
let llmEngine = null;

// Safe localStorage — Safari private mode throws on access
function storageGet(key) {
  try { return localStorage.getItem(key); } catch(e) { return null; }
}
function storageSet(key, val) {
  try { localStorage.setItem(key, val); } catch(e) {}
}

let messages = JSON.parse(storageGet('chat_messages') || '[]');

// Detect iOS Safari — WebGPU exists but web-llm compute shaders don't work,
// and Transformers.js WASM threading requires COOP/COEP headers not sent by basic servers
function isIOSSafari() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && /WebKit/.test(ua) && !/CriOS|FxiOS|OPiOS/.test(ua);
}

// Ranked model list — order matches the dropdown
const MODELS = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',    label: 'Qwen 2.5 1.5B' },
  { id: 'gemma-2-2b-it-q4f16_1-MLC',             label: 'Gemma 2 2B'    },
  { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',     label: 'Phi-3.5 Mini'  },
  { id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',     label: 'Llama 3.2 1B'  },
];

function getSelectedModel() {
  const sel = document.getElementById('model-select');
  return sel ? sel.value : MODELS[0].id;
}

// Called when user changes the dropdown — show the Load button
window.onModelChange = function() {
  const btn = document.getElementById('reload-model-btn');
  if (btn) btn.classList.remove('hidden');
};

// Called when user clicks Load after changing model
window.reloadModel = async function() {
  const btn = document.getElementById('reload-model-btn');
  if (btn) btn.classList.add('hidden');
  llmEngine = null;
  engineState.mode = 'loading';
  engineState.model = null;
  engineState.failReason = null;
  updateEngineStatus();
  await initLLM();
};


const engineState = {
  mode: 'loading',
  webgpu: null,
  model: null,
  loadProgress: null,
  failReason: null,
};

function updateEngineStatus() {
  const bar = document.getElementById('engine-status');
  if (!bar) return;

  const usingGPU = engineState.mode === 'llm' && !engineState.model?.includes('CPU');
  const gpuBadge = usingGPU
    ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">⚡ WebGPU</span>`
    : engineState.webgpu === false
    ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-200 text-gray-500">🚫 No WebGPU</span>`
    : '';

  let modeBadge = '';
  let dot = '';

  if (engineState.mode === 'loading') {
    dot = '<span class="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></span>';
    const prog = engineState.loadProgress !== null ? ` ${engineState.loadProgress}%` : '';
    modeBadge = `<span class="text-yellow-700 font-medium">Loading LLM${prog}…</span>`;
  } else if (engineState.mode === 'llm') {
    dot = '<span class="inline-block w-2 h-2 rounded-full bg-green-500"></span>';
    const isCPU = engineState.model?.includes('CPU');
    modeBadge = isCPU
      ? `<span class="text-green-700 font-medium">LLM active (CPU)</span>`
      : `<span class="text-green-700 font-medium">LLM active (GPU)</span>`;
  } else if (engineState.mode === 'fallback') {
    dot = '<span class="inline-block w-2 h-2 rounded-full bg-orange-400"></span>';
    const reason = engineState.failReason ? ` — ${engineState.failReason}` : '';
    modeBadge = `<span class="text-orange-700 font-medium">Template mode (no LLM)</span><span class="text-orange-500 text-xs">${reason}</span>`;
  } else if (engineState.mode === 'error') {
    dot = '<span class="inline-block w-2 h-2 rounded-full bg-red-500"></span>';
    modeBadge = `<span class="text-red-700 font-medium">LLM error</span>`;
  }

  const modelLabel = engineState.model
    ? `<span class="text-gray-400 text-xs">${engineState.model}</span>`
    : '';

  bar.innerHTML = `
    <div class="flex items-center gap-2 flex-wrap">
      ${dot} ${modeBadge} ${gpuBadge} ${modelLabel}
    </div>
  `;
}

// Load index - handles BOTH formats
async function loadIndex() {
  const statusEl = document.getElementById('status');
  statusEl.textContent = 'Loading index.json...';
  updateEngineStatus();
  
  try {
    const response = await fetch('index.json');
    const data = await response.json();
    
    // Handle flat array format OR manifest format
    if (Array.isArray(data) && data.length > 0 && data[0].id !== undefined) {
      index = data;
    } else if (data.documents && Array.isArray(data.documents)) {
      index = data.documents;
    } else {
      throw new Error('Invalid index format');
    }
    
    console.log(`✅ Loaded ${index.length} documents`);
    statusEl.textContent = `Loaded ${index.length} chunks from ${index[0]?.url}! Initializing LLM...`;
    
    // Initialize LLM
    await initLLM();
    statusEl.textContent = `✅ Ready to chat! (${index.length} chunks)`;
    
  } catch (e) {
    console.error('❌ Index load failed:', e);
    statusEl.textContent = `Error: ${e.message}`;
    engineState.mode = 'error';
    updateEngineStatus();
  }
}

// Initialize WebLLM — tries WebGPU first, falls back to CPU via Transformers.js
// Skips both on iOS Safari where neither works reliably without special server headers
async function initLLM() {

  // iOS Safari: web-llm compute shaders unsupported, Transformers.js needs
  // COOP/COEP headers (Cross-Origin-Opener-Policy / Embedder-Policy) for
  // SharedArrayBuffer — a basic file server won't send these.
  // Skip LLM entirely and use template mode with a helpful message.
  if (isIOSSafari()) {
    engineState.webgpu = false;
    engineState.mode = 'fallback';
    engineState.failReason = 'iOS Safari — LLM requires server headers (COOP/COEP)';
    updateEngineStatus();
    // Hide model selector — not useful on iOS
    const row = document.getElementById('model-selector-row');
    if (row) row.classList.add('hidden');
    console.log('⚠️ iOS Safari detected — skipping LLM, using template mode');
    return;
  }

  // --- Attempt 1: WebGPU via web-llm ---
  const hasGpuAPI = !!navigator.gpu;
  engineState.webgpu = hasGpuAPI;

  if (hasGpuAPI) {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        engineState.webgpu = true;
        engineState.mode = 'loading';
        engineState.loadProgress = 0;
        updateEngineStatus();

        const webllm = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm/+esm');
        const MODEL = getSelectedModel();

        llmEngine = await webllm.CreateMLCEngine(MODEL, {
          initProgressCallback: (p) => {
            engineState.loadProgress = Math.round((p.progress ?? 0) * 100);
            updateEngineStatus();
          }
        });

        engineState.mode = 'llm';
        engineState.model = MODEL;
        engineState.loadProgress = null;
        engineState.failReason = null;
        updateEngineStatus();
        console.log('✅ WebLLM (WebGPU) loaded');
        return;
      }
    } catch (e) {
      console.warn('WebGPU/web-llm failed:', e.message);
    }
  }

  // --- Attempt 2: CPU via Transformers.js (WASM, no GPU needed) ---
  engineState.webgpu = hasGpuAPI && !!navigator.gpu;
  engineState.mode = 'loading';
  engineState.loadProgress = 0;
  engineState.failReason = null;
  updateEngineStatus();

  try {
    const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm');

    env.allowLocalModels = false;
    env.useBrowserCache = true;

    const MODEL = 'HuggingFaceTB/SmolLM2-135M-Instruct';

    const pipe = await pipeline('text-generation', MODEL, {
      dtype: 'q4',
      progress_callback: (p) => {
        if (p.progress != null) {
          engineState.loadProgress = Math.round(p.progress);
          updateEngineStatus();
        }
      }
    });

    llmEngine = {
      _pipe: pipe,
      chat: {
        completions: {
          create: async ({ messages, temperature }) => {
            const result = await pipe(messages, {
              max_new_tokens: 512,
              temperature: temperature ?? 0.1,
              do_sample: temperature > 0,
            });
            const text = result[0]?.generated_text?.at(-1)?.content ?? '';
            return { choices: [{ message: { content: text } }] };
          }
        }
      }
    };

    engineState.mode = 'llm';
    engineState.model = `${MODEL} (CPU)`;
    engineState.loadProgress = null;
    engineState.failReason = null;
    updateEngineStatus();
    console.log('✅ Transformers.js (CPU) loaded');

  } catch (e) {
    console.warn('CPU LLM also failed:', e.message);
    llmEngine = null;
    engineState.mode = 'fallback';
    engineState.loadProgress = null;
    engineState.failReason = hasGpuAPI
      ? `No WebGPU adapter + CPU fallback failed: ${e.message?.slice(0, 60)}`
      : `WebGPU not supported + CPU fallback failed: ${e.message?.slice(0, 60)}`;
    updateEngineStatus();
  }
}

// Smart keyword search (for retrieval)
function search(query, k = 5) {
  if (!index.length) return [];
  
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  
  return index
    .map(doc => {
      const textLower = doc.text.toLowerCase();
      let score = 0.5; // Minimum score
      
      // Exact phrase match
      if (textLower.includes(query.toLowerCase())) score += 3;
      
      // Word matches
      queryWords.forEach(word => {
        if (textLower.includes(word)) score += 1;
        if (doc.title?.toLowerCase().includes(word)) score += 2;
        if (doc.url.toLowerCase().includes(word)) score += 1;
      });
      
      return { ...doc, score: score / Math.max(1, queryWords.length + 1) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// RAG + LLM generation
async function chat(query) {
  const sources = search(query);

  if (sources.length === 0) {
    return {
      answer: "No relevant content found in your site.",
      sources: []
    };
  }

  // Top 3 UNIQUE URLs (shows multiple pages)
  const uniqueSources = [];
  const seenUrls = new Set();

  sources.slice(0, 10).forEach(s => {
    if (!seenUrls.has(s.url) && uniqueSources.length < 3) {
      seenUrls.add(s.url);
      uniqueSources.push(s);
    }
  });

  const context = uniqueSources.map((s, i) =>
    `Source ${i+1} (${s.url}):\n${s.text}`
  ).join('\n\n---\n\n');

  // LLM path (modern web-llm API)
  if (llmEngine) {
    try {
      // Trim context to avoid exceeding the model's context window
      const trimmedContext = uniqueSources.map((s, i) =>
        `[${i+1}] ${s.text.substring(0, 400)}`
      ).join('\n\n');

      console.log('📤 Sending context to LLM:\n', trimmedContext);

      const reply = await llmEngine.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: `You are a helpful assistant. Answer the user's question using ONLY the numbered passages below. Cite passages as [1], [2], [3]. If the passages don't contain the answer, say so briefly.`
          },
          {
            role: 'user',
            content: `Passages:\n${trimmedContext}\n\nQuestion: ${query}`
          }
        ],
        temperature: 0.1,
        max_tokens: 300
      });
      const raw = reply.choices[0].message.content;
      // Aggressively strip any sources/references block the LLM appends.
      // Catches patterns like:
      //   Sources: [1] http://...
      //   [1] http://...
      //   References\n1. http://...
      const answer = raw
        .replace(/\n+\[?\d+\]?\s*https?:\/\/\S+/g, '')        // bare URL citations
        .replace(/\n+(sources|references|source list|cited|links)[\s\S]*/gi, '') // footer blocks
        .replace(/\n+\[\d+\][^\n]*/g, '')                      // [1] label lines
        .trimEnd();
      return { answer, sources: uniqueSources };
    } catch (e) {
      console.warn('LLM failed, falling back to template:', e);
    }
  }

  // Template fallback — answer only, no source list (sidebar handles that)
  const answer = `Here's what I found on the site:\n\n` +
    uniqueSources.map((s, i) => `[${i+1}] ${s.text.substring(0, 300)}...`).join('\n\n');

  return { answer, sources: uniqueSources };
}


// Main chat handler
window.ask = async function() {
  const input = document.getElementById('input');
  const query = input.value.trim();
  if (!query) return;
  
  input.value = '';
  input.disabled = true;
  document.getElementById('send-btn').disabled = true;

  // Add user message
  messages.push({ role: 'user', content: query });
  saveMessages();
  renderMessages();

  // Show typing indicator
  const typing = document.createElement('div');
  typing.id = 'typing-indicator';
  typing.innerHTML = `
    <div class="flex justify-start">
      <div class="bg-white border shadow-sm max-w-[85%] sm:max-w-xl p-3 rounded-2xl inline-flex items-center gap-2">
        <span class="text-gray-400 text-sm">Thinking</span>
        <span class="flex gap-1">
          <span class="dot w-1.5 h-1.5 bg-gray-400 rounded-full"></span>
          <span class="dot w-1.5 h-1.5 bg-gray-400 rounded-full"></span>
          <span class="dot w-1.5 h-1.5 bg-gray-400 rounded-full"></span>
        </span>
      </div>
    </div>
  `;
  document.getElementById('messages').appendChild(typing);
  requestAnimationFrame(() => {
    const container = document.getElementById('messages');
    container.scrollTop = container.scrollHeight;
  });

  // Get LLM response
  const { answer, sources } = await chat(query);

  // Remove typing indicator
  typing.remove();

  messages.push({ role: 'assistant', content: answer, sources });
  saveMessages();
  
  renderMessages();
  
  input.disabled = false;
  document.getElementById('send-btn').disabled = false;
  input.focus();
};

// FIX: Corrected URL linkification — use a single capture-group regex
// and reference $1 properly, not $& mixed with $1.
function linkify(text) {
  // Match URLs not already inside an href attribute
  return text.replace(
    /(?<!['"=])(https?:\/\/[^\s<>"')]+)/g,
    '<a href="$1" target="_blank" class="text-blue-500 hover:underline font-medium">$1</a>'
  );
}

function saveMessages() {
  storageSet('chat_messages', JSON.stringify(messages));
}

function renderMessages() {
  const container = document.getElementById('messages');

  container.innerHTML = messages.map(m => {
    let content = m.content;

    if (m.role === 'assistant') {
      // Escape raw HTML
      content = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // Replace [1], [2], [3] citation markers with superscript links
      if (m.sources && m.sources.length) {
        content = content.replace(/\[(\d+)\]/g, (match, num) => {
          const idx = parseInt(num) - 1;
          const source = m.sources[idx];
          if (!source) return match;
          const title = source.title || source.url.split('/').pop() || `Source ${num}`;
          return `<a href="${source.url}" target="_blank" class="text-blue-600 hover:text-blue-800 font-semibold underline" title="${title}">[${num}]</a>`;
        });
      }

      content = linkify(content);

      // Build footnotes block from sources
      if (m.sources && m.sources.length) {
        const footnotes = m.sources.map((s, i) => {
          let title = s.title;
          if (!title || title === 'undefined') {
            title = s.url.split('/').pop()
              ?.replace(/-/g, ' ').replace(/\.html?$/, '').replace(/\?.*/, '') || 'Home';
          }
          return `<div class="flex items-start gap-1.5">
            <span class="text-gray-400 font-medium min-w-[1.2rem]">[${i+1}]</span>
            <a href="${s.url}" target="_blank" class="text-blue-600 hover:underline text-xs break-all">${title} — ${s.url}</a>
          </div>`;
        }).join('');

        content += `
          <div class="mt-3 pt-3 border-t border-gray-100 space-y-1">
            ${footnotes}
          </div>`;
      }
    }

    return `
      <div class="${m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}">
        <div class="${m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-white border shadow-sm'} max-w-[85%] sm:max-w-xl p-3 sm:p-4 rounded-2xl text-sm sm:text-base text-left">
          ${content.replace(/\n/g, '<br>')}
        </div>
      </div>
    `;
  }).join('');

  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

window.clearChat = function() {
  messages = [];
  saveMessages();
  renderMessages();
};

// FIX: Wire up both the Send button AND the Enter key
document.addEventListener('DOMContentLoaded', function() {
  const sendBtn = document.getElementById('send-btn');
  const input = document.getElementById('input');

  if (sendBtn) {
    sendBtn.addEventListener('click', ask);
  }

  if (input) {
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        ask();
      }
    });
  }

  // Restore previous chat on load
  if (messages.length) {
    renderMessages();
  }

  loadIndex();
});
