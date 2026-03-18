let llmEngine = null;
let embedder = null;  // query embedder — same model used at index build time

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

// Ranked model list — all use q4f32 (no shader-f16 required, works on all WebGPU setups)
// minMemoryGB = minimum navigator.deviceMemory to safely offer this model
// backend: 'webgpu' = MLC compiled, requires web-llm
//          'webnn'  = ONNX, requires Transformers.js + WebNN
//          'cpu'    = ONNX/WASM, Transformers.js CPU fallback
const MODELS = [
  // WebGPU models (MLC compiled)
  { id: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',  label: 'Qwen 2.5 1.5B (WebGPU)',       backend: 'webgpu', minMemoryGB: 4 },
  { id: 'gemma-2-2b-it-q4f32_1-MLC',           label: 'Gemma 2 2B (WebGPU)',           backend: 'webgpu', minMemoryGB: 6 },
  { id: 'Phi-3.5-mini-instruct-q4f32_1-MLC',   label: 'Phi-3.5 Mini 3.8B (WebGPU)',   backend: 'webgpu', minMemoryGB: 8 },
  { id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',   label: 'Llama 3.2 1B (WebGPU)',        backend: 'webgpu', minMemoryGB: 2 },
  // WebNN models (ONNX, runs on NPU/DirectML)
  { id: 'microsoft/Phi-3-mini-4k-instruct-onnx-web', label: 'Phi-3 Mini (WebNN/NPU)', backend: 'webnn',  minMemoryGB: 4 },
  { id: 'HuggingFaceTB/SmolLM2-360M-Instruct',       label: 'SmolLM2 360M (WebNN)',   backend: 'webnn',  minMemoryGB: 2 },
  // CPU WASM fallback
  { id: 'HuggingFaceTB/SmolLM2-135M-Instruct',       label: 'SmolLM2 135M (CPU)',     backend: 'cpu',    minMemoryGB: 1 },
];

// Detect device memory (GB). navigator.deviceMemory is rounded to nearest power of 2:
// 0.25, 0.5, 1, 2, 4, 8. Returns Infinity if API unavailable (desktop assumed capable).
function getDeviceMemoryGB() {
  return navigator.deviceMemory ?? Infinity;
}

// Detect which backend is available on this device
function detectAvailableBackend() {
  if (!window.isSecureContext) return 'none';
  if (isIOSSafari())           return 'none';
  if (navigator.gpu)           return 'webgpu'; // will verify adapter later
  if (navigator.ml)            return 'webnn';
  return 'cpu';
}

// Pick the best model for this device and backend
function pickDefaultModel() {
  const memGB   = getDeviceMemoryGB();
  const backend = detectAvailableBackend();
  console.log(`📱 Device memory: ${memGB === Infinity ? 'unknown (desktop)' : memGB + 'GB'}, backend hint: ${backend}`);

  // Prefer models matching the detected backend, within memory budget
  const preferred = MODELS.filter(m => m.backend === backend && memGB >= m.minMemoryGB);
  if (preferred.length) {
    console.log(`🤖 Auto-selected: ${preferred[0].label}`);
    return preferred[0].id;
  }

  // Fall back to best affordable model regardless of backend
  const viable = MODELS.filter(m => memGB >= m.minMemoryGB);
  const best   = viable[0] ?? MODELS[MODELS.length - 1];
  console.log(`🤖 Auto-selected (fallback): ${best.label}`);
  return best.id;
}

// Set the dropdown to the memory/backend-appropriate default
function setDefaultModel() {
  const sel = document.getElementById('model-select');
  if (!sel) return;

  const bestId  = pickDefaultModel();
  const memGB   = getDeviceMemoryGB();
  const backend = detectAvailableBackend();

  // Group options by backend — grey out unavailable backends and OOM models
  Array.from(sel.options).forEach(opt => {
    const model = MODELS.find(m => m.id === opt.value);
    if (!model) return;
    const tooLarge      = memGB !== Infinity && memGB < model.minMemoryGB;
    const wrongBackend  = backend !== 'none' && model.backend !== 'cpu' && model.backend !== backend;
    if (tooLarge) {
      opt.text += ' ⚠️ may OOM';
      opt.style.color = '#9ca3af';
    } else if (wrongBackend) {
      opt.style.color = '#9ca3af';
      opt.title = `Requires ${model.backend} — not detected on this device`;
    }
  });

  sel.value = bestId;
}

function getSelectedModel() {
  const sel = document.getElementById('model-select');
  return sel ? sel.value : pickDefaultModel();
}

function getMaxSources() {
  const el = document.getElementById('sources-count');
  return el ? parseInt(el.value) : 3;
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
  webnn:  null,
  model: null,
  loadProgress: null,
  failReason: null,
};

function updateEngineStatus() {
  const bar = document.getElementById('engine-status');
  if (!bar) return;

  const usingGPU = engineState.mode === 'llm' && !engineState.model?.includes('CPU') && !engineState.model?.includes('WebNN');
  const usingNPU = engineState.mode === 'llm' && engineState.webnn === true;

  const gpuBadge = usingGPU
    ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">⚡ WebGPU</span>`
    : usingNPU
    ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">🧠 WebNN</span>`
    : engineState.webgpu === false && engineState.webnn === false
    ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-200 text-gray-500">🚫 No WebGPU/WebNN</span>`
    : '';

  let modeBadge = '';
  let dot = '';

  if (engineState.mode === 'loading') {
    dot = '<span class="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></span>';
    const prog = engineState.loadProgress !== null ? ` ${engineState.loadProgress}%` : '';
    modeBadge = `<span class="text-yellow-700 font-medium">Loading LLM${prog}…</span>`;
  } else if (engineState.mode === 'llm') {
    dot = '<span class="inline-block w-2 h-2 rounded-full bg-green-500"></span>';
    const backend = engineState.webnn
      ? 'NPU'
      : engineState.model?.includes('CPU') ? 'CPU' : 'GPU';
    modeBadge = `<span class="text-green-700 font-medium">LLM active (${backend})</span>`;
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

// ---------------------------------------------------------------------------
// Index state — split across 3 files
// ---------------------------------------------------------------------------
let metaDocs    = [];          // [{ id, url, title }]
let embMatrix   = null;        // Float32Array, all embeddings packed flat
let textCache   = null;        // { [id]: text } — lazy loaded on first query
const DIMS      = 384;         // all-MiniLM-L6-v2 dimensions

// Load index - fetches index-meta.json + index-embeddings.bin in parallel
// Falls back to legacy index.json if split files not found
async function loadIndex() {
  const statusEl = document.getElementById('status');
  statusEl.textContent = 'Loading index…';
  updateEngineStatus();

  try {
    statusEl.textContent = 'Loading index (meta + embeddings)…';
    const [metaRes, binRes] = await Promise.all([
      fetch('index-meta.json'),
      fetch('index-embeddings.bin'),
    ]);
    if (!metaRes.ok || !binRes.ok) throw new Error('Index files not found — run build-index-gh-final.js first');

    const meta   = await metaRes.json();
    const binBuf = await binRes.arrayBuffer();

    metaDocs  = meta.documents;
    embMatrix = new Float32Array(binBuf);
    console.log(`✅ Index loaded — ${metaDocs.length} chunks, ${embMatrix.length} floats`);

    // Load query embedder
    if (embMatrix) {
      statusEl.textContent = 'Loading embedding model…';
      try {
        const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm');
        env.allowLocalModels = false;
        env.useBrowserCache  = true;
        embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' });
        console.log('✅ Query embedder loaded');
      } catch (e) {
        console.warn('⚠️ Embedder failed, falling back to keyword search:', e.message);
        embedder = null;
      }
    }

    statusEl.textContent = `Loaded ${metaDocs.length} chunks. Initializing LLM…`;

    if (messages.length === 0) generateWelcome();

    await initLLM();
    statusEl.textContent = `✅ Ready to chat! (${metaDocs.length} chunks)`;

  } catch (e) {
    console.error('❌ Index load failed:', e);
    statusEl.textContent = `Error: ${e.message}`;
    engineState.mode = 'error';
    updateEngineStatus();
  }
}

// Lazy-load index-text.json on first query
async function ensureTextLoaded() {
  if (textCache) return;
  try {
    const res = await fetch('index-text.json');
    textCache = await res.json();
    console.log('✅ index-text.json loaded');
  } catch (e) {
    console.error('❌ Failed to load index-text.json:', e);
    textCache = {};
  }
}

// Get text for a chunk id — falls back to empty string
function getText(id) {
  return textCache?.[id] ?? textCache?.[String(id)] ?? '';
}

// Initialize WebLLM — tries WebGPU first, falls back to CPU via Transformers.js
// Skips both on iOS Safari where neither works reliably without special server headers
async function initLLM() {

  // --- Secure context check ---
  // WebGPU, WebNN, and SharedArrayBuffer (WASM threads) all require HTTPS or localhost.
  // Plain http:// on a LAN address silently disables all of them.
  if (!window.isSecureContext) {
    engineState.webgpu = false;
    engineState.webnn  = false;
    engineState.mode   = 'fallback';
    engineState.failReason = 'http:// detected — serve over https:// or localhost for LLM';
    updateEngineStatus();

    // Show a persistent warning banner above the chat
    const messages = document.getElementById('messages');
    if (messages && !document.getElementById('secure-context-warning')) {
      const banner = document.createElement('div');
      banner.id = 'secure-context-warning';
      banner.className = 'mx-3 mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800';
      banner.innerHTML = `
        <strong>⚠️ LLM unavailable — insecure context</strong><br>
        This page is served over <code>http://</code> on a network address.
        WebGPU, WebNN, and WASM threads all require a secure context.<br><br>
        <strong>To enable LLM:</strong><br>
        • Use <code>http://localhost</code> (always secure)<br>
        • Or serve with HTTPS: <code>npx serve . --ssl-cert cert.pem --ssl-key key.pem</code><br>
        • Or generate a local cert: <code>mkcert localhost 192.168.x.x</code>
      `;
      messages.parentNode.insertBefore(banner, messages);
    }

    console.warn('⚠️ Not a secure context — WebGPU/WebNN/WASM threads unavailable');
    return;
  }

  // iOS Safari: web-llm compute shaders unsupported, Transformers.js needs
  // COOP/COEP headers for SharedArrayBuffer — skip LLM entirely.
  if (isIOSSafari()) {
    engineState.webgpu = false;
    engineState.webnn  = false;
    engineState.mode = 'fallback';
    engineState.failReason = 'iOS Safari — LLM requires server headers (COOP/COEP)';
    updateEngineStatus();
    const row = document.getElementById('model-selector-row');
    if (row) row.classList.add('hidden');
    console.log('⚠️ iOS Safari detected — skipping LLM, using template mode');
    return;
  }

  // --- Attempt 1: WebGPU via web-llm ---
  const hasGpuAPI = !!navigator.gpu;
  engineState.webgpu = hasGpuAPI;
  engineState.webnn  = false;

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

  // --- Attempt 2: WebNN via Transformers.js ---
  if (typeof navigator.ml !== 'undefined') {
    engineState.mode = 'loading';
    engineState.loadProgress = 0;
    engineState.failReason = null;
    updateEngineStatus();
    console.log('🧠 WebNN API detected — trying NPU path…');

    try {
      const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm');
      env.allowLocalModels = false;
      env.useBrowserCache  = true;

      // Use the dropdown selection if it's a WebNN model, otherwise default to Phi-3 Mini
      const selectedId = getSelectedModel();
      const selectedMeta = MODELS.find(m => m.id === selectedId);
      const MODEL = (selectedMeta?.backend === 'webnn')
        ? selectedId
        : 'microsoft/Phi-3-mini-4k-instruct-onnx-web';

      const pipe = await pipeline('text-generation', MODEL, {
        device: 'webnn',
        dtype:  'q4',
        progress_callback: (p) => {
          if (p.progress != null) {
            engineState.loadProgress = Math.round(p.progress);
            updateEngineStatus();
          }
        }
      });

      llmEngine = wrapTransformersPipe(pipe);
      engineState.mode   = 'llm';
      engineState.model  = `${MODEL} (WebNN)`;
      engineState.webnn  = true;
      engineState.loadProgress = null;
      engineState.failReason   = null;
      updateEngineStatus();
      console.log('✅ Transformers.js (WebNN/NPU) loaded');
      return;
    } catch (e) {
      console.warn('WebNN attempt failed:', e.message);
      engineState.webnn = false;
    }
  }

  // --- Attempt 3: CPU via Transformers.js WASM ---
  engineState.mode = 'loading';
  engineState.loadProgress = 0;
  engineState.failReason = null;
  updateEngineStatus();

  try {
    const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm');
    env.allowLocalModels = false;
    env.useBrowserCache  = true;

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

    llmEngine = wrapTransformersPipe(pipe);
    engineState.mode   = 'llm';
    engineState.model  = `${MODEL} (CPU)`;
    engineState.loadProgress = null;
    engineState.failReason   = null;
    updateEngineStatus();
    console.log('✅ Transformers.js (CPU/WASM) loaded');

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

// Wrap a Transformers.js pipeline into the web-llm-compatible interface
function wrapTransformersPipe(pipe) {
  return {
    _pipe: pipe,
    chat: {
      completions: {
        create: async ({ messages, temperature }) => {
          const result = await pipe(messages, {
            max_new_tokens: 512,
            temperature:    temperature ?? 0.1,
            do_sample:      (temperature ?? 0.1) > 0,
          });
          const text = result[0]?.generated_text?.at(-1)?.content ?? '';
          return { choices: [{ message: { content: text } }] };
        }
      }
    }
  };
}

// Remove repeated sentences from LLM output — common with small models
function deduplicateSentences(text) {
  // Split on sentence-ending punctuation, keeping the delimiter
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  const seen = new Set();
  const result = [];

  for (const raw of sentences) {
    // Normalise for comparison: lowercase, collapse whitespace, strip citations
    const key = raw.toLowerCase().replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
    if (key.length < 8) { result.push(raw); continue; } // keep short fragments
    if (!seen.has(key)) {
      seen.add(key);
      result.push(raw);
    }
  }
  return result.join('').trim();
}

// Cosine similarity between two Float32Arrays (or plain arrays)
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

// Semantic search using packed Float32Array embeddings, keyword fallback
async function search(query, k = 5) {
  if (!metaDocs.length) return [];

  // --- Semantic search ---
  if (embedder && embMatrix) {
    try {
      const output   = await embedder(query, { pooling: 'mean', normalize: true });
      const queryVec = new Float32Array(output.data);

      return metaDocs
        .map((doc, i) => {
          const slice = embMatrix.subarray(i * DIMS, (i + 1) * DIMS);
          const sim   = cosineSimilarity(queryVec, slice);
          // Boost contact chunks — they contain info (address, phone, name)
          // that tends to be semantically distant from how users phrase queries
          const boost = doc.type === 'contact' ? 0.15 : 0;
          return { ...doc, score: sim + boost };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    } catch (e) {
      console.warn('Semantic search failed, falling back to keyword:', e.message);
    }
  }

  // --- Keyword fallback (uses textCache if loaded, else titles/urls only) ---
  await ensureTextLoaded();
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  return metaDocs
    .map(doc => {
      const text = getText(doc.id).toLowerCase();
      let score = 0.5;
      if (text.includes(query.toLowerCase())) score += 3;
      queryWords.forEach(word => {
        if (text.includes(word)) score += 1;
        if (doc.title?.toLowerCase().includes(word)) score += 2;
        if (doc.url.toLowerCase().includes(word)) score += 1;
      });
      return { ...doc, score: score / Math.max(1, queryWords.length + 1) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// Category definitions — matched against URL slug and title
const CATEGORIES = [
  {
    name: 'reports',
    urlPatterns: [/\/rpt-/],
    titlePatterns: [/report/i],
    keywords: ['report', 'reports'],
  },
  {
    name: 'seller resources',
    urlPatterns: [/\/(sellers?|sell_|seller_|seminar_|coaching_|gold_|silver_|savethousands|homeeval|insideraccess|inspection)/],
    titlePatterns: [/sell|seller|listing|price|seminar|coaching/i],
    keywords: ['seller', 'sellers', 'selling', 'sell', 'seller resource', 'seller resources'],
  },
  {
    name: 'buyer resources',
    urlPatterns: [/\/(buyers?|buyer_|gc_|buyertraps?|vip_buyer|zerodown|stop_renting|27tips|agent_questions|homewardbound)/],
    titlePatterns: [/buy|buyer|home guide|first.?time|down payment/i],
    keywords: ['buyer', 'buyers', 'buying', 'buy', 'buyer resource', 'buyer resources'],
  },
  {
    name: 'landing pages',
    urlPatterns: [/\/lp-/],
    titlePatterns: [],
    keywords: ['landing page', 'landing pages', 'campaigns'],
  },
  {
    name: 'coaching',
    urlPatterns: [/\/coaching_/],
    titlePatterns: [/coaching/i],
    keywords: ['coaching'],
  },
  {
    name: 'seminars',
    urlPatterns: [/\/seminar_/],
    titlePatterns: [/seminar/i],
    keywords: ['seminar', 'seminars'],
  },
];

function detectCategoryQuery(query) {
  const q = query.toLowerCase().trim();
  // Require an explicit listing/overview intent word before checking category keywords
  const hasListingIntent = /^(list|show|give me|display|what are|overview of|summarize)\b/.test(q) ||
    /\b(all|every)\b.{0,20}\b(report|seller|buyer|landing|coaching|seminar)\b/.test(q);
  if (!hasListingIntent) return null;
  return CATEGORIES.find(cat => cat.keywords.some(kw => q.includes(kw))) ?? null;
}

async function handleCategoryQuery(category) {
  await ensureTextLoaded();

  const seen = new Set();
  const pages = [];

  for (const doc of metaDocs) {
    if (seen.has(doc.url)) continue;
    const slug = doc.url.split('/').pop() ?? '';
    const matchesUrl   = category.urlPatterns.some(re => re.test('/' + slug));
    const matchesTitle = category.titlePatterns.some(re => re.test(doc.title ?? ''));
    if (matchesUrl || matchesTitle) {
      seen.add(doc.url);
      const text = getText(doc.id).replace(/\s+/g, ' ').trim().substring(0, 200);
      pages.push({ url: doc.url, title: doc.title, snippet: text });
    }
  }

  if (pages.length === 0) {
    return {
      answer: `No pages found matching **${category.name}** in the index.`,
      sources: []
    };
  }

  const answer = `Here are the **${pages.length} ${category.name}** on this site:\n\n` +
    pages.map((p, i) =>
      `[${i + 1}] **${p.title || p.url}**\n${p.snippet}…`
    ).join('\n\n');

  return {
    answer,
    sources: pages.map((p, i) => ({ id: i, url: p.url, title: p.title, score: 1 }))
  };
}

// Handle meta-queries — list all pages
function handleMetaQuery() {
  const seen = new Set();
  const pages = [];
  for (const doc of metaDocs) {
    if (!seen.has(doc.url)) {
      seen.add(doc.url);
      pages.push({ url: doc.url, title: doc.title });
    }
  }
  const answer = `This site has **${pages.length} indexed pages**:\n\n` +
    pages.map((p, i) => `[${i + 1}] ${p.title || p.url}`).join('\n');
  return {
    answer,
    sources: pages.map((p, i) => ({ id: i, url: p.url, title: p.title, score: 1 }))
  };
}

// Handle summary queries — first snippet of each page
async function handleSummaryQuery() {
  await ensureTextLoaded();
  const seen = new Set();
  const pages = [];
  for (const doc of metaDocs) {
    if (!seen.has(doc.url)) {
      seen.add(doc.url);
      const snippet = getText(doc.id).replace(/\s+/g, ' ').trim().substring(0, 200);
      pages.push({ url: doc.url, title: doc.title, snippet });
    }
  }
  const answer = `Here's a summary of all **${pages.length} pages** on this site:\n\n` +
    pages.map((p, i) => `[${i + 1}] **${p.title || p.url}**\n${p.snippet}…`).join('\n\n');
  return {
    answer,
    sources: pages.map((p, i) => ({ id: i, url: p.url, title: p.title, score: 1 }))
  };
}

// ---------------------------------------------------------------------------
// Meta-query dispatch
//
// Preferred: use %SYSTEM% prefix for explicit admin commands, e.g.:
//   %SYSTEM% list urls
//   %SYSTEM% summarize pages
//   %SYSTEM% seller resources
//   %SYSTEM% buyer resources
//   %SYSTEM% reports
//   %SYSTEM% count
//
// NLP detection below is kept as a fallback for obvious cases only,
// with tight patterns to minimise false positives on normal queries.
// ---------------------------------------------------------------------------

const SYSTEM_PREFIX = /^%system%\s*/i;

function parseSystemCommand(query) {
  if (!SYSTEM_PREFIX.test(query)) return null;
  const cmd = query.replace(SYSTEM_PREFIX, '').trim().toLowerCase();

  if (/^(list\s+)?(all\s+)?(url|urls|pages|links)$/.test(cmd) || cmd === 'list' || cmd === 'urls') {
    return 'list-urls';
  }
  if (/^(summarize?|summary|overview)(\s+all)?(\s+pages?)?$/.test(cmd)) {
    return 'summarize-pages';
  }
  if (/^(count|how many)$/.test(cmd)) {
    return 'count';
  }
  // Check category keywords
  const matchedCat = CATEGORIES.find(cat => cat.keywords.some(kw => cmd.includes(kw)));
  if (matchedCat) return { type: 'category', category: matchedCat };

  // Unknown system command — show help
  return 'help';
}

// Fallback NLP detection — tight patterns only, for the most obvious cases
function detectMetaQuery(query) {
  const q = query.toLowerCase().trim();
  return (
    /^(list|dump|show|print|display)\s+(all\s+)?(url|urls|pages|links)$/.test(q) ||
    /^how many (pages|urls|documents|files)(\s+do you have)?$/.test(q)
  );
}

function detectSummaryQuery(query) {
  const q = query.toLowerCase().trim();
  return /^(summarize|overview of|describe)\s+all\s+(pages|urls|content)$/.test(q) ||
    /^(each page|all pages|every page)$/.test(q);
}

function detectCategoryQuery(query) {
  const q = query.toLowerCase().trim();
  const hasListingIntent = /^(list|show|give me all|display all)\s/.test(q);
  if (!hasListingIntent) return null;
  return CATEGORIES.find(cat => cat.keywords.some(kw => q.includes(kw))) ?? null;
}

// RAG + LLM generation
async function chat(query) {

  // --- %SYSTEM% prefix: explicit admin command, zero false positives ---
  const sysCmd = parseSystemCommand(query);
  if (sysCmd) {
    if (sysCmd === 'list-urls')       return handleMetaQuery(query);
    if (sysCmd === 'summarize-pages') return await handleSummaryQuery();
    if (sysCmd === 'count') {
      const n = new Set(metaDocs.map(d => d.url)).size;
      return { answer: `The index contains **${n} unique pages**.`, sources: [] };
    }
    if (sysCmd?.type === 'category')  return await handleCategoryQuery(sysCmd.category);
    if (sysCmd === 'help') {
      return {
        answer: `**%SYSTEM% commands:**\n\n` +
          `\`%SYSTEM% urls\` — list all indexed URLs\n` +
          `\`%SYSTEM% summarize\` — summarize every page\n` +
          `\`%SYSTEM% count\` — how many pages are indexed\n` +
          `\`%SYSTEM% seller resources\` — seller pages\n` +
          `\`%SYSTEM% buyer resources\` — buyer pages\n` +
          `\`%SYSTEM% reports\` — report pages\n` +
          `\`%SYSTEM% coaching\` — coaching pages\n` +
          `\`%SYSTEM% seminars\` — seminar pages\n` +
          `\`%SYSTEM% landing pages\` — landing pages`,
        sources: []
      };
    }
  }

  // --- Fallback NLP detection for obvious cases ---
  const matchedCategory = detectCategoryQuery(query);
  if (matchedCategory) return await handleCategoryQuery(matchedCategory);
  if (detectSummaryQuery(query))  return await handleSummaryQuery();
  if (detectMetaQuery(query))     return handleMetaQuery(query);

  // --- Normal RAG path ---

  const maxSources = getMaxSources();
  // Fetch enough candidates to find maxSources unique URLs even if chunks cluster
  const sources = await search(query, maxSources * 3);

  if (sources.length === 0) {
    return { answer: "No relevant content found in your site.", sources: [] };
  }

  // Dedupe to at most maxSources unique URLs — naturally fewer if not enough distinct pages match
  const uniqueSources = [];
  const seenUrls = new Set();
  sources.forEach(s => {
    if (!seenUrls.has(s.url) && uniqueSources.length < maxSources) {
      seenUrls.add(s.url);
      uniqueSources.push(s);
    }
  });

  // Attach a short snippet to each source for footnote display
  await ensureTextLoaded();
  uniqueSources.forEach(s => {
    if (!s.snippet) {
      s.snippet = getText(s.id).replace(/\s+/g, ' ').trim().substring(0, 120);
    }
  });

  // LLM path
  if (llmEngine) {
    try {
      const trimmedContext = uniqueSources.map((s, i) =>
        `[${i+1}] ${getText(s.id).substring(0, 400)}`
      ).join('\n\n');

      console.log('📤 Sending context to LLM:\n', trimmedContext);

      // Build recent history — last 3 exchanges (6 messages), excluding
      // welcome messages and the current user message (already in query)
      const HISTORY_EXCHANGES = 3;
      const history = messages
        .filter(m => !m.isWelcome && m.role !== 'user' || !m.isWelcome)
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-(HISTORY_EXCHANGES * 2 + 1), -1) // exclude the current message
        .map(m => ({
          role: m.role,
          // For assistant messages strip footnote HTML, keep plain text
          content: m.role === 'assistant'
            ? m.content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().substring(0, 300)
            : m.content
        }));

      const reply = await llmEngine.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: `You are a knowledgeable, helpful assistant for a real estate website. Answer the user's question thoroughly and with nuance using ONLY the numbered passages below. You may use conversation history for follow-up context.

Guidelines:
- Give complete, well-reasoned answers — don't just echo the passage text
- Explain the "why" behind facts where the passages support it
- If multiple passages are relevant, synthesize them into a coherent answer
- Cite passages inline as [1], [2], [3] only where directly relevant
- If the passages don't contain enough to answer well, say so briefly
- Never repeat the same point twice

Passages:\n${trimmedContext}`
          },
          ...history,
          {
            role: 'user',
            content: query
          }
        ],
        temperature: 0.4,
        repetition_penalty: 1.3,
        max_tokens: 400
      });

      const raw = reply.choices[0].message.content;

      // Strip duplicate sentences — split on ., !, ? then dedupe preserving order
      const deduped = deduplicateSentences(raw);
      const answer = deduped
        .replace(/\n+\[?\d+\]?\s*https?:\/\/\S+/g, '')
        .replace(/\n+(sources|references|source list|cited|links)[\s\S]*/gi, '')
        .replace(/\n+\[\d+\][^\n]*/g, '')
        .trimEnd();
      return { answer, sources: uniqueSources };
    } catch (e) {
      console.warn('LLM failed, falling back to template:', e);
    }
  }

  // Template fallback
  const answer = `Here's what I found on the site:\n\n` +
    uniqueSources.map((s, i) => `[${i+1}] ${getText(s.id).substring(0, 300)}...`).join('\n\n');

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

      // Render **bold** markdown
      content = content.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

      // Build footnotes block from sources
      if (m.sources && m.sources.length) {
        const footnotes = m.sources.map((s, i) => {
          let title = s.title;
          if (!title || title === 'undefined') {
            title = s.url.split('/').pop()
              ?.replace(/-/g, ' ').replace(/\.html?$/, '').replace(/\?.*/, '') || 'Home';
          }
          const snippet = s.snippet
            ? `<div class="text-gray-500 text-xs mt-0.5">${s.snippet}…</div>`
            : '';
          return `<div class="flex items-start gap-1.5 mb-2">
            <span class="text-gray-400 font-medium min-w-[1.2rem]">[${i+1}]</span>
            <div>
              <a href="${s.url}" target="_blank" class="text-blue-600 hover:underline text-xs font-medium">${title}</a>
              <div class="text-gray-400 text-xs">${s.url}</div>
              ${snippet}
            </div>
          </div>`;
        }).join('');

        content += `
          <div class="mt-3 pt-3 border-t border-gray-100">
            ${footnotes}
          </div>`;
      }
    }

    return `
      <div class="${m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}">
        <div class="${
          m.role === 'user'
            ? 'bg-blue-500 text-white'
            : m.isWelcome
            ? 'bg-blue-50 border border-blue-100 text-gray-700'
            : 'bg-white border shadow-sm'
        } max-w-[85%] sm:max-w-xl p-3 sm:p-4 rounded-2xl text-sm sm:text-base text-left">
          ${content.replace(/\n/g, '<br>')}
        </div>
      </div>
    `;
  }).join('');

  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

// Generate a welcome message summarising the site from the index — no LLM needed
async function generateWelcome() {
  if (!metaDocs.length) return;

  const seen = new Set();
  const sample = [];
  for (const doc of metaDocs) {
    if (!seen.has(doc.url)) {
      seen.add(doc.url);
      sample.push(doc);
      if (sample.length >= 8) break;
    }
  }

  // Unique page titles
  const titles = [...new Set(sample.map(s => s.title).filter(t => t && t !== 'Untitled'))];

  // Build welcome instantly from titles
  const topicList = titles.length
    ? titles.slice(0, 6).join(', ')
    : 'various topics';

  const welcomeText = `👋 Welcome! This site covers **${topicList}**${titles.length > 6 ? ` and more` : ''}.\n\nAsk me anything about it.`;

  messages.push({ role: 'assistant', content: welcomeText, sources: [], isWelcome: true });
  renderMessages();
}

window.clearChat = function() {
  messages = [];
  saveMessages();
  renderMessages();
  // Re-show welcome on clear
  generateWelcome();
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

  // Set memory-appropriate default model before loading index
  setDefaultModel();

  // Restore previous chat on load
  if (messages.length) {
    renderMessages();
  }

  loadIndex();
});
