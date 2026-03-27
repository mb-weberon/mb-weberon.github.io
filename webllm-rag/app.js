let llmEngine = null;
let embedder = null;  // query embedder — same model used at index build time

// Safe localStorage — Safari private mode throws on access
function storageGet(key) {
  try { return localStorage.getItem(key); } catch(e) { return null; }
}
function storageSet(key, val) {
  try { localStorage.setItem(key, val); } catch(e) {}
}

let messages = JSON.parse(storageGet(RAGConfig.KEYS.chatMessages) || '[]');

// Detect iOS Safari — WebGPU exists but web-llm compute shaders don't work,
// and Transformers.js WASM threading requires COOP/COEP headers not sent by basic servers
function isIOSSafari() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && /WebKit/.test(ua) && !/CriOS|FxiOS|OPiOS/.test(ua);
}

// Models are loaded from RAGConfig (config.js) — see DEFAULT_MODELS for the list
// Use RAGConfig.models at runtime; this getter always reflects current config
function getModels() { return RAGConfig.models; }

// Detect device memory (GB). navigator.deviceMemory is rounded to nearest power of 2:
// 0.25, 0.5, 1, 2, 4, 8. Returns Infinity if API unavailable (desktop assumed capable).
function getDeviceMemoryGB() {
  return navigator.deviceMemory ?? Infinity;
}

// Detect which backends are available on this device.
// Returns an object with flags for each backend rather than a single winner —
// a device can have both WebGPU and WebNN available simultaneously.
async function detectAvailableBackends() {
  const result = {
    secureContext: window.isSecureContext,
    isIOSSafari:   isIOSSafari(),
    webgpu:        false,
    webgpuAdapter: false,
    webnn:         false,
    webnnDevice:   null,   // 'npu' | 'gpu' | 'cpu' | null
    wasm:          typeof WebAssembly !== 'undefined',
  };

  console.group('🔍 Backend detection');
  console.log('Secure context:', result.secureContext);
  console.log('iOS Safari:', result.isIOSSafari);
  console.log('navigator.gpu present:', !!navigator.gpu);
  console.log('navigator.ml present:', !!navigator.ml);
  console.log('WebAssembly present:', result.wasm);

  if (!result.secureContext) {
    console.warn('⚠️ Not a secure context — all ML APIs unavailable');
    console.groupEnd();
    return result;
  }

  if (result.isIOSSafari) {
    console.warn('⚠️ iOS Safari — skipping ML API checks');
    console.groupEnd();
    return result;
  }

  // --- WebGPU ---
  if (navigator.gpu) {
    result.webgpu = true;
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        result.webgpuAdapter = true;
        const info = await adapter.requestAdapterInfo?.() ?? {};
        console.log('✅ WebGPU adapter found:', {
          vendor:       info.vendor      ?? 'unknown',
          architecture: info.architecture ?? 'unknown',
          device:       info.device       ?? 'unknown',
          description:  info.description  ?? 'unknown',
        });
      } else {
        console.warn('⚠️ WebGPU API present but no adapter returned');
      }
    } catch (e) {
      console.warn('⚠️ WebGPU adapter request failed:', e.message);
    }
  } else {
    console.log('❌ WebGPU not available (navigator.gpu absent)');
  }

  // --- WebNN ---
  if (navigator.ml) {
    result.webnn = true;
    // Try to get a context for each device type to see what's actually available
    for (const deviceType of ['npu', 'gpu', 'cpu']) {
      try {
        const ctx = await navigator.ml.createContext({ deviceType });
        if (ctx) {
          result.webnnDevice = deviceType;
          console.log(`✅ WebNN context created — device: ${deviceType}`);
          break;
        }
      } catch (e) {
        console.log(`   WebNN ${deviceType}: ${e.message}`);
      }
    }
    if (!result.webnnDevice) {
      console.warn('⚠️ navigator.ml present but no WebNN context could be created');
      result.webnn = false;
    }
  } else {
    console.log('❌ WebNN not available (navigator.ml absent)');
    console.log('   On Edge/Chrome Windows: check edge://flags or chrome://flags for WebNN');
  }

  console.log('\n📊 Backend summary:', {
    webgpu:      result.webgpuAdapter ? '✅ adapter ready' : result.webgpu ? '⚠️ API only, no adapter' : '❌',
    webnn:       result.webnn ? `✅ ${result.webnnDevice}` : '❌',
    wasm:        result.wasm ? '✅' : '❌',
  });
  console.groupEnd();

  return result;
}

