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

// ---------------------------------------------------------------------------
// Simple / Advanced UI mode
// ---------------------------------------------------------------------------
function applyUIMode() {
  const simple = RAGConfig.get('ui.mode') === 'simple';
  const hide = id => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', simple); };
  hide('settings-gear-btn');
  hide('trace-toggle-btn');
  hide('engine-status');
  hide('model-selector-row');
  hide('pipeline-strip');
  hide('refresh-index-btn');
  hide('download-chat-btn');
  hide('clear-chat-btn');
}

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

  const isGroqProvider = RAGConfig.get('llm.provider') === 'groq';

  // Disable input when proxy token is missing; auto-prompt in simple mode
  const inputEl  = document.getElementById('input');
  const sendBtn  = document.getElementById('send-btn');
  const inputBar = document.getElementById('input-bar');
  const needsToken = isGroqProvider && RAGConfig.get('groq.proxyUrl') && !RAGConfig.get('groq.proxyToken');
  if (inputEl) {
    inputEl.disabled = needsToken;
    inputEl.placeholder = needsToken ? 'Access token required — click here to enter' : 'Ask about the site…';
  }
  if (sendBtn) sendBtn.disabled = needsToken;
  // Auto-show token dialog when token is needed
  if (needsToken && !document.getElementById('token-dialog')) {
    setTimeout(_promptForToken, 300);
  }

  // When provider is groq, show only the Groq badge
  if (isGroqProvider) {
    const groqModel = RAGConfig.get('groq.model') || 'llama-3.3-70b-versatile';
    const groqProxy = RAGConfig.get('groq.proxyUrl');
    bar.innerHTML = `
      <div class="flex items-center gap-2 flex-wrap">
        <span class="inline-block w-2 h-2 rounded-full bg-green-500"></span>
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">☁ Groq: ${groqModel}${groqProxy ? ' (proxy)' : ''}</span>
      </div>
    `;
    return;
  }

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
    refreshPipelineRef();

    await initLLM();
    statusEl.textContent = `✅ Ready to chat! (${metaDocs.length} chunks)`;

  } catch (e) {
    console.error('❌ Index load failed:', e);
    statusEl.textContent = `Error: ${e.message}`;
    engineState.mode = 'error';
    updateEngineStatus();
  }
}

// ---------------------------------------------------------------------------
// Index schema validation
// Returns { ok, errors: string[], warnings: string[] }
// ---------------------------------------------------------------------------
function validateIndexSchema(newDocs, binBuf, textJson) {
  const errors   = [];
  const warnings = [];

  // 1. Required fields on every entry
  const REQUIRED = ['id', 'url', 'title', 'chunkId'];
  const badEntries = newDocs.filter(d => REQUIRED.some(f => d[f] === undefined || d[f] === null));
  if (badEntries.length) {
    errors.push(`${badEntries.length} entr${badEntries.length === 1 ? 'y' : 'ies'} missing required fields (id, url, title, chunkId)`);
  }

  // 2. Embeddings byte length must exactly match doc count × DIMS × 4 bytes
  const expectedBytes = newDocs.length * DIMS * 4;
  if (binBuf.byteLength !== expectedBytes) {
    errors.push(
      `Embeddings size mismatch:\n` +
      `  expected ${expectedBytes.toLocaleString()} bytes (${newDocs.length} docs × ${DIMS} dims × 4)\n` +
      `  got      ${binBuf.byteLength.toLocaleString()} bytes`
    );
  }

  // 3. All doc ids must have a text entry
  if (textJson) {
    const missingText = newDocs.filter(d => textJson[d.id] === undefined && textJson[String(d.id)] === undefined);
    if (missingText.length) {
      errors.push(`${missingText.length} doc id${missingText.length === 1 ? '' : 's'} missing from index-text.json`);
    }
  }

  // 4. Warn on index type change (question-indexed ↔ basic)
  const currentIsQI = metaDocs.some(d => d.question);
  const newIsQI     = newDocs.some(d => d.question);
  if (currentIsQI && !newIsQI) {
    warnings.push('Index type changed: question-indexed → basic. Questions panel will be empty after apply.');
  } else if (!currentIsQI && newIsQI) {
    warnings.push('Index type changed: basic → question-indexed. Questions panel will be populated.');
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Index diff — structural comparison between old and new metaDocs
// ---------------------------------------------------------------------------
function diffIndex(oldDocs, newDocs) {
  const oldUrls = new Set(oldDocs.map(d => d.url));
  const newUrls = new Set(newDocs.map(d => d.url));
  return {
    pagesAdded:    [...newUrls].filter(u => !oldUrls.has(u)),
    pagesRemoved:  [...oldUrls].filter(u => !newUrls.has(u)),
    chunksOld:     oldDocs.length,
    chunksNew:     newDocs.length,
    questionsOld:  oldDocs.filter(d => d.question).length,
    questionsNew:  newDocs.filter(d => d.question).length,
  };
}

// ---------------------------------------------------------------------------
// Preview panel UI
// ---------------------------------------------------------------------------
function showIndexPreview({ errors, warnings, diff }) {
  const body     = document.getElementById('ix-preview-body');
  const applyBtn = document.getElementById('ix-apply-btn');
  let html = '';

  if (errors && errors.length) {
    html += `<div class="ix-alert ix-alert-error">
      <strong>❌ Schema validation failed — no changes applied</strong>
      <ul>${errors.map(e => `<li>${escHtml(e).replace(/\n/g, '<br>')}</li>`).join('')}</ul>
    </div>`;
    applyBtn.style.display = 'none';
  } else {
    if (warnings && warnings.length) {
      html += `<div class="ix-alert ix-alert-warn">
        <strong>⚠️ Warning</strong>
        <ul>${warnings.map(w => `<li>${escHtml(w)}</li>`).join('')}</ul>
      </div>`;
    }

    const chunkDelta = diff.chunksNew - diff.chunksOld;
    const qDelta     = diff.questionsNew - diff.questionsOld;
    const fmt = n => n > 0 ? `<span class="ix-pos">+${n}</span>` : n < 0 ? `<span class="ix-neg">${n}</span>` : '<span class="ix-neu">±0</span>';

    html += `<div class="ix-diff-box">
      <strong>Changes</strong>
      <table class="ix-diff-table">
        <tr><td>Pages</td><td>${fmt(diff.pagesAdded.length)} added &nbsp; ${fmt(-diff.pagesRemoved.length)} removed</td></tr>
        <tr><td>Chunks</td><td>${fmt(chunkDelta)} &nbsp; (${diff.chunksOld} → ${diff.chunksNew})</td></tr>
        ${diff.questionsOld || diff.questionsNew ? `<tr><td>Questions</td><td>${fmt(qDelta)} &nbsp; (${diff.questionsOld} → ${diff.questionsNew})</td></tr>` : ''}
      </table>
    </div>`;

    if (diff.pagesAdded.length) {
      html += `<div class="ix-page-list">
        <strong>Added (${diff.pagesAdded.length})</strong>
        <ul>${diff.pagesAdded.slice(0, 10).map(u => `<li class="ix-pos">${escHtml(u)}</li>`).join('')}
        ${diff.pagesAdded.length > 10 ? `<li class="ix-muted">…+${diff.pagesAdded.length - 10} more</li>` : ''}</ul>
      </div>`;
    }
    if (diff.pagesRemoved.length) {
      html += `<div class="ix-page-list">
        <strong>Removed (${diff.pagesRemoved.length})</strong>
        <ul>${diff.pagesRemoved.slice(0, 10).map(u => `<li class="ix-neg">${escHtml(u)}</li>`).join('')}
        ${diff.pagesRemoved.length > 10 ? `<li class="ix-muted">…+${diff.pagesRemoved.length - 10} more</li>` : ''}</ul>
      </div>`;
    }
    if (!diff.pagesAdded.length && !diff.pagesRemoved.length && chunkDelta === 0) {
      html += `<p class="ix-muted" style="margin:8px 0;">No structural changes detected.</p>`;
    }

    applyBtn.style.display = '';
  }

  body.innerHTML = html;
  document.getElementById('ix-preview-panel').classList.add('open');
  document.getElementById('ix-preview-backdrop').classList.add('open');
}

window.closeIndexPreview = function() {
  document.getElementById('ix-preview-panel').classList.remove('open');
  document.getElementById('ix-preview-backdrop').classList.remove('open');
  window._pendingIndex = null;
};

window.applyPendingIndex = async function() {
  const pending = window._pendingIndex;
  if (!pending) return;

  metaDocs  = pending.newDocs;
  embMatrix = new Float32Array(pending.binBuf);
  textCache = pending.textJson;   // pre-loaded — avoids a future fetch
  window._pendingIndex = null;

  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `app-hot.js?t=${pending.t}`;
    s.onload  = resolve;
    s.onerror = () => reject(new Error('app-hot.js failed to load'));
    document.head.appendChild(s);
  });

  loadInitialQuestions();
  refreshPipelineRef();
  window.closeIndexPreview();
  document.getElementById('status').textContent = `✅ Refreshed (${metaDocs.length} chunks)`;
};