// Cache detected backends after first call
let _detectedBackends = null;
async function getBackends() {
  if (!_detectedBackends) _detectedBackends = await detectAvailableBackends();
  return _detectedBackends;
}

// Synchronous hint for UI — used before async detection completes
// Errs on the side of showing all options rather than hiding them
function detectAvailableBackend() {
  if (!window.isSecureContext) return 'none';
  if (isIOSSafari())           return 'none';
  // If WebNN is present, prefer it over WebGPU for model selection hint
  // (actual capability verified async in initLLM)
  if (navigator.ml)  return 'webnn';
  if (navigator.gpu) return 'webgpu';
  return 'cpu';
}

// Update dropdown graying once async detection completes
async function updateModelSelectorWithBackends() {
  const backends = await getBackends();
  const sel = document.getElementById('model-select');
  if (!sel) return;

  Array.from(sel.options).forEach(opt => {
    const model = getModels().find(m => m.id === opt.value);
    if (!model) return;

    // Reset previous styling
    opt.style.color = '';
    opt.title = '';

    const memGB    = getDeviceMemoryGB();
    const tooLarge = memGB !== Infinity && memGB < model.minMemoryGB;

    if (tooLarge) {
      opt.text  = opt.text.replace(' ⚠️ may OOM', '') + ' ⚠️ may OOM';
      opt.style.color = '#9ca3af';
      return;
    }

    if (model.backend === 'webgpu' && !backends.webgpuAdapter) {
      opt.style.color = '#9ca3af';
      opt.title = 'WebGPU adapter not available on this device';
    } else if (model.backend === 'webnn' && !backends.webnn) {
      opt.style.color = '#9ca3af';
      opt.title = `WebNN not available — navigator.ml: ${!!navigator.ml}, secure context: ${backends.secureContext}`;
    }
  });

  // Re-select best model based on actual detected backends
  const bestBackend = backends.webnn ? 'webnn'
    : backends.webgpuAdapter ? 'webgpu'
    : 'cpu';
  const viable = getModels().filter(m => {
    const memOk      = getDeviceMemoryGB() >= m.minMemoryGB || getDeviceMemoryGB() === Infinity;
    const backendOk  = m.backend === bestBackend || m.backend === 'cpu';
    return memOk && backendOk;
  });
  if (viable.length && !storageGet(RAGConfig.KEYS.selectedModel) && engineState.mode !== 'llm') {
    sel.value = viable[0].id;
    console.log(`🤖 Model selector updated to: ${viable[0].label}`);
  }
}

// Pick the best model for this device and backend
function pickDefaultModel() {
  const memGB   = getDeviceMemoryGB();
  const backend = detectAvailableBackend();
  console.log(`📱 Device memory: ${memGB === Infinity ? 'unknown (desktop)' : memGB + 'GB'}, backend hint: ${backend}`);

  // Prefer models matching the detected backend, within memory budget
  const preferred = getModels().filter(m => m.backend === backend && memGB >= m.minMemoryGB);
  if (preferred.length) {
    console.log(`🤖 Auto-selected: ${preferred[0].label}`);
    return preferred[0].id;
  }

  // Fall back to best affordable model regardless of backend
  const viable = getModels().filter(m => memGB >= m.minMemoryGB);
  const best   = viable[0] ?? getModels()[getModels().length - 1];
  console.log(`🤖 Auto-selected (fallback): ${best.label}`);
  return best.id;
}