// ---------------------------------------------------------------------------
// Refresh — fetch → validate → diff → preview (no immediate apply)
// ---------------------------------------------------------------------------
window.refreshIndex = async function() {
  const statusEl = document.getElementById('status');
  statusEl.textContent = 'Fetching new index…';
  const t = Date.now();
  try {
    const [metaRes, binRes, textRes] = await Promise.all([
      fetch(`index-meta.json?t=${t}`),
      fetch(`index-embeddings.bin?t=${t}`),
      fetch(`index-text.json?t=${t}`),
    ]);
    if (!metaRes.ok || !binRes.ok) throw new Error('Index files not found');

    const meta    = await metaRes.json();
    const binBuf  = await binRes.arrayBuffer();
    const textJson = textRes.ok ? await textRes.json() : null;
    const newDocs = meta.documents;

    const validation = validateIndexSchema(newDocs, binBuf, textJson);
    if (!validation.ok) {
      showIndexPreview({ errors: validation.errors, warnings: validation.warnings });
      statusEl.textContent = '⚠️ Index schema mismatch';
      return;
    }

    const diff = diffIndex(metaDocs, newDocs);
    window._pendingIndex = { newDocs, binBuf, textJson, t };
    showIndexPreview({ warnings: validation.warnings, diff });
    statusEl.textContent = 'Index preview ready';
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

  // --- Remote provider check — skip local LLM entirely ---
  if (RAGConfig.get('llm.provider') === 'groq') {
    engineState.mode = 'groq';
    engineState.model = null;
    updateEngineStatus();
    const row = document.getElementById('model-selector-row');
    if (row) row.classList.add('hidden');
    console.log('☁ LLM provider set to Groq — skipping local model load');
    return;
  }

  // Show model selector when provider is local
  const row = document.getElementById('model-selector-row');
  if (row) row.classList.remove('hidden');

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

// ---------------------------------------------------------------------------
// Collection — chainable query API over metaDocs
//
// Roots (re-evaluated against current metaDocs on each // command):
//   metaDocs  — all index entries
//   pages     — metaDocs.unique('url')
//   topics    — metaDocs deduplicated on title
//   questions — metaDocs entries that have a .question field
//
// Sync transforms:   .filter(field, strOrRegex)  .unique(field)  .slice(n)
// Sync terminals:    .count   .pluck(field)   .join(sep)
// Async transforms:  .search("q", k)   .chunks()
// Async terminal:    .llm()  .llm("question")  .llm(prompt="...", "question")
// ---------------------------------------------------------------------------
class Collection {
  constructor(docs, query = null, searchK = null, stages = null) {
    this._docs    = Array.isArray(docs) ? docs : [];
    this._query   = query;
    this._searchK = searchK;
    this._stages  = stages || [{ op: 'root', count: this._docs.length }];
  }

  _next(docs, query, stage) {
    return new Collection(
      docs,
      query ?? this._query,
      this._searchK,
      [...this._stages, stage]
    );
  }

  filter(field, pattern) {
    const before = this._docs.length;
    const test = pattern instanceof RegExp
      ? s => pattern.test(s)
      : s => s.toLowerCase().includes(String(pattern).toLowerCase());
    const filtered = this._docs.filter(d => test(String(d[field] ?? '')));
    const patStr = pattern instanceof RegExp ? pattern.toString() : '"' + pattern + '"';
    return this._next(filtered, null, {
      op:      'filter',
      field,
      pattern: patStr,
      before,
      after:   filtered.length,
      dropped: before - filtered.length,
    });
  }

  unique(field) {
    const before = this._docs.length;
    const seen = new Set();
    const filtered = this._docs.filter(d => {
      const v = d[field]; return seen.has(v) ? false : (seen.add(v), true);
    });
    return this._next(filtered, null, {
      op:      'unique',
      field,
      before,
      after:   filtered.length,
      dropped: before - filtered.length,
    });
  }

  slice(n) {
    const before = this._docs.length;
    const sliced = this._docs.slice(0, n);
    return this._next(sliced, null, {
      op:      'slice',
      n,
      before,
      after:   sliced.length,
      dropped: before - sliced.length,
    });
  }

  get count() { return this._docs.length; }

  pluck(field) {
    return this._docs.map(d => d[field]).filter(v => v != null);
  }

  join(sep = ', ') {
    return this._docs.map(d => typeof d === 'string' ? d : (d.title || d.url || String(d))).join(sep);
  }

  async rewrite(promptOverride) {
    const input = this._query ?? '';
    if (!input) {
      return this._next(this._docs, this._query, {
        op: 'rewrite', skipped: true, reason: 'no ambient query to rewrite'
      });
    }
    if (!llmEngine) {
      return this._next(this._docs, this._query, {
        op: 'rewrite', skipped: true, reason: 'LLM not loaded'
      });
    }
    const t0     = Date.now();
    const prompt = promptOverride ||
      'Fix spelling mistakes and expand abbreviations in the following search query. Do NOT change the meaning or add new ideas — only correct the words as written. Return ONLY the corrected query text, nothing else.';
    try {
      const { answer } = await _callLLM(prompt, input, '', null);
      const output = answer.trim().replace(/^["']|["']$/g, '');
      return this._next(this._docs, output, {
        op:      'rewrite',
        input,
        output,
        elapsed: Date.now() - t0,
      });
    } catch(e) {
      console.warn('Collection.rewrite() failed:', e.message);
      return this._next(this._docs, this._query, {
        op: 'rewrite', skipped: true, reason: 'LLM error: ' + e.message
      });
    }
  }

  async search(q, k) {
    // No explicit q — use ambient _query (set by rewrite() or rag root context)
    if (!q) q = this._query ?? '';
    if (!q) return this._next(this._docs, null, { op: 'search', skipped: true, reason: 'no query provided' });
    k = k ?? this._searchK ?? Math.min(this._docs.length, 50);
    const before = this._docs.length;
    const t0     = Date.now();

    if (embedder && embMatrix) {
      try {
        const output   = await embedder(q, { pooling: 'mean', normalize: true });
        const queryVec = new Float32Array(output.data);
        const scored = this._docs.map(doc => {
          const slice = embMatrix.subarray(doc.id * DIMS, (doc.id + 1) * DIMS);
          const sim   = cosineSimilarity(queryVec, slice);
          const boost = doc.type === 'contact' ? RAGConfig.get('retrieval.contactBoost') : 0;
          return { ...doc, score: sim + boost, _rawSim: sim, _boost: boost };
        }).sort((a, b) => b.score - a.score);
        const results = scored.slice(0, k);
        return this._next(results, q, {
          op:      'search',
          method:  'semantic',
          model:   'all-MiniLM-L6-v2',
          query:   q,
          k,
          before,
          after:   results.length,
          elapsed: Date.now() - t0,
          topScore:    results[0]?.score?.toFixed(4) ?? 'n/a',
          bottomScore: results[results.length-1]?.score?.toFixed(4) ?? 'n/a',
          contactBoost: RAGConfig.get('retrieval.contactBoost'),
          results,
        });
      } catch(e) {
        console.warn('Collection.search semantic failed, keyword fallback:', e.message);
      }
    }

    await ensureTextLoaded();
    const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    const scored = this._docs.map(doc => {
      const text = getText(doc.id).toLowerCase();
      let score = 0;
      if (text.includes(q.toLowerCase())) score += 3;
      words.forEach(w => {
        if (text.includes(w)) score += 1;
        if ((doc.title || '').toLowerCase().includes(w)) score += 2;
        if ((doc.url  || '').toLowerCase().includes(w)) score += 1;
      });
      return { ...doc, score };
    }).sort((a, b) => b.score - a.score);
    const results = scored.slice(0, k);
    return this._next(results, q, {
      op:      'search',
      method:  'keyword',
      query:   q,
      k,
      before,
      after:   results.length,
      elapsed: Date.now() - t0,
      topScore:    results[0]?.score?.toFixed(4) ?? 'n/a',
      bottomScore: results[results.length-1]?.score?.toFixed(4) ?? 'n/a',
      results,
    });
  }

  async chunks() {
    const t0  = Date.now();
    await ensureTextLoaded();
    const docs = this._docs.map(d => ({ ...d, _text: getText(d.id) }));
    const totalChars = docs.reduce((s, d) => s + (d._text?.length || 0), 0);
    return this._next(docs, null, {
      op:         'chunks',
      count:      docs.length,
      totalChars,
      elapsed:    Date.now() - t0,
    });
  }

  async llm(argsStr, signal) {
    const { prompt, userInput } = _parseLlmArgs(argsStr);
    const systemPrompt = prompt ?? RAGConfig.get('llm.systemPrompt');
    const query        = userInput ?? this._query ?? 'Summarize the key information.';
    const charBudget   = RAGConfig.get('retrieval.passageCharLimit') * getMaxSources();
    const passageLen   = RAGConfig.get('retrieval.passageCharLimit');

    await ensureTextLoaded();
    const seenUrls = new Set();
    const sources  = [];
    let usedChars  = 0;
    for (const doc of this._docs) {
      if (seenUrls.has(doc.url)) continue;
      const text = (doc._text || getText(doc.id)).substring(0, passageLen);
      if (usedChars + text.length > charBudget && sources.length > 0) break;
      seenUrls.add(doc.url);
      sources.push({ ...doc, _resolvedText: text });
      usedChars += text.length;
    }

    const passages = sources.map((d, i) => `[${i+1}] ${d._resolvedText}`).join('\n\n');
    const callFn = RAGConfig.get('llm.provider') === 'groq' ? _callGroq : _callLLM;
    const { answer } = await callFn(systemPrompt, query, passages, signal);
    return { answer, sources };
  }

  async groq(argsStr, signal) {
    const { prompt, userInput } = _parseLlmArgs(argsStr);
    const systemPrompt = prompt ?? RAGConfig.get('llm.systemPrompt');
    const query        = userInput ?? this._query ?? 'Summarize the key information.';
    const charBudget   = RAGConfig.get('retrieval.passageCharLimit') * getMaxSources();
    const passageLen   = RAGConfig.get('retrieval.passageCharLimit');

    await ensureTextLoaded();
    const seenUrls = new Set();
    const sources  = [];
    let usedChars  = 0;
    for (const doc of this._docs) {
      if (seenUrls.has(doc.url)) continue;
      const text = (doc._text || getText(doc.id)).substring(0, passageLen);
      if (usedChars + text.length > charBudget && sources.length > 0) break;
      seenUrls.add(doc.url);
      sources.push({ ...doc, _resolvedText: text });
      usedChars += text.length;
    }

    const passages = sources.map((d, i) => `[${i+1}] ${d._resolvedText}`).join('\n\n');
    const { answer } = await _callGroq(systemPrompt, query, passages, signal);
    return { answer, sources };
  }

  async trace(signal, provider = 'local') {
    const sep  = '\u2500'.repeat(48);
    const sep2 = '\u2550'.repeat(48);
    const lines = [];
    const t0   = Date.now();

    lines.push('TRACE');
    lines.push(sep2);
    lines.push('');

    // ── Replay each recorded stage ────────────────────────────────────────
    for (const stage of this._stages) {

      if (stage.op === 'root') {
        lines.push('\u25a0 metaDocs');
        lines.push('  total     ' + stage.count + ' chunks');
        lines.push('');
        continue;
      }

      if (stage.op === 'rewrite') {
        if (stage.skipped) {
          lines.push('\u25a0 .rewrite()  SKIPPED (' + stage.reason + ')');
        } else {
          lines.push('\u25a0 .rewrite()');
          lines.push('  input    "' + stage.input + '"');
          lines.push('  output   "' + stage.output + '"');
          lines.push('  elapsed  ' + stage.elapsed + 'ms');
        }
        lines.push('');
        continue;
      }

      if (stage.op === 'filter') {
        lines.push('\u25a0 .filter("' + stage.field + '", ' + stage.pattern + ')');
        lines.push('  before    ' + stage.before + ' chunks');
        lines.push('  after     ' + stage.after  + ' chunks  (' + stage.dropped + ' dropped)');
        lines.push('');
        continue;
      }

      if (stage.op === 'unique') {
        lines.push('\u25a0 .unique("' + stage.field + '")');
        lines.push('  before    ' + stage.before + ' chunks');
        lines.push('  after     ' + stage.after  + ' chunks  (' + stage.dropped + ' duplicate ' + stage.field + 's dropped)');
        lines.push('');
        continue;
      }

      if (stage.op === 'slice') {
        lines.push('\u25a0 .slice(' + stage.n + ')');
        lines.push('  before    ' + stage.before + ' chunks');
        lines.push('  after     ' + stage.after  + ' chunks  (' + stage.dropped + ' dropped)');
        lines.push('');
        continue;
      }

      if (stage.op === 'search') {
        if (stage.skipped) {
          lines.push('\u25a0 .search()  SKIPPED (' + stage.reason + ')');
          lines.push('');
          continue;
        }
        lines.push('\u25a0 .search("' + stage.query + '")');
        lines.push('  method    ' + stage.method + (stage.model ? ' (' + stage.model + ')' : ''));
        lines.push('  before    ' + stage.before + ' chunks');
        lines.push('  k         ' + stage.k + '  (candidate limit)');
        lines.push('  after     ' + stage.after  + ' chunks returned');
        lines.push('  elapsed   ' + stage.elapsed + 'ms');
        lines.push('  scores    ' + stage.topScore + ' (top) \u2192 ' + stage.bottomScore + ' (bottom)');
        if (stage.contactBoost) lines.push('  boost     +' + stage.contactBoost + ' applied to contact chunks');
        lines.push('');
        lines.push('  #   score    boost  type     chunkId  url');
        lines.push('  ' + '\u2500'.repeat(60));
        (stage.results || []).slice(0, 12).forEach((d, i) => {
          const dupeFlag  = (stage.results || []).slice(0, i).some(p => p.url === d.url) ? ' \u29d6dup' : '';
          const boostStr  = (d._boost > 0) ? '+' + d._boost.toFixed(2) : '     ';
          const urlShort  = d.url.length > 35 ? '\u2026' + d.url.slice(-33) : d.url;
          const rawSim    = d._rawSim != null ? d._rawSim.toFixed(4) : (d.score != null ? d.score.toFixed(4) : ' n/a ');
          lines.push(
            '  ' + String(i+1).padStart(2) + '  ' +
            rawSim + '  ' + boostStr + '  ' +
            (d.type || '').padEnd(7) + '  ' +
            String(d.chunkId ?? d.id ?? '').padEnd(7) + '  ' +
            urlShort + dupeFlag
          );
        });
        if ((stage.results || []).length > 12) lines.push('  ... +' + ((stage.results || []).length - 12) + ' more');
        lines.push('');
        continue;
      }

      if (stage.op === 'chunks') {
        lines.push('\u25a0 .chunks()');
        lines.push('  loaded    ' + stage.count + ' texts');
        lines.push('  total     ' + stage.totalChars.toLocaleString() + ' chars across all chunks');
        lines.push('  elapsed   ' + stage.elapsed + 'ms');
        lines.push('');
        continue;
      }
    }

    // ── .trace() terminal — passage assembly + LLM ───────────────────────
    const passageLen = RAGConfig.get('retrieval.passageCharLimit');
    const charBudget = passageLen * getMaxSources();
    const query      = this._query ?? '(no query \u2014 .search() not in chain)';

    await ensureTextLoaded();
    const seenUrls = new Set();
    const sources  = [];
    let usedChars  = 0;
    for (const doc of this._docs) {
      if (seenUrls.has(doc.url)) continue;
      const text = (doc._text || getText(doc.id)).substring(0, passageLen);
      if (usedChars + text.length > charBudget && sources.length > 0) break;
      seenUrls.add(doc.url);
      sources.push({ ...doc, _resolvedText: text });
      usedChars += text.length;
    }

    lines.push('\u25a0 .trace()  \u2500 passage assembly');
    lines.push('  available  ' + this._docs.length + ' chunks  (' + [...new Set(this._docs.map(d => d.url))].length + ' unique URLs)');
    lines.push('  limit      ' + passageLen + ' chars/passage \u00d7 ' + getMaxSources() + ' sources = ' + charBudget + ' budget');
    if (!sources.length) {
      lines.push('  \u26a0 no passages \u2014 collection empty or .chunks() not called');
      if (!this._query) lines.push('  \u26a0 no query set \u2014 add .search("q") before .trace() to rank by relevance');
    } else {
      lines.push('  sent       ' + sources.length + ' passages  (' + (this._docs.length - sources.length) + ' skipped by budget)');
      lines.push('');
      sources.forEach((s, i) => {
        const full    = s._text || getText(s.id);
        const trimmed = s._resolvedText;
        const pct     = Math.round(trimmed.length / Math.max(full.length, 1) * 100);
        const flag    = full.length > passageLen ? '\u2702 truncated' : '\u2713 full';
        lines.push('  [' + (i+1) + '] ' + flag + '  ' + trimmed.length + '/' + full.length + ' chars (' + pct + '%)  chunkId:' + (s.chunkId ?? s.id));
        lines.push('      "' + trimmed.replace(/\s+/g, ' ').slice(0, 80) + (trimmed.length > 80 ? '\u2026' : '') + '"');
      });
      lines.push('');
      lines.push('  used       ' + usedChars + ' / ' + charBudget + ' chars (' + Math.round(usedChars / charBudget * 100) + '%)');
    }
    lines.push('');

    const systemPrompt = RAGConfig.get('llm.systemPrompt');
    const isGroq = provider === 'groq';
    lines.push('\u25a0 .trace()  \u2500 generate');
    lines.push('  query      "' + query + '"');
    lines.push('  prompt     ' + systemPrompt.length + ' chars  "' + systemPrompt.replace(/\n/g, ' ').slice(0, 60) + (systemPrompt.length > 60 ? '\u2026' : '') + '"');
    const histN    = RAGConfig.get('llm.historyExchanges');
    const histMsgs = messages.filter(m => !m.isWelcome && (m.role === 'user' || m.role === 'assistant')).slice(-(histN * 2 + 1), -1);
    lines.push('  history    ' + Math.floor(histMsgs.length / 2) + ' of ' + histN + ' exchange(s)');
    if (isGroq) {
      lines.push('  provider   groq  model:' + (RAGConfig.get('groq.model') || 'llama-3.3-70b-versatile'));
    } else {
      lines.push('  model      ' + (engineState.model || 'not loaded'));
      lines.push('  temp       ' + RAGConfig.get('llm.temperature') + '  maxTokens:' + RAGConfig.get('llm.maxTokens') + '  rep_penalty:' + RAGConfig.get('llm.repetitionPenalty'));
    }
    lines.push('');

    let answer = '(LLM not available)';
    const t6 = Date.now();
    try {
      const passages = sources.map((d, i) => '[' + (i+1) + '] ' + d._resolvedText).join('\n\n');
      const useGroq = isGroq || RAGConfig.get('llm.provider') === 'groq';
      if (useGroq) {
        const result = await _callGroq(systemPrompt, query, passages, signal);
        answer = result.answer;
      } else if (llmEngine) {
        const result = await _callLLM(systemPrompt, query, passages, signal);
        answer = result.answer;
      } else {
        lines.push('  SKIPPED (no local LLM loaded)');
      }
      if (answer === null) return { answer: null, sources, traceLines: lines };
      if (answer !== '(LLM not available)') {
        lines.push('  elapsed    ' + (Date.now() - t6) + 'ms');
        lines.push('  tokens     ~' + Math.round(answer.split(/\s+/).length * 1.3) + ' (estimate)');
      }
    } catch(e) {
      if (e.name === 'AbortError') throw e;
      answer = '(LLM error: ' + e.message + ')';
      lines.push('  ERROR: ' + e.message);
    }
    lines.push('  total     ' + (Date.now() - t0) + 'ms');
    lines.push('');

    return { answer, sources, traceLines: lines };
  }
}

// ---------------------------------------------------------------------------
// Proxy event helper — sends metadata/click events to the Worker
// ---------------------------------------------------------------------------
function _sendProxyEvent(payload) {
  const proxyUrl = RAGConfig.get('groq.proxyUrl');
  if (!proxyUrl) return;
  const proxyToken = RAGConfig.get('groq.proxyToken');
  const vid = _storageGet('wllmrag_visitor_id');
  const body = JSON.stringify({ ...payload, _token: proxyToken, _vid: vid, _ts: new Date().toISOString() });
  // Use sendBeacon for reliability (survives tab navigation / target="_blank")
  if (navigator.sendBeacon) {
    navigator.sendBeacon(proxyUrl, new Blob([body], { type: 'application/json' }));
  } else {
    const headers = { 'Content-Type': 'application/json' };
    if (proxyToken) headers['X-Proxy-Token'] = proxyToken;
    if (vid) headers['X-Visitor-Id'] = vid;
    fetch(proxyUrl, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(payload) }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Token prompt — simple dialog for users to enter proxy token
// ---------------------------------------------------------------------------
function _promptForToken() {
  // If advanced mode, open full settings panel
  if (RAGConfig.get('ui.mode') !== 'simple') {
    if (typeof openSettingsPipeline === 'function') openSettingsPipeline();
    return;
  }
  // Simple mode: show a minimal dialog
  let dialog = document.getElementById('token-dialog');
  if (!dialog) {
    dialog = document.createElement('div');
    dialog.id = 'token-dialog';
    dialog.innerHTML = `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center">
        <div style="background:white;border-radius:12px;padding:24px;width:90%;max-width:360px;box-shadow:0 8px 30px rgba(0,0,0,0.2)">
          <h3 style="margin:0 0 8px;font-size:15px;font-weight:600">Access Token Required</h3>
          <p style="margin:0 0 16px;font-size:13px;color:#6b7280">Enter the access token provided by the site operator.</p>
          <input id="token-dialog-input" type="password" placeholder="Paste token here"
            style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box">
          <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
            <button id="token-dialog-cancel"
              style="padding:6px 16px;border:1px solid #d1d5db;border-radius:8px;background:white;font-size:13px;cursor:pointer">Cancel</button>
            <button id="token-dialog-save"
              style="padding:6px 16px;border:none;border-radius:8px;background:#3b82f6;color:white;font-size:13px;cursor:pointer">Connect</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    document.getElementById('token-dialog-cancel').onclick = () => dialog.remove();
    document.getElementById('token-dialog-save').onclick = () => {
      const val = document.getElementById('token-dialog-input').value.trim();
      if (val) {
        RAGConfig.set('groq.proxyToken', val);
        if (typeof updateEngineStatus === 'function') updateEngineStatus();
      }
      dialog.remove();
    };
    document.getElementById('token-dialog-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('token-dialog-save').click();
    });
  }
  document.getElementById('token-dialog-input').value = '';
  document.getElementById('token-dialog-input').focus();
}

// ---------------------------------------------------------------------------
// Groq streaming helper — used by Collection.groq()
// ---------------------------------------------------------------------------
async function _callGroq(systemPrompt, userInput, passages, signal) {
  const proxyUrl = RAGConfig.get('groq.proxyUrl');
  const apiKey   = RAGConfig.get('groq.apiKey');
  if (!proxyUrl && !apiKey) {
    _promptForToken();
    return { answer: null };
  }

  if (proxyUrl && !RAGConfig.get('groq.proxyToken')) {
    _promptForToken();
    return { answer: null };
  }

  const model    = RAGConfig.get('groq.model') || 'llama-3.3-70b-versatile';
  const endpoint = proxyUrl || 'https://api.groq.com/openai/v1/chat/completions';
  const reqHeaders = { 'Content-Type': 'application/json' };
  if (proxyUrl) {
    reqHeaders['X-Proxy-Token'] = RAGConfig.get('groq.proxyToken');
    // Send visitor ID for conversation tracking
    const vid = _storageGet('wllmrag_visitor_id');
    if (vid) reqHeaders['X-Visitor-Id'] = vid;
  } else {
    reqHeaders['Authorization'] = 'Bearer ' + apiKey;
  }

  // When using proxy, send only passages (system prompt is injected server-side).
  // When direct, send the full system message.
  const systemMsg = proxyUrl
    ? (passages ? { role: 'system', content: `Passages:\n${passages}` } : null)
    : { role: 'system', content: passages ? `${systemPrompt}\n\nPassages:\n${passages}` : systemPrompt };

  const HISTORY_EXCHANGES = RAGConfig.get('llm.historyExchanges');
  const history = messages
    .filter(m => !m.isWelcome && (m.role === 'user' || m.role === 'assistant'))
    .slice(-(HISTORY_EXCHANGES * 2 + 1), -1)
    .map(m => ({
      role: m.role,
      content: m.role === 'assistant'
        ? m.content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().substring(0, 150)
        : m.content.substring(0, 100)
    }));

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const typingText = document.querySelector('#typing-indicator span.text-gray-400');
  if (typingText) typingText.textContent = 'Reading…';

  const msgArray = [...(systemMsg ? [systemMsg] : []), ...history, { role: 'user', content: userInput }];

  const resp = await fetch(endpoint, {
    method: 'POST',
    credentials: proxyUrl ? 'include' : 'omit',
    headers: reqHeaders,
    body: JSON.stringify({
      model,
      messages: msgArray,
      temperature: RAGConfig.get('llm.temperature'),
      max_tokens:  RAGConfig.get('llm.maxTokens'),
      stream: true,
    }),
    signal,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err?.error?.message || resp.statusText;
    if (resp.status === 401 || resp.status === 403) {
      _promptForToken();
      return { answer: null };
    }
    throw new Error('Groq API ' + resp.status + ': ' + msg);
  }

  // Store visitor ID from proxy response
  const respVisitorId = resp.headers.get('X-Visitor-Id');
  if (respVisitorId) _storageSet('wllmrag_visitor_id', respVisitorId);

  const reader  = resp.body.getReader();
  const decoder = new TextDecoder();
  let raw = '', firstToken = true, buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop(); // hold back incomplete last line
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const token = JSON.parse(data).choices?.[0]?.delta?.content ?? '';
        if (token && firstToken) { firstToken = false; if (typingText) typingText.textContent = 'Generating…'; }
        raw += token;
      } catch {}
    }
  }

  const answer = deduplicateSentences(raw)
    .replace(/\n+\[?\d+\]?\s*https?:\/\/\S+/g, '')
    .replace(/\n+(sources|references|source list|cited|links)[\s\S]*/gi, '')
    .replace(/\n+\[\d+\][^\n]*/g, '')
    .trimEnd();

  return { answer };
}

// ---------------------------------------------------------------------------
// LLM streaming helper — used by Collection.llm() and the normal RAG path
// ---------------------------------------------------------------------------
async function _callLLM(systemPrompt, userInput, passages, signal) {
  if (!llmEngine) return { answer: 'LLM not available.' };

  const systemContent = passages
    ? `${systemPrompt}\n\nPassages:\n${passages}`
    : systemPrompt;

  const HISTORY_EXCHANGES = RAGConfig.get('llm.historyExchanges');
  const history = messages
    .filter(m => !m.isWelcome && (m.role === 'user' || m.role === 'assistant'))
    .slice(-(HISTORY_EXCHANGES * 2 + 1), -1)
    .map(m => ({
      role: m.role,
      content: m.role === 'assistant'
        ? m.content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().substring(0, 150)
        : m.content.substring(0, 100)
    }));

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const typingText = document.querySelector('#typing-indicator span.text-gray-400');
  if (typingText) typingText.textContent = 'Reading…';

  const stream = await llmEngine.chat.completions.create({
    messages: [
      { role: 'system', content: systemContent },
      ...history,
      { role: 'user',   content: userInput }
    ],
    temperature:        RAGConfig.get('llm.temperature'),
    repetition_penalty: RAGConfig.get('llm.repetitionPenalty'),
    max_tokens:         RAGConfig.get('llm.maxTokens'),
    stream: true,
  });

  let raw = '', firstToken = true;
  for await (const chunk of stream) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const token = chunk.choices[0]?.delta?.content ?? '';
    if (token && firstToken) { firstToken = false; if (typingText) typingText.textContent = 'Generating…'; }
    raw += token;
  }

  const answer = deduplicateSentences(raw)
    .replace(/\n+\[?\d+\]?\s*https?:\/\/\S+/g, '')
    .replace(/\n+(sources|references|source list|cited|links)[\s\S]*/gi, '')
    .replace(/\n+\[\d+\][^\n]*/g, '')
    .trimEnd();

  return { answer };
}

// ---------------------------------------------------------------------------
// Pipeline engine — parses and executes // expressions
//
// Grammar:  root ( '.' method '(' args? ')' )*
// Roots:    metaDocs | pages | topics | questions
// Methods:  search filter unique slice chunks llm count pluck join
// Template blocks {{ }} are evaluated first and returned directly.
// ---------------------------------------------------------------------------

function _parseLlmArgs(argsStr) {
  if (!argsStr) return {};
  const result  = {};
  const promptM = argsStr.match(/prompt\s*=\s*["']([^"']*)["']/);
  if (promptM) result.prompt = promptM[1];
  const rest = argsStr.replace(/\w+\s*=\s*["'][^"']*["']\s*,?\s*/g, '').trim();
  const posM = rest.match(/^["'](.*)["']$/s);
  if (posM) result.userInput = posM[1];
  return result;
}

function _splitArgs(argsStr) {
  const parts = [];
  let cur = '', inQ = false, qCh = '';
  for (const ch of argsStr) {
    if (!inQ && (ch === '"' || ch === "'")) { inQ = true; qCh = ch; cur += ch; }
    else if (inQ && ch === qCh)             { inQ = false; cur += ch; }
    else if (!inQ && ch === ',')            { parts.push(cur.trim()); cur = ''; }
    else                                    { cur += ch; }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function _parsePattern(s) {
  s = (s || '').trim();
  const reM = s.match(/^\/(.*)\/([gimsuy]*)$/);
  if (reM) return new RegExp(reM[1], reM[2]);
  const strM = s.match(/^["'](.*)["']$/s);
  return strM ? strM[1] : s;
}

function _getRootCollection(name) {
  switch (name) {
    case 'pages':     return new Collection(metaDocs).unique('url');
    case 'topics':    return new Collection(metaDocs.filter(d => d.title && d.title !== 'Untitled')).unique('title');
    case 'questions': return new Collection(metaDocs.filter(d => d.question));
    case 'rag':       return new Collection(metaDocs, null, getMaxSources() * RAGConfig.get('retrieval.candidatesMultiplier'));
    default:          return new Collection(metaDocs);
  }
}

function _formatCollectionResult(col) {
  if (!col._docs.length) return 'No results.';
  const docs = col._docs;
  // Check if all docs share the same URL — if so, show each chunk individually
  const urls = new Set(docs.map(d => d.url));
  if (urls.size === 1) {
    // All same page — show each chunk with identifying fields, no dedup
    const sep = '\u2500'.repeat(40);
    return docs.map((d, i) => {
      const id    = d.chunkId != null ? '  chunkId: ' + d.chunkId : '';
      const q     = d.question ? '  Q: ' + d.question : '';
      const type  = d.type ? '  type: ' + d.type : '';
      const extra = [id, type, q].filter(Boolean).join('');
      return '[' + (i+1) + '] ' + (d.title || d.url || '') + extra;
    }).join('\n' + sep + '\n');
  }
  // Multiple URLs — deduplicate and show one per page
  const seen = new Set();
  return docs
    .filter(d => { if (seen.has(d.url)) return false; seen.add(d.url); return true; })
    .map((d, i) => '[' + (i+1) + '] ' + (d.title || d.url || '') + (d.url ? '\n    ' + d.url : ''))
    .join('\n\n');
}

async function _pipelineHelp(prefix) {
  const p = prefix;

  // --- Live evaluation of non-LLM examples against current index ---
  const allPages     = _getRootCollection('pages');
  const allQuestions = _getRootCollection('questions');

  // counts
  const pageCount = allPages.count;
  const qCount    = allQuestions.count;

  // filter examples — sync, always available
  const buyerPages       = allPages.filter('url', 'buyer');
  const sellerBuyerPages = allPages.filter('url', /seller|buyer/);

  const fmtList = (col, max = 4) => {
    const seen = new Set();
    const rows = col._docs
      .filter(d => { if (seen.has(d.url)) return false; seen.add(d.url); return true; })
      .slice(0, max)
      .map((d, i) => `  [${i+1}] ${d.title || d.url}  —  ${d.url}`);
    const extra = col.count - rows.length;
    if (extra > 0) rows.push(`  …+${extra} more`);
    return rows.join('\n');
  };

  // search example — only if embedder is loaded (async)
  let searchResult = '  (embedding model not loaded yet — run the command to see results)';
  if (embedder && embMatrix) {
    try {
      const res = await allPages.search('mortgage rates');
      const unique = res.unique('url');
      searchResult = fmtList(unique, 5);
    } catch(e) {
      searchResult = `  (search unavailable: ${e.message})`;
    }
  }

  // char budget info
  const budget = RAGConfig.get('retrieval.passageCharLimit') * getMaxSources();

  return { answer: `**${p} pipeline reference**

**Roots**
  \`rag\`         — pre-configured RAG root (candidatesMultiplier baked in)
  \`pages\`       — ${pageCount} unique pages
  \`questions\`   — ${qCount} indexed questions
  \`metaDocs\`    — all ${metaDocs.length} index entries (one per question)
  \`topics\`      — unique page titles

**Shorthands**
  \`rag("q")\`             — full default pipeline: search → unique → slice → chunks → llm
  \`trace("q")\`           — same pipeline with detailed stage-by-stage trace output

**Transforms**
  \`.search("q")\`            — semantic search (sets implicit LLM query)
  \`.filter("field","text")\`  — field contains text (case-insensitive)
  \`.filter("field",/regex/)\` — field matches regex
  \`.unique("field")\`         — deduplicate by field
  \`.slice(n)\`                — first n results
  \`.chunks()\`                — attach prose text (required before .llm())

**Terminals**
  \`.count\`                   — number of results
  \`.pluck("field")\`          — list of field values
  \`.join("sep")\`             — join to string
  \`.llm()\`                   — send to local LLM (query from .search context, or "Summarize the key information.")
  \`.llm("question")\`         — explicit question
  \`.llm(prompt="...", "q")\`  — override system prompt + question
  \`.groq()\`                  — send to Groq API (set key in Settings → Pipeline)
  \`.groq("question")\`        — explicit question via Groq
  \`.trace\`                   — send to LLM with full pipeline stage report
  \`.text\`                    — show raw chunk text (chunkId, type, question fields)
  \`.duplicates()\`            — find URLs with >1 chunk; renders bar chart with filter chips
  \`.groupBy("field")\`        — group collection by field with cardinality stats

**LLM context budget:** ${budget} chars (passageCharLimit × maxSources — adjust in Settings → Retrieval)

---
**Live examples against current index**

\`${p} pages.count\`
  → ${pageCount}

\`${p} questions.count\`
  → ${qCount}

\`${p} pages.filter("url","buyer")\`
  → ${buyerPages.count} pages:
${fmtList(buyerPages)}

\`${p} pages.filter("url",/seller|buyer/)\`
  → ${sellerBuyerPages.count} pages:
${fmtList(sellerBuyerPages)}

\`${p} metaDocs.search("mortgage rates").unique("url")\`
${searchResult}

---
**LLM / RAG examples** (syntax only — run to execute)

\`${p} rag("what are closing costs?")\`
\`${p} trace("what are closing costs?")\`
\`${p} metaDocs.search("buyer homes").chunks().llm()\`
\`${p} pages.chunks().llm("summarize all pages")\`
\`${p} pages.filter("url","seller").chunks().llm("what seller resources are available?")\`
\`${p} pages.filter("url","seller").chunks().llm(prompt="Answer in bullet points","seller resources")\`
\`${p} metaDocs.search("fees").unique("url").slice(5).chunks().trace\`

---
**Inspection examples**

\`${p} metaDocs.duplicates()\`
\`${p} metaDocs.groupBy("type")\`
\`${p} metaDocs.search("mortgage").text\`

---
**Template blocks** (mix with text)

\`${p} {{pages.count}} pages and {{questions.count}} questions indexed\`
\`${p} {{topics.slice(5).join(", ")}}\``, sources: [] };
}

async function executePipeline(expr, signal, context = {}) {
  // {{ }} template expressions — evaluate and return directly
  if (expr.includes('{{')) {
    try {
      const rendered = renderWelcomeTemplate(expr);
      return { answer: rendered, sources: [] };
    } catch (e) {
      console.error('Pipeline template error:', e);
      return { answer: '⚠ Template error: ' + e.message, sources: [] };
    }
  }

  // Bare llm(...) root — ask LLM directly with no RAG passages
  const llmRootM = expr.trim().match(/^llm\(([^)]*)\)\s*$/);
  if (llmRootM) {
    const { prompt, userInput } = _parseLlmArgs(llmRootM[1]);
    const systemPrompt = prompt ?? RAGConfig.get('llm.systemPrompt');
    const question = userInput ?? 'Summarize the key information.';
    const callFn = RAGConfig.get('llm.provider') === 'groq' ? _callGroq : _callLLM;
    return await callFn(systemPrompt, question, [], signal);
  }

  // trace("query") — sugar: delegates to _ragPipeline with trace terminal
  const traceM = expr.trim().match(/^trace\(["'](.+)["']\)\s*$/s);
  if (traceM) return await _ragPipeline(traceM[1], signal, 'trace');

  const rootM = expr.trim().match(/^(metaDocs|pages|topics|questions|rag)([\s\S]*)$/);
  if (!rootM) return null;

  // rag("q") shorthand — delegates to _ragPipeline with llm terminal
  if (rootM[1] === 'rag') {
    const callM = (rootM[2] || '').match(/^\(["'](.+)["']\)\s*$/s);
    if (callM) return await _ragPipeline(callM[1], signal, 'llm');
  }

  // Seed ambient query into rag root from context so .rewrite().search() can pick it up
  let value = rootM[1] === 'rag' && context.query
    ? new Collection(metaDocs, context.query, getMaxSources() * RAGConfig.get('retrieval.candidatesMultiplier'))
    : _getRootCollection(rootM[1]);
  let rest  = rootM[2] || '';

  while (rest.startsWith('.')) {
    rest = rest.slice(1);
    const m = rest.match(/^(\w+)(?:\(([^)]*)\))?([\s\S]*)$/);
    if (!m) break;
    const [, method, argsStr, tail] = m;
    rest = tail || '';

    if (method === 'rewrite') {
      const promptM = (argsStr || '').match(/^["'](.+)["']$/s);
      value = await value.rewrite(promptM ? promptM[1] : undefined);
    } else if (method === 'search') {
      const qM = (argsStr || '').match(/^["'](.*)["']$/s);
      const q  = qM ? qM[1] : (argsStr || '').trim();
      value = await value.search(q);  // k defaults to min(50, docs.length)
    } else if (method === 'filter') {
      const [fPart = '', pPart = ''] = _splitArgs(argsStr || '');
      const field = fPart.replace(/^["']|["']$/g, '');
      const pat   = pPart.replace(/^["']|["']$/g, '');

      // filter("") or filter() — show all available fields with unique value counts
      if (!field) {
        const docs = value._docs;
        if (!docs.length) return { answer: 'No documents in current collection.', sources: [] };
        const fields = [...new Set(docs.flatMap(d => Object.keys(d).filter(k => !k.startsWith('_') && typeof d[k] === 'string')))].sort();
        const _pfx = RAGConfig.get('ui.systemCommandPrefix') || '//';
        const rootExpr = rootM[1] + (rootM[2] || '').replace(/\.filter\([^)]*\)[\s\S]*$/, '');
        const lines = fields.map(f => {
          const vals = [...new Set(docs.map(d => d[f]).filter(Boolean))];
          return `  \`${_pfx} ${rootExpr}.filter("${f}","")\`  — ${vals.length} unique value${vals.length !== 1 ? 's' : ''}`;
        });
        return { answer: `Available fields on ${rootM[1]}:\n\n${lines.join('\n')}`, sources: [] };
      }

      // filter("field","") — show all unique values for that field as clickable commands
      if (!pat) {
        const docs = value._docs;
        const vals = [...new Set(docs.map(d => d[field]).filter(Boolean))].sort();
        if (!vals.length) return { answer: `No values found for field "${field}".`, sources: [] };
        const _pfx = RAGConfig.get('ui.systemCommandPrefix') || '//';
        const rootExpr = rootM[1] + (rootM[2] || '').replace(/\.filter\([^)]*\)[\s\S]*$/, '');
        const lines = vals.map(v => `  \`${_pfx} ${rootExpr}.filter("${field}","${v}")\``);
        return { answer: `Unique values for "${field}" (${vals.length}):\n\n${lines.join('\n')}`, sources: [] };
      }

      value = value.filter(field, _parsePattern(pPart));
    } else if (method === 'unique') {
      const fM = (argsStr || '').match(/^["']?(\w+)["']?$/);
      value = value.unique(fM ? fM[1] : 'url');
    } else if (method === 'slice') {
      value = value.slice(parseInt(argsStr || '10') || 10);
    } else if (method === 'count') {
      return { answer: String(value.count), sources: [] };
    } else if (method === 'pluck') {
      const fM = (argsStr || '').match(/^["']?(\w+)["']?$/);
      return { answer: value.pluck(fM ? fM[1] : 'title').join('\n'), sources: [] };
    } else if (method === 'join') {
      const sM = (argsStr || '').match(/^["'](.*)["']$/s);
      return { answer: value.join(sM ? sM[1] : ', '), sources: [] };
    } else if (method === 'text') {
      // Show raw text content of each chunk with identifying info
      await ensureTextLoaded();
      const docs = value._docs;
      if (!docs.length) return { answer: 'No results.', sources: [] };
      const sep = '─'.repeat(40);
      const lines = docs.map((d, i) => {
        const text    = getText(d.id).trim();
        const chunkId = d.chunkId != null ? '  chunkId:' + d.chunkId : '';
        const type    = d.type    ? '  type:' + d.type : '';
        const q       = d.question ? '\n  Q: ' + d.question : '';
        const header  = '[' + (i+1) + '] ' + (d.title || d.url || '') + chunkId + type + q;
        const preview = text ? '\n' + text : '\n(no text)';
        return header + preview;
      });
      return { answer: lines.join('\n' + sep + '\n'), sources: [] };
    } else if (method === 'chunks') {
      value = await value.chunks();
    } else if (method === 'llm') {
      return await value.llm(argsStr || '', signal);
    } else if (method === 'groq') {
      return await value.groq(argsStr || '', signal);
    } else if (method === 'trace') {
      const provM = (argsStr || '').match(/^["'](\w+)["']$/);
      return await value.trace(signal, provM ? provM[1] : 'local');
    } else if (method === 'duplicates') {
      // Show all URLs with more than one chunk, ranked by count desc
      const docs  = value._docs;
      const _pfx  = RAGConfig.get('ui.systemCommandPrefix') || '//';
      const rootExpr = rootM[1];
      if (!docs.length) return { answer: 'No documents in current collection.', sources: [] };
      const freq = {};
      docs.forEach(d => { freq[d.url] = (freq[d.url] || 0) + 1; });
      const dupes = Object.entries(freq)
        .filter(([, n]) => n > 1)
        .sort((a, b) => b[1] - a[1]);
      if (!dupes.length) {
        return { answer: '✓ No duplicates — every URL appears exactly once across ' + docs.length + ' chunks.', sources: [] };
      }
      const maxCount   = dupes[0][1];
      const extraTotal = dupes.reduce((s, [, n]) => s + (n - 1), 0);
      const summary    = dupes.length + ' URL' + (dupes.length !== 1 ? 's' : '') +
                         ' have duplicate chunks (' + extraTotal + ' extra chunk' +
                         (extraTotal !== 1 ? 's' : '') + ' out of ' + docs.length + ' total)';
      // Strip common prefix
      const vals = dupes.map(([v]) => v);
      const commonPrefix = vals.length > 1 ? (() => {
        let pfx = vals[0];
        for (const v of vals) { while (!v.startsWith(pfx)) pfx = pfx.slice(0, -1); }
        const cutAt = pfx.lastIndexOf('/');
        return cutAt > 0 ? pfx.slice(0, cutAt + 1) : '';
      })() : '';
      const maxLen = Math.max(...dupes.map(([v]) => {
        const d = v.startsWith(commonPrefix) ? v.slice(commonPrefix.length) || '/' : v;
        return d.length;
      }));
      const lines = dupes.map(([url, n]) => {
        const display = url.startsWith(commonPrefix) ? url.slice(commonPrefix.length) || '/' : url;
        const bar     = '█'.repeat(Math.round((n / maxCount) * 12));
        const pct     = ((n / docs.length) * 100).toFixed(2);
        const padded  = display.padEnd(maxLen);
        const chip    = '`' + _pfx + ' ' + rootExpr + '.filter("url","' + url + '").text`';
        return '  ' + padded + '  ' + String(n).padStart(String(maxCount).length) + ' chunks  ' + bar + '  ' + pct + '%  \u2192 ' + chip;
      });
      const prefixNote = commonPrefix ? '\n  (prefix stripped: ' + commonPrefix + ')' : '';
      return {
        answer: summary + prefixNote + '\n' + lines.join('\n'),
        sources: []
      };
    } else if (method === 'groupBy') {
      const fM  = (argsStr || '').match(/^["']?(\w+)["']?$/);
      const field = fM ? fM[1] : '';
      const docs  = value._docs;
      const _pfx  = RAGConfig.get('ui.systemCommandPrefix') || '//';
      const rootExpr = rootM[1] + (rootM[2] || '').replace(/\.groupBy\([^)]*\)[\s\S]*$/, '');

      // groupBy() — no field: list all groupable fields sorted by cardinality asc
      if (!field) {
        if (!docs.length) return { answer: 'No documents in current collection.', sources: [] };
        const fields = [...new Set(docs.flatMap(d =>
          Object.keys(d).filter(k => !k.startsWith('_') && typeof d[k] === 'string')
        ))].sort();
        const ranked = fields
          .map(f => ({ f, n: new Set(docs.map(d => d[f]).filter(Boolean)).size }))
          .sort((a, b) => a.n - b.n);
        const pad = Math.max(...ranked.map(r => r.f.length));
        const lines = ranked.map(r => {
          const label = r.f.padEnd(pad);
          const bar   = r.n === docs.length ? ' (unique per chunk)' : '';
          return '  `' + _pfx + ' ' + rootExpr + '.groupBy("' + r.f + '")' + '`' +
                 '  — ' + r.n + ' unique value' + (r.n !== 1 ? 's' : '') + bar;
        });
        return { answer: 'Available fields to group by (' + rootM[1] + ', ' + docs.length + ' chunks):\n\n' + lines.join('\n'), sources: [] };
      }

      // groupBy("field") — group and count, sort by count desc
      const freq = {};
      docs.forEach(d => {
        const v = d[field] || '(empty)';
        freq[v] = (freq[v] || 0) + 1;
      });
      const entries = Object.entries(freq).sort((a, b) => b[1] - a[1]);
      const maxCount = entries[0]?.[1] || 1;
      const vals     = entries.map(([v]) => v);
      // Strip common prefix (e.g. https://example.com) to show only the distinctive path
      const commonPrefix = vals.length > 1 ? (() => {
        let pfx = vals[0];
        for (const v of vals) { while (!v.startsWith(pfx)) pfx = pfx.slice(0, -1); }
        // Only strip up to the last / of the prefix so we don't cut mid-segment
        const cutAt = pfx.lastIndexOf('/');
        return cutAt > 0 ? pfx.slice(0, cutAt + 1) : '';
      })() : '';
      const maxLen   = Math.max(...vals.map(v => (v.startsWith(commonPrefix) ? v.slice(commonPrefix.length) : v).length));
      const lines = entries.map(([v, n]) => {
        const display = v.startsWith(commonPrefix) ? v.slice(commonPrefix.length) || '/' : v;
        const bar     = '█'.repeat(Math.round((n / maxCount) * 12));
        const pct     = ((n / docs.length) * 100).toFixed(1);
        const valPad  = display.padEnd(maxLen);
        return '  ' + valPad + '  ' + String(n).padStart(String(maxCount).length) + '  ' + bar + '  ' + pct + '%';
      });
      const prefixNote = commonPrefix ? '  (prefix stripped: ' + commonPrefix + ')' : '';
      const dupes = entries.filter(([, n]) => n > 1);
      const dupeLine = dupes.length
        ? '\n\u26a0 ' + dupes.length + ' value' + (dupes.length !== 1 ? 's' : '') + ' have multiple chunks (' +
          dupes.reduce((s, [, n]) => s + n, 0) + ' chunks total)'
        : '\n\u2713 No duplicates \u2014 every value appears exactly once';
      return {
        answer: 'groupBy("' + field + '")  \u2014  ' + entries.length + ' groups, ' + docs.length + ' chunks' + prefixNote + ':\n\n' +
                lines.join('\n') + dupeLine,
        sources: []
      };
    }
  }

  // No terminal method — format Collection as a numbered list
  if (value instanceof Collection) {
    return { answer: _formatCollectionResult(value), sources: value._docs };
  }
  return { answer: String(value), sources: [] };
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
// RAG + LLM generation
async function chat(query, signal = null) {

  // --- Simple mode: skip pipeline commands ---
  if (RAGConfig.get('ui.mode') === 'simple') {
    // Go straight to RAG pipeline, no // command parsing
    return await _ragPipeline(query, signal, 'llm');
  }

  // --- Pipeline: // prefix triggers power-user expression mode ---
  const _sysPrefix   = RAGConfig.get('ui.systemCommandPrefix') || '//';
  const _sysPrefixRe = new RegExp('^' + _sysPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*');
  if (_sysPrefixRe.test(query)) {
    const expr   = query.replace(_sysPrefixRe, '').trim();
    // Explicit help command or empty expression → open reference panel, no chat message
    if (!expr || expr === 'help') {
      _openReferencePanel();
      return { answer: `📖 Reference panel opened.\n\nValid roots: rag, pages, metaDocs, questions, topics, llm("...")\nShorthands: rag("q"), trace("q")\nExample: // rag("what are closing costs?")\n\nSee the Reference tab in the questions panel for full syntax.`, sources: [] };
    }
    const result = await executePipeline(expr, signal);
    if (result) return result;
    // Unrecognized expression — show error in terminal card
    console.warn('[pipeline] unrecognized expression:', expr);
    return {
      answer: `⚠ Unknown expression: "${expr}"\n\nValid roots: rag, pages, metaDocs, questions, topics\nShorthands: rag("q"), trace("q"), llm("q")\nExample: // rag("what are closing costs?")\n         // trace("what are closing costs?")\n\nType // help to open the reference panel.`,
      sources: []
    };
  }

  // --- Normal RAG path via Collection pipeline ---
  // Same code path as // rag("query") and // trace("query") — single canonical implementation
  const ragEnabled = RAGConfig.get('retrieval.ragEnabled') !== false;

  if (!ragEnabled) {
    const isGroqProvider = RAGConfig.get('llm.provider') === 'groq';
    if (!isGroqProvider && !llmEngine) return { answer: '_LLM not available and RAG is disabled._', sources: [] };
    try {
      const callFn = isGroqProvider ? _callGroq : _callLLM;
      const { answer } = await callFn(RAGConfig.get('llm.systemPrompt'), query, '', signal);
      return { answer, sources: [] };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      _handleLLMError(e);
      return { answer: '_LLM error. Please try again._', sources: [] };
    }
  }

  try {
    return await _ragPipeline(query, signal, 'llm');
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    _handleLLMError(e);
  }

  // Template fallback when LLM fails or is not loaded
  const fallbackCol = await _getRootCollection('rag').search(query);
  const fallbackSrc = fallbackCol.unique('url').slice(getMaxSources())._docs;
  await ensureTextLoaded();
  if (!fallbackSrc.length) return { answer: 'No relevant content found in your site.', sources: [] };
  const passLen = RAGConfig.get('retrieval.passageCharLimit');
  const fbAnswer = "Here's what I found on the site:\n\n" +
    fallbackSrc.map((s, i) => '[' + (i+1) + '] ' + getText(s.id).substring(0, passLen) + '...').join('\n\n');
  return { answer: fbAnswer, sources: fallbackSrc };
}


// Shared LLM error handler — GPU device lost detection
function _handleLLMError(e) {
  if (e.message?.includes('Device was lost') || e.message?.includes('external Instance')) {
    console.warn('⚠️ GPU device lost — resetting engine, please reload model');
    llmEngine = null;
    engineState.mode = 'fallback';
    engineState.failReason = 'GPU device lost — use Load button to reload model';
    updateEngineStatus();
  } else {
    console.warn('LLM error:', e);
  }
}

// Canonical RAG pipeline — single implementation shared by chat(), autoTrace, rag(), trace()
// terminal: 'llm' | 'trace'
async function _ragPipeline(query, signal, terminal = 'llm') {
  // Use configured pipeline expression if set, otherwise use hardcoded default
  const pipelineExpr = RAGConfig.get('pipeline.default');

  const isGroqProvider = RAGConfig.get('llm.provider') === 'groq';

  if (pipelineExpr) {
    // Swap terminal: replace trailing .llm(), .groq(), or .trace() with the requested terminal
    const expr = pipelineExpr
      .replace(/\.llm\(([^)]*)\)\s*$/, terminal === 'trace' ? '.trace()' : (isGroqProvider ? '.groq()' : '.llm($1)'))
      .replace(/\.groq\([^)]*\)\s*$/,  terminal === 'trace' ? '.trace("groq")' : '.groq()')
      .replace(/\.trace\(\)\s*$/,      terminal === 'trace' ? '.trace()' : (isGroqProvider ? '.groq()' : '.llm()'));
    return await executePipeline(expr, signal, { query });
  }

  // Default hardcoded pipeline — equivalent to:
  // rag.search().unique("url").slice(n).chunks().llm()/groq()
  const col     = await _getRootCollection('rag').search(query);
  const prepped = await col.unique('url').slice(getMaxSources()).chunks();
  if (terminal === 'trace') return await prepped.trace(signal, isGroqProvider ? 'groq' : 'local');
  if (isGroqProvider) return await prepped.groq('', signal);
  return await prepped.llm('', signal);
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
  const rawInput = input.value.trim();
  const _sysP0   = RAGConfig.get('ui.systemCommandPrefix') || '//';
  const _isPipe0  = new RegExp('^' + _sysP0.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*').test(rawInput);
  const query    = _isPipe0 ? rawInput : renderWelcomeTemplate(rawInput);
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
  let traceLines = null;
  let chatSucceeded = false;
  const _sysP   = RAGConfig.get('ui.systemCommandPrefix') || '//';
  const isPipelineCmd = new RegExp('^' + _sysP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*').test(query);
  const autoTrace = !isPipelineCmd && RAGConfig.get('debug.traceEnabled') === true;

  try {
    let result;
    result = autoTrace
      ? await _ragPipeline(query, signal, 'trace')
      : await chat(query, signal);
    answer     = result.answer;
    if (answer === null) { typing.remove(); _abortController = null; return; }   // settings panel opened, no response to render
    sources    = result.sources || [];
    traceLines = result.traceLines || null;
    // For // pipeline commands that produced a trace, fold trace into the terminal
    // card body so the dark console card shows everything inline.
    if (isPipelineCmd && traceLines) {
      const sep = '\u2550'.repeat(48);
      answer = [...traceLines, '', sep, 'ANSWER', sep, answer].join('\n');
      traceLines = null;
    }
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

  // Pipeline commands may return falsy-but-valid answers (e.g. "0" from a count).
  // Only suppress truly empty answers ('' signals intentional no-output, e.g. // help).
  const isTraced = !!traceLines;
  const effectivePipelineCmd = isPipelineCmd && !isTraced;
  const shouldRender = effectivePipelineCmd ? answer !== '' : !!answer;
  if (shouldRender) {
    messages.push({
      role: 'assistant', content: answer, sources,
      isPipelineCmd: effectivePipelineCmd,
      pipelineQuery: effectivePipelineCmd ? query : undefined,
      isTraced, traceLines,
    });
    saveMessages();
    renderMessages();

    // Send sources to proxy for D1 logging
    if (sources.length) {
      _sendProxyEvent({
        action: 'metadata',
        sources: sources.map(s => ({ url: s.url, title: s.title })),
      });
    }
  }
  if (chatSucceeded && !effectivePipelineCmd) updateQuestionsFromChat(answer, messages.length - 1);

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

    if (m.role === 'assistant' && m.isPipelineCmd) {
      // Terminal card for pipeline command output
      const _pfx  = RAGConfig.get('ui.systemCommandPrefix') || '//';
      const _pfxH = escHtml(_pfx);
      const _pfxRe = _pfxH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Wrap `// cmd` backtick spans into clickable chips; remaining backtick spans into inline code
      let body = escHtml(content)
        .replace(
          new RegExp('`(' + _pfxRe + '[^`]+)`', 'g'),
          (match, cmd) => `<button class="msg-pipeline-cmd-chip" data-cmd="${cmd.trim()}">${match}</button>`
        )
        .replace(/`([^`]+)`/g, '<code style="background:#313244;padding:1px 5px;border-radius:3px;font-size:11.5px">$1</code>');
      let sourcesHtml = '';
      if (m.sources && m.sources.length) {
        const chips = m.sources.map(s => {
          let title = s.title;
          if (!title || title === 'undefined') {
            title = s.url.split('/').pop()
              ?.replace(/-/g,' ').replace(/\.html?$/,'').replace(/\?.*/,'') || 'Source';
          }
          return `<a href="${escHtml(s.url)}" target="_blank" class="msg-pipeline-source-chip">${escHtml(title)}</a>`;
        }).join('');
        sourcesHtml = `<div class="msg-pipeline-sources">${chips}</div>`;
      }
      return `
        <div class="flex justify-start">
          <div class="msg-pipeline-card">
            <div class="msg-pipeline-titlebar" ${m.pipelineQuery ? `data-user-msg="${escHtml(m.pipelineQuery)}" title="Click to edit command" style="cursor:pointer"` : ''}>
              <span class="msg-pipeline-dot msg-pipeline-dot-r"></span>
              <span class="msg-pipeline-dot msg-pipeline-dot-y"></span>
              <span class="msg-pipeline-dot msg-pipeline-dot-g"></span>
              <span class="msg-pipeline-label">${m.pipelineQuery ? escHtml(m.pipelineQuery) : 'pipeline'}</span>
              <button onclick="event.stopPropagation();openSettingsPipeline()" title="Pipeline settings" style="margin-left:auto;background:none;border:none;cursor:pointer;color:#6c7086;font-size:11px;padding:0 2px;line-height:1" onmouseover="this.style.color='#cba6f7'" onmouseout="this.style.color='#6c7086'">⚙</button>
            </div>
            <div class="msg-pipeline-body">${body}</div>
            ${sourcesHtml}
          </div>
        </div>
      `;
    }

    if (m.role === 'assistant' && m.isTraced) {
      let ac = m.content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      if (m.sources && m.sources.length) {
        ac = ac.replace(/\[(\d+)\]/g, (match, num) => {
          const src = m.sources[parseInt(num) - 1];
          if (!src) return match;
          const title = src.title || src.url.split('/').pop() || `Source ${num}`;
          return `<a href="${escHtml(src.url)}" target="_blank" class="text-blue-600 hover:text-blue-800 font-semibold underline" title="${escHtml(title)}">[${num}]</a>`;
        });
      }
      ac = linkify(ac);
      ac = ac.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      let traceSourceChips = '';
      if (m.sources && m.sources.length) {
        const chips = m.sources.map(s => {
          let title = s.title;
          if (!title || title === 'undefined') {
            title = s.url.split('/').pop()?.replace(/-/g,' ').replace(/\.html?$/,'').replace(/\?.*/,'') || 'Source';
          }
          return `<a href="${escHtml(s.url)}" target="_blank" class="msg-source-chip">${escHtml(title)}</a>`;
        }).join('');
        traceSourceChips = `<div class="msg-source-chips">${chips}</div>`;
      }
      const traceText = (m.traceLines || []).join('\n');
      // Related question chips
      const traceRelated = messageRelated.get(i) || [];
      let traceRelatedHtml = '';
      if (traceRelated.length) {
        const chips = traceRelated.map(q =>
          `<button class="msg-question-chip" data-question="${escHtml(q)}">${escHtml(q)}</button>`
        ).join('');
        traceRelatedHtml = `<div class="msg-related-chips">${chips}</div>`;
      }
      return `
        <div class="flex justify-start">
          <div class="bg-white border shadow-sm max-w-[85%] sm:max-w-xl p-3 sm:p-4 rounded-2xl text-sm sm:text-base text-left">
            ${ac.replace(/\n/g, '<br>')}
            ${traceSourceChips}
            ${traceRelatedHtml}
            <details class="msg-trace-details">
              <summary class="msg-trace-summary">Pipeline trace</summary>
              <pre class="msg-trace-pre">${escHtml(traceText)}</pre>
            </details>
          </div>
        </div>
      `;
    }

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

    const isUser = m.role === 'user';
    return `
      <div class="${isUser ? 'flex justify-end' : 'flex justify-start'}">
        <div class="${
          isUser
            ? 'bg-blue-500 text-white cursor-pointer select-none'
            : m.isWelcome
            ? 'bg-blue-50 border border-blue-100 text-gray-700'
            : 'bg-white border shadow-sm'
        } max-w-[85%] sm:max-w-xl p-3 sm:p-4 rounded-2xl text-sm sm:text-base text-left"
        ${isUser ? `title="Click to edit" data-user-msg="${escHtml(m.content)}"` : ''}>
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

// ---------------------------------------------------------------------------
// Welcome message template engine
// Syntax: {{ expr }} — expressions evaluated against index collections.
//
// Root collections:
//   pages      — unique pages (by URL); each item has .title and .url
//   topics     — unique page titles (strings)
//   questions  — unique question strings (only present in question-indexed sites)
//
// Chainable methods:
//   .count            — number of items
//   .slice(n)         — first n items
//   .search("text")   — filter items whose title/question contains text (case-insensitive)
//   .join("sep")      — collapse to string (default ", ")
//
// count(expr) — shorthand function form for expr.count
//
// Examples:
//   {{pages.count}}
//   {{topics.slice(6).join(", ")}}
//   {{pages.search("waterfront").count}}
//   {{questions.slice(3).join(" · ")}}
// ---------------------------------------------------------------------------
function _buildWelcomeCtx() {
  const seenUrls = new Set();
  const pages = [];
  for (const d of metaDocs) {
    if (!seenUrls.has(d.url)) { seenUrls.add(d.url); pages.push(d); }
  }
  const topics    = [...new Set(metaDocs.map(d => d.title).filter(t => t && t !== 'Untitled'))];
  const questions = [...new Set(metaDocs.filter(d => d.question).map(d => d.question))];
  return { pages, topics, questions };
}

function _evalWelcomeExpr(exprStr, ctx) {
  const toStr = item => typeof item === 'string' ? item : (item.title || item.url || '');
  exprStr = exprStr.trim();

  // count(expr) function form
  const countM = exprStr.match(/^count\((.+)\)$/s);
  if (countM) {
    const inner = _evalWelcomeExpr(countM[1].trim(), ctx);
    return Array.isArray(inner) ? inner.length : (typeof inner === 'number' ? inner : 0);
  }

  // Root collection
  const rootM = exprStr.match(/^(pages|topics|questions)([\s\S]*)$/);
  if (!rootM) return '';

  let value = ctx[rootM[1]];
  let rest  = rootM[2] || '';

  while (rest.length) {
    if (!rest.startsWith('.')) break;
    rest = rest.slice(1);
    const m = rest.match(/^(\w+)(?:\(([^)]*)\))?([\s\S]*)$/);
    if (!m) break;
    const [, method, argsStr, tail] = m;
    rest = tail || '';

    if (method === 'count') {
      value = Array.isArray(value) ? value.length : 0;
    } else if (method === 'slice' && argsStr !== undefined) {
      const n = parseInt(argsStr);
      value = Array.isArray(value) ? value.slice(0, isNaN(n) ? value.length : n) : value;
    } else if (method === 'search' && argsStr !== undefined) {
      const qM = argsStr.match(/^["'](.*)["']$/s);
      const q  = (qM ? qM[1] : argsStr).toLowerCase();
      value = Array.isArray(value) ? value.filter(item => toStr(item).toLowerCase().includes(q)) : value;
    } else if (method === 'join') {
      const sM  = argsStr !== undefined ? argsStr.match(/^["'](.*)["']$/s) : null;
      const sep = sM ? sM[1] : ', ';
      value = Array.isArray(value) ? value.map(toStr).join(sep) : String(value ?? '');
    }
  }

  if (Array.isArray(value)) return value.map(toStr).join(', ');
  return String(value ?? '');
}

function renderWelcomeTemplate(text) {
  if (!text.includes('{{')) return text;
  const ctx = _buildWelcomeCtx();
  return text.replace(/\{\{([^}]+)\}\}/g, (_, expr) => {
    try {
      return String(_evalWelcomeExpr(expr, ctx));
    } catch(e) {
      console.warn('Welcome template error in:', expr, e);
      return `{{${expr}}}`;
    }
  });
}

// Generate a welcome message — uses config welcome if set, else auto-generates from index
async function generateWelcome() {
  const configWelcome = RAGConfig.get('ui.welcomeMessage');
  if (configWelcome && configWelcome.trim()) {
    messages.push({ role: 'assistant', content: renderWelcomeTemplate(configWelcome.trim()), sources: [], isWelcome: true });
    renderMessages();
    return;
  }

  if (!metaDocs.length) return;

  // Fallback auto-generate (used when welcomeMessage is blank)
  const ctx = _buildWelcomeCtx();
  const topicList = ctx.topics.length ? ctx.topics.slice(0, 6).join(', ') : 'various topics';
  const more = ctx.topics.length > 6 ? ' and more' : '';
  const welcomeText = `👋 Welcome! This site covers **${topicList}**${more}.\n\nAsk me anything about it.`;

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

// ---------------------------------------------------------------------------
// Questions panel tab switching
// ---------------------------------------------------------------------------
window.switchQuestionsTab = function(tab) {
  document.getElementById('qp-tab-questions')?.classList.toggle('active', tab === 'questions');
  document.getElementById('qp-tab-reference')?.classList.toggle('active', tab === 'reference');
  const qList = document.getElementById('questions-list');
  const rPane = document.getElementById('pipeline-ref-pane');
  if (qList) qList.style.display = tab === 'questions' ? '' : 'none';
  if (rPane) rPane.classList.toggle('active', tab === 'reference');
  if (tab === 'reference' && rPane && !rPane.dataset.populated) populatePipelineRef();
};

// Build the pipeline reference pane content
function populatePipelineRef() {
  const pane = document.getElementById('pipeline-ref-pane');
  if (!pane) return;
  const p = RAGConfig.get('ui.systemCommandPrefix') || '//';

  // Live counts (available once index is loaded)
  const pageCount = metaDocs.length ? new Collection(metaDocs).unique('url').count : '…';
  const qCount    = metaDocs.length ? metaDocs.filter(d => d.question).length : '…';
  const docCount  = metaDocs.length || '…';

  const chip = (cmd) =>
    `<button class="ref-cmd-chip" data-cmd="${escHtml(p + ' ' + cmd)}">${escHtml(p + ' ' + cmd)}</button>`;

  const row = (key, desc) =>
    `<div class="ref-row"><span class="ref-key">${escHtml(key)}</span><span class="ref-desc">${escHtml(desc)}</span></div>`;

  pane.innerHTML = `
    <div class="ref-section-hdr">Roots</div>
    ${row('rag', 'pre-configured RAG root (candidatesMultiplier baked in)')}
    ${row('pages', `${pageCount} unique pages`)}
    ${row('questions', `${qCount} indexed questions`)}
    ${row('metaDocs', `all ${docCount} entries`)}
    ${row('topics', 'unique page titles')}
    ${row('llm("question")', 'ask LLM directly — no RAG')}

    <div class="ref-section-hdr">Shorthands</div>
    ${row('rag("q")', 'full default pipeline: search → unique → slice → chunks → llm')}
    ${row('trace("q")', 'same pipeline with detailed trace output')}

    <div class="ref-section-hdr">Transforms</div>
    ${row('.search("q")', 'semantic search (sets implicit LLM query)')}
    ${row('.filter("field","text")', 'field contains text')}
    ${row('.filter("field",/regex/)', 'field matches regex')}
    ${row('.unique("field")', 'deduplicate by field')}
    ${row('.slice(n)', 'first n results')}
    ${row('.chunks()', 'attach prose (required before .llm())')}

    <div class="ref-section-hdr">Terminals</div>
    ${row('.count', 'number of results')}
    ${row('.pluck("field")', 'list field values')}
    ${row('.join("sep")', 'join to string')}
    ${row('.llm()', 'send to LLM (query from .search context)')}
    ${row('.llm("question")', 'explicit question')}
    ${row('.llm(prompt="…","q")', 'override system prompt')}
    ${row('.trace', 'send to LLM with full pipeline stage report')}
    ${row('.text', 'show raw chunk text (chunkId, type, question)')}
    ${row('.duplicates()', 'find URLs with >1 chunk (bar chart)')}
    ${row('.groupBy("field")', 'group collection by field with counts')}

    <div class="ref-section-hdr">Examples — click to fill input</div>
    ${chip('rag("what are closing costs?")')}
    ${chip('trace("what are closing costs?")')}
    ${chip('pages.count')}
    ${chip('questions.count')}
    ${chip('pages.filter("url","buyer")')}
    ${chip('pages.filter("url",/seller|buyer/)')}
    ${chip('metaDocs.search("mortgage rates").unique("url")')}
    ${chip('llm("What is a good question to ask about this site?")')}
    ${chip('metaDocs.search("buyer homes").chunks().llm()')}
    ${chip('pages.chunks().llm("summarize all pages")')}
    ${chip('pages.filter("url","seller").chunks().llm("seller resources")')}
    ${chip('metaDocs.duplicates()')}
    ${chip('metaDocs.groupBy("type")')}

    <div class="ref-section-hdr">Template syntax</div>
    ${row('{{pages.count}}', 'embed count in text')}
    ${row('{{topics.slice(5).join(", ")}}', 'list first 5 topics')}
    ${row('{{questions.count}}', 'total questions')}
  `;
  pane.dataset.populated = '1';
}

// Re-populate reference pane after index changes (counts may differ)
function refreshPipelineRef() {
  const pane = document.getElementById('pipeline-ref-pane');
  if (!pane) return;
  delete pane.dataset.populated;
  if (pane.classList.contains('active')) populatePipelineRef();
}

// Open the questions panel (mobile drawer) and switch to Reference tab
function _openReferencePanel() {
  // On mobile the panel needs to be opened
  const panel = document.getElementById('questions-panel');
  const backdrop = document.getElementById('questions-backdrop');
  if (panel && !panel.classList.contains('open')) {
    panel.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
  }
  window.switchQuestionsTab('reference');
}

// Expose for app-hot.js to call after updating messageRelated
window.messageRelated = messageRelated;
window.renderMessages  = renderMessages;

// ---------------------------------------------------------------------------
// Trace mode toggle
// ---------------------------------------------------------------------------

function _syncTraceBtnVisual(enabled) {
  const btn = document.getElementById('trace-toggle-btn');
  if (!btn) return;
  btn.classList.toggle('trace-btn-active', enabled);
  btn.title = enabled ? 'Trace mode ON — click to disable' : 'Trace mode OFF — click to enable';
}

window.toggleTraceMode = function() {
  const next = RAGConfig.get('debug.traceEnabled') !== true;
  RAGConfig.set('debug.traceEnabled', next);
  _syncTraceBtnVisual(next);
  if (typeof showNotification === 'function') {
    showNotification(next ? '🔍 Trace mode ON' : 'Trace mode OFF');
  }
};

// ---------------------------------------------------------------------------
// Pipeline autocomplete strip
// ---------------------------------------------------------------------------
function _pcSets() {
  const knownFields = ['url', 'title', 'type', 'chunkId', 'question'];
  const fields = metaDocs.length
    ? [...new Set(Object.keys(metaDocs[0]).filter(k => k !== '_text' && typeof metaDocs[0][k] === 'string'))]
    : knownFields;

  const ROOT = [
    { label: 'pages',      insert: 'pages',     cursorBack: 0 },
    { label: 'metaDocs',   insert: 'metaDocs',  cursorBack: 0 },
    { label: 'questions',  insert: 'questions', cursorBack: 0 },
    { label: 'topics',     insert: 'topics',    cursorBack: 0 },
    { label: 'llm("")',    insert: 'llm("")',   cursorBack: 2 },
    { label: 'trace("")',  insert: 'trace("")', cursorBack: 2 },
    { label: 'rag',         insert: 'rag',        cursorBack: 0 },
  ];

  // Insert strings have NO leading dot — dot is part of commitPart or added by caller
  const TRANSFORMS = [
    { label: '.rewrite()', insert: 'rewrite()',           cursorBack: 0 },
    { label: '.search()',  insert: 'search("")',         cursorBack: 2 },
    { label: '.filter()',  insert: 'filter("")',          cursorBack: 1 },
    { label: '.unique()',  insert: 'unique("url")',      cursorBack: 5 },
    { label: '.slice()',   insert: 'slice(10)',           cursorBack: 2 },
    { label: '.chunks()',  insert: 'chunks()',            cursorBack: 0 },
    { label: '.count',     insert: 'count',               cursorBack: 0 },
    { label: '.pluck()',   insert: 'pluck("title")',     cursorBack: 8 },
    { label: '.join()',    insert: 'join(", ")',          cursorBack: 4 },
    { label: '.groupBy()', insert: 'groupBy("")',         cursorBack: 1 },
    { label: '.text',       insert: 'text',               cursorBack: 0 },
    { label: '.duplicates',  insert: 'duplicates',         cursorBack: 0 },
    { label: '.trace',       insert: 'trace',              cursorBack: 0 },
    { label: '.groq()',      insert: 'groq()',             cursorBack: 0 },
  ];

  const AFTER_CHUNKS = [
    { label: '.llm()',     insert: 'llm()',              cursorBack: 0 },
    { label: '.llm("…")', insert: 'llm("")',            cursorBack: 2 },
    { label: '.groq()',    insert: 'groq()',             cursorBack: 0 },
    { label: '.count',     insert: 'count',               cursorBack: 0 },
    { label: '.pluck()',   insert: 'pluck("title")',     cursorBack: 8 },
    { label: '.join()',    insert: 'join(", ")',          cursorBack: 4 },
  ];

  // For .filter(): picking a field closes with value placeholder inside second quotes
  const FILTER_FIELDS  = fields.map(f => ({ label: `"${f}"`, insert: `"${f}", "")`, cursorBack: 2 }));
  // For .unique(): picking a field closes the call
  const UNIQUE_FIELDS  = fields.map(f => ({ label: `"${f}"`, insert: `"${f}")`,     cursorBack: 0 }));
  // For .groupBy(): picking a field closes the call
  const GROUPBY_FIELDS = fields.map(f => ({ label: `"${f}"`, insert: `"${f}")`,     cursorBack: 0 }));

  return { ROOT, TRANSFORMS, AFTER_CHUNKS, FILTER_FIELDS, UNIQUE_FIELDS, GROUPBY_FIELDS };
}

function _getPipelineCompletions(expr) {
  const { ROOT, TRANSFORMS, AFTER_CHUNKS, FILTER_FIELDS, UNIQUE_FIELDS, GROUPBY_FIELDS } = _pcSets();
  // Prepend dot to inserts for cases where commitPart doesn't end with dot
  const dot = arr => arr.map(c => ({ ...c, insert: '.' + c.insert }));

  if (!expr) return { completions: ROOT, commitPart: '' };

  // Inside unclosed parenthesis?
  const lastOpen  = expr.lastIndexOf('(');
  const lastClose = expr.lastIndexOf(')');
  if (lastOpen > lastClose) {
    const beforeParen = expr.slice(0, lastOpen + 1);
    const inside      = expr.slice(lastOpen + 1);
    const meth        = beforeParen.match(/\.(\w+)\($/)?.[1];
    if (meth === 'filter' && !inside.includes(',')) {
      const partial = inside.replace(/^"?/, '');
      return {
        completions: FILTER_FIELDS.filter(f => !partial || f.label.slice(1).startsWith(partial)),
        commitPart: beforeParen,
      };
    }
    if (meth === 'unique') {
      const partial = inside.replace(/^"?/, '');
      return {
        completions: UNIQUE_FIELDS.filter(f => !partial || f.label.slice(1).startsWith(partial)),
        commitPart: beforeParen,
      };
    }
    if (meth === 'groupBy') {
      const partial = inside.replace(/^"?/, '');
      return {
        completions: GROUPBY_FIELDS.filter(f => !partial || f.label.slice(1).startsWith(partial)),
        commitPart: beforeParen,
      };
    }
    return { completions: [], commitPart: expr };
  }

  // Ends with a dot
  if (expr.endsWith('.')) {
    const hasChunks = /\.chunks\(\)/.test(expr);
    return { completions: hasChunks ? AFTER_CHUNKS : TRANSFORMS, commitPart: expr };
  }

  // Partial method name after dot: "pages.sea" → base="pages.", partial="sea"
  const partialDot = expr.match(/^(.*\.)([a-zA-Z]*)$/);
  if (partialDot) {
    const [, base, partial] = partialDot;
    const hasChunks = /\.chunks\(\)/.test(base.slice(0, -1));
    const pool = hasChunks ? AFTER_CHUNKS : TRANSFORMS;
    return {
      completions: partial ? pool.filter(c => c.insert.startsWith(partial)) : pool,
      commitPart: base,
    };
  }

  // Ends with ) — after a complete method call
  if (expr.endsWith(')')) {
    const hasChunks = /\.chunks\(\)/.test(expr);
    if (/\.(llm|pluck|join)\([^)]*\)$/.test(expr)) return { completions: [], commitPart: expr };
    return { completions: dot(hasChunks ? AFTER_CHUNKS : TRANSFORMS), commitPart: expr };
  }

  // Ends with a no-arg terminal property
  if (/\.(count|text|duplicates|trace)$/.test(expr)) return { completions: [], commitPart: expr };

  // Exact root name
  if (/^(metaDocs|pages|topics|questions)$/.test(expr)) {
    return { completions: dot(TRANSFORMS), commitPart: expr };
  }
  if (expr === 'rag') {
    // rag supports both call form rag("q") and chain form rag.search(...)
    return {
      completions: [
        { label: 'rag("")',       insert: 'rag("")',       cursorBack: 2 },
        ...dot(TRANSFORMS),
      ],
      commitPart: '',
    };
  }
  if (expr === 'llm') return { completions: [], commitPart: expr };

  // Partial root name
  const roots = ROOT.filter(c => c.insert.startsWith(expr));
  if (roots.length) return { completions: roots, commitPart: '' };

  return { completions: [], commitPart: expr };
}

let _pcState = null;

function _renderPipelineStrip(completions) {
  const strip = document.getElementById('pipeline-strip');
  if (!strip) return;
  if (!completions.length) {
    strip.classList.remove('active');
    strip.innerHTML = '';
    return;
  }
  strip.innerHTML = completions.map((c, i) =>
    `<button class="pc-chip${i === 0 ? ' pc-chip-first' : ''}" data-pc-idx="${i}">${escHtml(c.label)}</button>`
  ).join('');
  strip.classList.add('active');
}

function _hidePipelineStrip() {
  const strip = document.getElementById('pipeline-strip');
  if (strip) { strip.classList.remove('active'); strip.innerHTML = ''; }
  _pcState = null;
}

function _applyPipelineCompletion(comp, commitPart) {
  const input = document.getElementById('input');
  if (!input) return;
  const prefix = (RAGConfig.get('ui.systemCommandPrefix') || '//') + ' ';
  const newValue = prefix + commitPart + comp.insert;
  input.value = newValue;
  const pos = newValue.length - (comp.cursorBack || 0);
  input.setSelectionRange(pos, pos);
  input.focus();
  _onPipelineInput();   // re-evaluate completions for the new state
}

function _onPipelineInput() {
  const input = document.getElementById('input');
  if (!input) return;
  const val = input.value;
  const prefix = RAGConfig.get('ui.systemCommandPrefix') || '//';
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*');
  if (!re.test(val)) { _hidePipelineStrip(); return; }
  const expr   = val.replace(re, '');
  const result = _getPipelineCompletions(expr);
  _pcState = result;
  _renderPipelineStrip(result.completions);
}

// Wire up Send button, Enter key, and message chip clicks
function _initApp() {
  const sendBtn = document.getElementById('send-btn');
  const input   = document.getElementById('input');

  // Event delegation for chips inside messages
  document.getElementById('messages')?.addEventListener('click', e => {
    // Source link click — track in proxy
    const sourceChip = e.target.closest('.msg-source-chip, .msg-pipeline-source-chip');
    if (sourceChip) {
      _sendProxyEvent({ action: 'click', url: sourceChip.href, title: sourceChip.textContent });
    }

    // Pipeline command chip in terminal card — fill input, don't submit
    const cmdChip = e.target.closest('.msg-pipeline-cmd-chip');
    if (cmdChip) {
      input.value = cmdChip.dataset.cmd;
      input.focus();
      return;
    }
    // User message bubble — click to copy back into input for editing
    const userBubble = e.target.closest('[data-user-msg]');
    if (userBubble && !_abortController) {
      input.value = userBubble.dataset.userMsg;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      _onPipelineInput();
      return;
    }
    const chip = e.target.closest('[data-question]');
    if (chip && !_abortController) {
      _sendProxyEvent({ action: 'click', url: '', title: chip.dataset.question, type: 'question' });
      input.value = chip.dataset.question;
      ask();
    }
  });

  // Event delegation for reference panel command chips — fill input, don't submit
  document.getElementById('pipeline-ref-pane')?.addEventListener('click', e => {
    const chip = e.target.closest('.ref-cmd-chip');
    if (chip) {
      input.value = chip.dataset.cmd;
      input.focus();
      _onPipelineInput();
    }
  });

  // Pipeline autocomplete strip — mousedown keeps focus, tap works on mobile
  document.getElementById('pipeline-strip')?.addEventListener('mousedown', e => {
    const chip = e.target.closest('.pc-chip');
    if (!chip || !_pcState) return;
    e.preventDefault(); // keep input focused / keyboard visible
    const comp = _pcState.completions[parseInt(chip.dataset.pcIdx)];
    if (comp) _applyPipelineCompletion(comp, _pcState.commitPart);
  });

  if (sendBtn) {
    sendBtn.onclick = window.ask;
  }

  _syncTraceBtnVisual(RAGConfig.get('debug.traceEnabled') === true);

  if (input) {
    input.addEventListener('input', _onPipelineInput);

    input.addEventListener('keydown', function(e) {
      // Tab accepts first completion
      if (e.key === 'Tab' && _pcState?.completions?.length) {
        e.preventDefault();
        _applyPipelineCompletion(_pcState.completions[0], _pcState.commitPart);
        return;
      }
      // Escape dismisses strip
      if (e.key === 'Escape' && _pcState) {
        _hidePipelineStrip();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        _hidePipelineStrip();
        if (!_abortController) ask();
      }
    });
  }

  // Apply simple/advanced UI mode
  applyUIMode();

  // Build model dropdown from config
  buildModelDropdown();

  // Set memory-appropriate default model before loading index
  setDefaultModel();

  // Restore previous chat on load
  if (messages.length) {
    renderMessages();
  }

  loadIndex();
}
// Dynamic script loading may miss DOMContentLoaded — handle both cases
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initApp);
} else {
  _initApp();
}