// Set the dropdown to the memory/backend-appropriate default
function setDefaultModel() {
  const sel = document.getElementById('model-select');
  if (!sel) return;

  // If we have a stored model (loaded or manually chosen), restore it —
  // this is the value syncDropdownToLoadedModel wrote, so it survives
  // buildModelDropdown() wiping innerHTML
  const stored = storageGet(RAGConfig.KEYS.selectedModel);
  if (stored) {
    const exists = Array.from(sel.options).some(o => o.value === stored);
    if (exists) { sel.value = stored; return; }
  }

  // Nothing stored yet — pick the best default for this device
  sel.value = pickDefaultModel();
}

function getSelectedModel() {
  const sel = document.getElementById('model-select');
  return sel ? sel.value : pickDefaultModel();
}

// Remember user's manual model choice so auto-detection doesn't override it
window.onModelChange = function() {
  storageSet(RAGConfig.KEYS.selectedModel, getSelectedModel());
  const btn = document.getElementById('reload-model-btn');
  if (btn) btn.classList.add('visible');
};

function getMaxSources() {
  const el = document.getElementById('sources-count');
  return el ? parseInt(el.value) : 3;
}

// Called when user clicks Load after changing model
window.reloadModel = async function() {
  const selected = getSelectedModel();

  // No-op if the selected model is already what's running
  if (engineState.mode === 'llm' && engineState.model && engineState.model.startsWith(selected)) {
    const btn = document.getElementById('reload-model-btn');
    if (btn) btn.classList.remove('visible');
    console.log('ℹ️ Selected model already loaded — skipping reload');
    return;
  }

  const btn = document.getElementById('reload-model-btn');
  if (btn) btn.classList.remove('visible');
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
    ? (() => {
        // Find the short label for the loaded model, fall back to a trimmed ID
        const found = getModels().find(m => engineState.model.startsWith(m.id));
        const shortLabel = found
          ? found.label
          : engineState.model.split('/').pop().replace(/-q4.*/, '').slice(0, 30);
        return `<span class="text-gray-400 text-xs">${shortLabel}</span>`;
      })()
    : '';

  bar.innerHTML = `
    <div class="flex items-center gap-2 flex-wrap">
      ${dot} ${modeBadge} ${gpuBadge} ${modelLabel}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Per-message related questions (in-memory only, not persisted)
// ---------------------------------------------------------------------------
const messageRelated = new Map();  // msgIndex (int) → string[]

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
    loadInitialQuestions();

    await initLLM();
    statusEl.textContent = `✅ Ready to chat! (${metaDocs.length} chunks)`;

  } catch (e) {
    console.error('❌ Index load failed:', e);
    statusEl.textContent = `Error: ${e.message}`;
    engineState.mode = 'error';
    updateEngineStatus();
  }
}

// Refresh index files AND question panel JS without reloading the LLM or the page.
// Cache-busts index files and reinjects app-hot.js as a new script tag,
// overwriting live function definitions without touching the loaded model.
window.refreshIndex = async function() {
  const statusEl = document.getElementById('status');
  statusEl.textContent = 'Refreshing…';
  const t = Date.now();
  try {
    // Reload index data
    const [metaRes, binRes] = await Promise.all([
      fetch(`index-meta.json?t=${t}`),
      fetch(`index-embeddings.bin?t=${t}`),
    ]);
    if (!metaRes.ok || !binRes.ok) throw new Error('Index files not found');
    const meta   = await metaRes.json();
    const binBuf = await binRes.arrayBuffer();
    metaDocs  = meta.documents;
    embMatrix = new Float32Array(binBuf);
    textCache = null;
    console.log(`✅ Index refreshed — ${metaDocs.length} chunks`);

    // Reload app-hot.js — overwrites window.renderQuestions, selectDiverse etc.
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `app-hot.js?t=${t}`;
      s.onload  = resolve;
      s.onerror = () => reject(new Error('app-hot.js failed to load'));
      document.head.appendChild(s);
    });

    loadInitialQuestions();
    statusEl.textContent = `✅ Refreshed (${metaDocs.length} chunks)`;
  } catch (e) {
    console.error('❌ Refresh failed:', e);
    statusEl.textContent = `Refresh failed: ${e.message}`;
  }
};

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
  // Probe adapter fresh here — don't use cached detectAvailableBackends()
  // because that probe runs too early (before GPU process warms up) and
  // caches a false negative that blocks this attempt.
  const hasGpuAPI = !!navigator.gpu;
  engineState.webgpu = hasGpuAPI;
  engineState.webnn  = false;

  if (hasGpuAPI) {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new Error('No WebGPU adapter returned');

      console.log('✅ WebGPU adapter obtained — loading web-llm…');
      engineState.mode = 'loading';
      engineState.loadProgress = 0;
      updateEngineStatus();

      const webllm = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm/+esm');
      const MODEL  = getSelectedModel();

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
      syncDropdownToLoadedModel(MODEL);
      updateEngineStatus();
      console.log('✅ WebLLM (WebGPU) loaded');
      return;
    } catch (e) {
      console.warn('WebGPU/web-llm failed:', e.message);
    }
  }

  // --- Attempt 2: WebNN via Transformers.js ---
  if (navigator.ml) {
    engineState.mode = 'loading';
    engineState.loadProgress = 0;
    engineState.failReason = null;
    updateEngineStatus();
    console.log('🧠 WebNN API detected — trying NPU path…');

    try {
      const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm');
      env.allowLocalModels = false;
      env.useBrowserCache  = true;

      // Use the dropdown selection if it's a WebNN model, otherwise default to Qwen2.5 0.5B
      const selectedId   = getSelectedModel();
      const selectedMeta = getModels().find(m => m.id === selectedId);
      const MODEL = (selectedMeta?.backend === 'webnn')
        ? selectedId
        : 'onnx-community/Qwen2.5-0.5B-Instruct';

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
      syncDropdownToLoadedModel(MODEL);
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
    syncDropdownToLoadedModel(MODEL);
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

// Wrap a Transformers.js pipeline into the web-llm-compatible streaming interface
function wrapTransformersPipe(pipe) {
  return {
    _pipe: pipe,
    chat: {
      completions: {
        create: async ({ messages, temperature, max_tokens, stream, signal }) => {
          // Transformers.js doesn't support streaming natively —
          // run inference then yield the full result as a single chunk
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

          const result = await pipe(messages, {
            max_new_tokens: max_tokens ?? 512,
            temperature:    temperature ?? 0.1,
            do_sample:      (temperature ?? 0.1) > 0,
          });

          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

          const text = result[0]?.generated_text?.at(-1)?.content ?? '';

          if (stream) {
            // Return an async iterable that yields one chunk then done
            return (async function*() {
              yield { choices: [{ delta: { content: text } }] };
            })();
          }
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
          const boost = doc.type === 'contact' ? RAGConfig.get('retrieval.contactBoost') : 0;
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
      const text = getText(doc.id).replace(/\s+/g, ' ').trim().substring(0, RAGConfig.get("retrieval.footnoteSnippetLength"));
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
      const snippet = getText(doc.id).replace(/\s+/g, ' ').trim().substring(0, RAGConfig.get("retrieval.footnoteSnippetLength"));
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

// Build system command prefix regex from config — rebuilt on each call so
// it reflects any changes made in the settings panel without page reload
function getSystemPrefix() {
  const prefix = RAGConfig.get('ui.systemCommandPrefix') || '%SYSTEM%';
  return new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i');
}

function parseSystemCommand(query) {
  const prefix = getSystemPrefix();
  if (!prefix.test(query)) return null;
  const cmd = query.replace(prefix, '').trim().toLowerCase();

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

// Sync the model dropdown to reflect what's actually running —
// prevents async backend detection from overwriting it after load
function syncDropdownToLoadedModel(modelId) {
  const sel = document.getElementById('model-select');
  if (!sel) return;

  // Reset ALL graying — we now know what actually works on this device
  Array.from(sel.options).forEach(opt => {
    opt.style.color = '';
    opt.title = '';
    // Remove OOM warnings — let the user decide
    opt.text = opt.text.replace(' ⚠️ may OOM', '');
  });

  // Mark only models of the wrong backend as unavailable
  const loadedModel = getModels().find(m => modelId.startsWith(m.id));
  if (loadedModel) {
    Array.from(sel.options).forEach(opt => {
      const model = getModels().find(m => m.id === opt.value);
      if (!model) return;
      // If loaded backend is webgpu, gray out webnn-only models and vice versa
      // CPU models are always available as fallback
      if (model.backend !== 'cpu' && model.backend !== loadedModel.backend) {
        opt.style.color = '#9ca3af';
        opt.title = `Requires ${model.backend} — current engine uses ${loadedModel.backend}`;
      }
    });
  }

  // Set dropdown to the loaded model AND persist it — this is the source of
  // truth so that setDefaultModel()'s guard sees it and doesn't override
  const exists = Array.from(sel.options).some(o => o.value === modelId);
  if (exists) {
    sel.value = modelId;
    storageSet(RAGConfig.KEYS.selectedModel, modelId);
  }

  // Hide the Load button — dropdown now matches what's running
  const btn = document.getElementById('reload-model-btn');
  if (btn) btn.classList.remove('visible');

  // Invalidate the backend cache so next reload re-probes cleanly
  _detectedBackends = null;
}
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
async function chat(query, signal = null) {

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
      const p = RAGConfig.get('ui.systemCommandPrefix');
      return {
        answer: `**${p} commands:**\n\n` +
          `\`${p} urls\` — list all indexed URLs\n` +
          `\`${p} summarize\` — summarize every page\n` +
          `\`${p} count\` — how many pages are indexed\n` +
          `\`${p} seller resources\` — seller pages\n` +
          `\`${p} buyer resources\` — buyer pages\n` +
          `\`${p} reports\` — report pages\n` +
          `\`${p} coaching\` — coaching pages\n` +
          `\`${p} seminars\` — seminar pages\n` +
          `\`${p} landing pages\` — landing pages`,
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

  const ragEnabled = RAGConfig.get('retrieval.ragEnabled') !== false; // default true
  const maxSources = getMaxSources();
  let uniqueSources = [];

  if (ragEnabled) {
    // Fetch enough candidates to find maxSources unique URLs even if chunks cluster
    const sources = await search(query, maxSources * RAGConfig.get('retrieval.candidatesMultiplier'));

    // Dedupe to at most maxSources unique URLs
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
        s.snippet = getText(s.id).replace(/\s+/g, ' ').trim().substring(0, RAGConfig.get('retrieval.footnoteSnippetLength'));
      }
    });
  }

  // LLM path
  if (llmEngine) {
    try {
      // Build context block — empty when RAG is disabled
      const trimmedContext = ragEnabled && uniqueSources.length
        ? uniqueSources.map((s, i) =>
            `[${i+1}] ${getText(s.id).substring(0, RAGConfig.get('retrieval.passageCharLimit'))}`
          ).join('\n\n')
        : '';

      if (ragEnabled) {
        console.log('📤 Sending context to LLM:\n', trimmedContext);
      } else {
        console.log('📤 RAG disabled — sending query directly to LLM (no retrieved context)');
      }

      // Only last N exchanges for history — reduces prefill tokens significantly
      const HISTORY_EXCHANGES = RAGConfig.get('llm.historyExchanges');
      const history = messages
        .filter(m => !m.isWelcome)
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-(HISTORY_EXCHANGES * 2 + 1), -1)
        .map(m => ({
          role: m.role,
          content: m.role === 'assistant'
            ? m.content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().substring(0, 150)
            : m.content.substring(0, 100)
        }));

      // Throw immediately if already aborted
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      // Update typing indicator to show prefill phase
      const typingText = document.querySelector('#typing-indicator span.text-gray-400');
      if (typingText) typingText.textContent = 'Reading…';

      // Build system message — only append passages when RAG is enabled and has results
      const systemContent = ragEnabled && trimmedContext
        ? `${RAGConfig.get('llm.systemPrompt')}\n\nPassages:\n${trimmedContext}`
        : RAGConfig.get('llm.systemPrompt');

      // Use streaming so we can abort between tokens —
      // non-streaming holds the JS thread until fully done, abort never fires
      const stream = await llmEngine.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: systemContent
          },
          ...history,
          {
            role: 'user',
            content: query
          }
        ],
        temperature:       RAGConfig.get('llm.temperature'),
        repetition_penalty: RAGConfig.get('llm.repetitionPenalty'),
        max_tokens:        RAGConfig.get('llm.maxTokens'),
        stream: true,
      });

      // Switch indicator to generating phase on first token
      let firstToken = true;

      // Accumulate streamed tokens, checking abort between each chunk
      let raw = '';
      for await (const chunk of stream) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const token = chunk.choices[0]?.delta?.content ?? '';
        if (token && firstToken) {
          firstToken = false;
          if (typingText) typingText.textContent = 'Generating…';
        }
        raw += token;
      }

      // Strip duplicate sentences — split on ., !, ? then dedupe preserving order
      const deduped = deduplicateSentences(raw);
      const answer = deduped
        .replace(/\n+\[?\d+\]?\s*https?:\/\/\S+/g, '')
        .replace(/\n+(sources|references|source list|cited|links)[\s\S]*/gi, '')
        .replace(/\n+\[\d+\][^\n]*/g, '')
        .trimEnd();
      return { answer, sources: uniqueSources };
    } catch (e) {
      if (e.name === 'AbortError') throw e; // propagate abort to ask()
      // GPU device lost — null the engine so subsequent queries don't hit the dead engine
      if (e.message?.includes('Device was lost') || e.message?.includes('external Instance')) {
        console.warn('⚠️ GPU device lost — resetting engine, please reload model');
        llmEngine = null;
        engineState.mode = 'fallback';
        engineState.failReason = 'GPU device lost — use Load button to reload model';
        updateEngineStatus();
      } else {
        console.warn('LLM failed, falling back to template:', e);
      }
    }
  }

  // Template fallback (no LLM, or LLM failed)
  if (!ragEnabled) {
    return { answer: '_LLM not available and RAG is disabled — no response can be generated._', sources: [] };
  }

  if (uniqueSources.length === 0) {
    return { answer: 'No relevant content found in your site.', sources: [] };
  }

  const answer = `Here's what I found on the site:\n\n` +
    uniqueSources.map((s, i) => `[${i+1}] ${getText(s.id).substring(0, RAGConfig.get('retrieval.passageCharLimit'))}...`).join('\n\n');

  return { answer, sources: uniqueSources };
}


// Active abort controller — set while a query is in flight, null otherwise
let _abortController = null;

window.stopGeneration = function() {
  // web-llm: use built-in interruptGenerate() — stops after current token,
  // keeps engine alive for next query
  if (llmEngine?.interruptGenerate) {
    llmEngine.interruptGenerate();
    console.log('⏹ Generation interrupted via interruptGenerate()');
  }
  // Signal the streaming loop to stop consuming tokens
  if (_abortController) {
    _abortController.abort();
    _abortController = null;
  }
};

// Main chat handler
window.ask = async function() {
  const input   = document.getElementById('input');
  const sendBtn = document.getElementById('send-btn');
  const query   = input.value.trim();
  if (!query) return;

  input.value     = '';
  input.disabled  = true;
  document.getElementById('questions-list')?.classList.add('questions-disabled');

  // Swap send → stop button
  sendBtn.onclick   = window.stopGeneration;
  sendBtn.title     = 'Stop generating';
  sendBtn.classList.remove('bg-blue-500', 'hover:bg-blue-600', 'active:bg-blue-700');
  sendBtn.classList.add('bg-red-500', 'hover:bg-red-600', 'active:bg-red-700');
  sendBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4">
      <rect x="6" y="6" width="12" height="12" rx="1"/>
    </svg>`;

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

  // Create abort controller for this request
  _abortController = new AbortController();
  const signal = _abortController.signal;

  let answer = null;
  let sources = [];
  let chatSucceeded = false;

  try {
    const result = await chat(query, signal);
    answer  = result.answer;
    sources = result.sources;
    chatSucceeded = true;
  } catch (e) {
    if (e.name === 'AbortError' || signal.aborted) {
      answer = '_Generation stopped._';
    } else {
      console.warn('chat() error:', e);
      answer = '_Something went wrong. Please try again._';
    }
  } finally {
    _abortController = null;
  }

  // Remove typing indicator
  typing.remove();

  if (answer) {
    messages.push({ role: 'assistant', content: answer, sources });
    saveMessages();
    renderMessages();
  }
  if (chatSucceeded) updateQuestionsFromChat(answer, messages.length - 1);

  // Restore send button
  input.disabled    = false;
  document.getElementById('questions-list')?.classList.remove('questions-disabled');
  sendBtn.onclick   = window.ask;
  sendBtn.title     = '';
  sendBtn.classList.remove('bg-red-500', 'hover:bg-red-600', 'active:bg-red-700');
  sendBtn.classList.add('bg-blue-500', 'hover:bg-blue-600', 'active:bg-blue-700');
  sendBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
      <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
    </svg>`;
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
  storageSet(RAGConfig.KEYS.chatMessages, JSON.stringify(messages));
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderMessages() {
  const container = document.getElementById('messages');

  container.innerHTML = messages.map((m, i) => {
    let content = m.content;

    if (m.role === 'assistant') {
      content = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // Inline citation markers → superscript links
      if (m.sources && m.sources.length) {
        content = content.replace(/\[(\d+)\]/g, (match, num) => {
          const src = m.sources[parseInt(num) - 1];
          if (!src) return match;
          const title = src.title || src.url.split('/').pop() || `Source ${num}`;
          return `<a href="${escHtml(src.url)}" target="_blank" class="text-blue-600 hover:text-blue-800 font-semibold underline" title="${escHtml(title)}">[${num}]</a>`;
        });
      }

      content = linkify(content);
      content = content.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

      // Source chips
      if (m.sources && m.sources.length) {
        const chips = m.sources.map(s => {
          let title = s.title;
          if (!title || title === 'undefined') {
            title = s.url.split('/').pop()
              ?.replace(/-/g,' ').replace(/\.html?$/,'').replace(/\?.*/,'') || 'Source';
          }
          return `<a href="${escHtml(s.url)}" target="_blank" class="msg-source-chip">${escHtml(title)}</a>`;
        }).join('');
        content += `<div class="msg-source-chips">${chips}</div>`;
      }

      // Related question chips (populated async)
      const related = messageRelated.get(i) || [];
      if (related.length) {
        const chips = related.map(q =>
          `<button class="msg-question-chip" data-question="${escHtml(q)}">${escHtml(q)}</button>`
        ).join('');
        content += `<div class="msg-related-chips">${chips}</div>`;
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

// Build model dropdown from RAGConfig.models — called on init and after model list changes
function buildModelDropdown() {
  const sel = document.getElementById('model-select');
  if (!sel) return;
  const models = getModels();
  const backends = { webgpu: '⚡ WebGPU models (MLC)', webnn: '🧠 WebNN models (ONNX/NPU)', cpu: '💻 CPU models (WASM)' };
  const groups = {};
  models.forEach(m => {
    if (!groups[m.backend]) groups[m.backend] = [];
    groups[m.backend].push(m);
  });
  sel.innerHTML = Object.entries(backends)
    .filter(([b]) => groups[b]?.length)
    .map(([b, label]) =>
      `<optgroup label="${label}">${
        groups[b].map(m => `<option value="${m.id}">${m.label}</option>`).join('')
      }</optgroup>`
    ).join('');
}

// Generate a welcome message — uses config welcome if set, else auto-generates from index
async function generateWelcome() {
  // Use configured welcome message if set
  const configWelcome = RAGConfig.get('ui.welcomeMessage');
  if (configWelcome && configWelcome.trim()) {
    messages.push({ role: 'assistant', content: configWelcome.trim(), sources: [], isWelcome: true });
    renderMessages();
    return;
  }

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

// ---------------------------------------------------------------------------
// Chat export — structured JSON for system prompt fine-tuning
// ---------------------------------------------------------------------------
window.downloadChat = function() {
  // Build Q&A pairs — each user message paired with the assistant reply that follows it
  const pairs = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const next = messages[i + 1];
    if (!next || next.role !== 'assistant' || next.isWelcome) continue;

    // Strip HTML from assistant response (footnote divs etc.)
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = next.content;
    const plainResponse = tempDiv.textContent.replace(/\s+/g, ' ').trim();

    pairs.push({
      query:    m.content,
      response: plainResponse,
      sources:  (next.sources ?? []).map(s => ({ url: s.url, title: s.title })),
    });
  }

  if (pairs.length === 0) {
    alert('No completed exchanges to export yet.');
    return;
  }

  const payload = {
    exported:     new Date().toISOString(),
    exchange_count: pairs.length,
    system_prompt: RAGConfig.get('llm.systemPrompt'),
    settings_snapshot: {
      llm: {
        temperature:        RAGConfig.get('llm.temperature'),
        repetitionPenalty:  RAGConfig.get('llm.repetitionPenalty'),
        maxTokens:          RAGConfig.get('llm.maxTokens'),
        historyExchanges:   RAGConfig.get('llm.historyExchanges'),
      },
      retrieval: {
        ragEnabled:           RAGConfig.get('retrieval.ragEnabled'),
        passageCharLimit:     RAGConfig.get('retrieval.passageCharLimit'),
        contactBoost:         RAGConfig.get('retrieval.contactBoost'),
        candidatesMultiplier: RAGConfig.get('retrieval.candidatesMultiplier'),
      },
    },
    model: engineState.model ?? 'unknown',
    exchanges: pairs,
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href     = url;
  a.download = `wllmrag-chat-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

// Question panel functions (renderQuestions, selectDiverse, loadInitialQuestions,
// updateQuestionsFromChat, toggleQuestionsDrawer) live in app-hot.js so they
// can be reloaded without a full page refresh via the ↻ button.

window.clearChat = function() {
  messages = [];
  messageRelated.clear();
  saveMessages();
  renderMessages();
  generateWelcome();
  loadInitialQuestions();
};

// Expose for app-hot.js to call after updating messageRelated
window.messageRelated = messageRelated;
window.renderMessages  = renderMessages;

// Wire up Send button, Enter key, and message chip clicks
document.addEventListener('DOMContentLoaded', function() {
  const sendBtn = document.getElementById('send-btn');
  const input   = document.getElementById('input');

  // Event delegation for related question chips inside messages
  document.getElementById('messages')?.addEventListener('click', e => {
    const chip = e.target.closest('[data-question]');
    if (chip && !_abortController) {
      input.value = chip.dataset.question;
      ask();
    }
  });

  if (sendBtn) {
    sendBtn.onclick = window.ask;
  }

  if (input) {
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        // Only submit if not currently generating
        if (!_abortController) ask();
      }
    });
  }

  // Build model dropdown from config
  buildModelDropdown();

  // Set memory-appropriate default model before loading index
  setDefaultModel();

  // Restore previous chat on load
  if (messages.length) {
    renderMessages();
  }

  loadIndex();
});
