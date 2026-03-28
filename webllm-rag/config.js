/**
 * config.js — wllmrag configuration module
 * Must be loaded before app.js and settings-panel.js
 * Exposes window.RAGConfig as the global config object
 */

'use strict';

// ---------------------------------------------------------------------------
// Storage helpers (duplicated here so config.js is self-contained)
// ---------------------------------------------------------------------------
function _storageGet(key) {
  try { return localStorage.getItem(key); } catch(e) { return null; }
}
function _storageSet(key, val) {
  try { localStorage.setItem(key, val); } catch(e) {} 
}
function _storageRemove(key) {
  try { localStorage.removeItem(key); } catch(e) {}
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
const KEYS = {
  settings:      'wllmrag_settings',
  models:        'wllmrag_models',
  selectedModel: 'wllmrag_selected_model',
  chatMessages:  'wllmrag_chat_messages',
  // Legacy keys (pre-prefix)
  legacyChat:    'chat_messages',
  legacyModel:   'user_selected_model',
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  llm: {
    systemPrompt:      'You are a helpful real estate assistant. Answer using ONLY the passages below. Cite as [1][2][3]. Be thorough but concise.',
    temperature:       0.4,
    repetitionPenalty: 1.3,
    maxTokens:         400,
    historyExchanges:  1,
  },
  retrieval: {
    ragEnabled:             true,
    passageCharLimit:       200,
    contactBoost:           0.15,
    candidatesMultiplier:   3,
    footnoteSnippetLength:  120,
  },
  ui: {
    systemCommandPrefix: '//',
    welcomeMessage:      '👋 Welcome! This site has **{{pages.count}} pages** covering {{topics.slice(6).join(", ")}}.\n\nAsk me anything about it.',
  },
  questions: {
    exploreCount: 20,
    relatedCount: 5,
  },
};

const DEFAULT_MODELS = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',           label: 'Qwen 2.5 1.5B (WebGPU)',       backend: 'webgpu', minMemoryGB: 4, url: '' },
  { id: 'gemma-2-2b-it-q4f32_1-MLC',                    label: 'Gemma 2 2B (WebGPU)',           backend: 'webgpu', minMemoryGB: 6, url: '' },
  { id: 'Phi-3.5-mini-instruct-q4f32_1-MLC',            label: 'Phi-3.5 Mini 3.8B (WebGPU)',   backend: 'webgpu', minMemoryGB: 8, url: '' },
  { id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',            label: 'Llama 3.2 1B (WebGPU)',        backend: 'webgpu', minMemoryGB: 2, url: '' },
  { id: 'onnx-community/Phi-3.5-mini-instruct-onnx-web', label: 'Phi-3.5 Mini (WebGPU/ONNX)',  backend: 'webgpu', minMemoryGB: 4, url: '' },
  { id: 'onnx-community/Qwen2.5-0.5B-Instruct',          label: 'Qwen2.5 0.5B (WebNN/NPU)',    backend: 'webnn',  minMemoryGB: 2, url: '' },
  { id: 'HuggingFaceTB/SmolLM2-360M-Instruct',           label: 'SmolLM2 360M (WebNN)',        backend: 'webnn',  minMemoryGB: 2, url: '' },
  { id: 'HuggingFaceTB/SmolLM2-135M-Instruct',           label: 'SmolLM2 135M (CPU)',          backend: 'cpu',    minMemoryGB: 1, url: '' },
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function deepMerge(defaults, overrides) {
  const result = JSON.parse(JSON.stringify(defaults)); // deep clone defaults
  if (!overrides || typeof overrides !== 'object') return result;
  for (const key of Object.keys(overrides)) {
    if (
      key in result &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key]) &&
      typeof overrides[key] === 'object' &&
      !Array.isArray(overrides[key])
    ) {
      result[key] = deepMerge(result[key], overrides[key]);
    } else {
      result[key] = overrides[key];
    }
  }
  return result;
}

function getByPath(obj, path) {
  return path.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

function setByPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] = o[k] || {}), obj);
  target[last] = value;
}

function validateModel(m) {
  if (!m || typeof m !== 'object') return false;
  if (!m.id || typeof m.id !== 'string' || !m.id.trim()) return false;
  if (!m.label || typeof m.label !== 'string' || !m.label.trim()) return false;
  if (!['webgpu', 'webnn', 'cpu'].includes(m.backend)) return false;
  if (typeof m.minMemoryGB !== 'number' || m.minMemoryGB < 0) return false;
  return true;
}

function normaliseModel(m) {
  return {
    id:          String(m.id).trim(),
    label:       String(m.label || m.id).trim(),
    backend:     m.backend || 'webgpu',
    minMemoryGB: Number(m.minMemoryGB) || 2,
    url:         String(m.url || '').trim(),
  };
}

// ---------------------------------------------------------------------------
// Migration — move old localStorage keys to new prefixed keys
// ---------------------------------------------------------------------------
function migrateOldKeys() {
  // chat_messages → wllmrag_chat_messages
  const oldChat = _storageGet(KEYS.legacyChat);
  if (oldChat && !_storageGet(KEYS.chatMessages)) {
    _storageSet(KEYS.chatMessages, oldChat);
    _storageRemove(KEYS.legacyChat);
    console.log('🔄 Migrated chat_messages → wllmrag_chat_messages');
  }
  // user_selected_model → wllmrag_selected_model
  const oldModel = _storageGet(KEYS.legacyModel);
  if (oldModel && !_storageGet(KEYS.selectedModel)) {
    _storageSet(KEYS.selectedModel, oldModel);
    _storageRemove(KEYS.legacyModel);
    console.log('🔄 Migrated user_selected_model → wllmrag_selected_model');
  }
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------
function _doLoadSettings() {
  try {
    const raw = _storageGet(KEYS.settings);
    const saved = raw ? JSON.parse(raw) : {};
    return deepMerge(DEFAULT_SETTINGS, saved);
  } catch(e) {
    console.warn('⚠️ Failed to load settings, using defaults:', e.message);
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }
}

function _doSaveSettings(settings) {
  _storageSet(KEYS.settings, JSON.stringify(settings));
}

function _doLoadModels() {
  try {
    const raw = _storageGet(KEYS.models);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_MODELS));
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return JSON.parse(JSON.stringify(DEFAULT_MODELS));
    const valid = parsed.filter(validateModel).map(normaliseModel);
    return valid.length ? valid : JSON.parse(JSON.stringify(DEFAULT_MODELS));
  } catch(e) {
    console.warn('⚠️ Failed to load models, using defaults:', e.message);
    return JSON.parse(JSON.stringify(DEFAULT_MODELS));
  }
}

function _doSaveModels(models) {
  _storageSet(KEYS.models, JSON.stringify(models));
}

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------
function _doExportSettings(settings, models) {
  const payload = {
    exported:   new Date().toISOString(),
    appVersion: '1.0',
    settings,
    models,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href     = url;
  a.download = `wllmrag-settings-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function _doImportSettings(jsonString) {
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch(e) {
    return { ok: false, error: 'Invalid JSON: ' + e.message };
  }

  if (!parsed.settings || typeof parsed.settings !== 'object') {
    return { ok: false, error: 'Missing "settings" key in imported file' };
  }
  if (!parsed.settings.llm || !parsed.settings.retrieval || !parsed.settings.ui) {
    return { ok: false, error: 'Settings must have llm, retrieval, and ui sections' };
  }

  const newSettings = deepMerge(DEFAULT_SETTINGS, parsed.settings);

  let newModels = null;
  let modelsImported = 0;
  if (Array.isArray(parsed.models)) {
    const valid = parsed.models.filter(validateModel).map(normaliseModel);
    if (valid.length > 0) {
      newModels = valid;
      modelsImported = valid.length;
    }
  }

  // Build diff summary
  const diffs = [];
  for (const section of ['llm', 'retrieval', 'ui']) {
    for (const [k, v] of Object.entries(newSettings[section])) {
      const cur = getByPath(DEFAULT_SETTINGS, `${section}.${k}`);
      if (JSON.stringify(cur) !== JSON.stringify(v)) {
        diffs.push(`${section}.${k}: ${JSON.stringify(cur)} → ${JSON.stringify(v)}`);
      }
    }
  }

  return {
    ok: true,
    settings:        newSettings,
    models:          newModels,
    modelsImported,
    diffCount:       diffs.length,
    diffSummary:     diffs.slice(0, 10).join('\n') + (diffs.length > 10 ? `\n…+${diffs.length - 10} more` : ''),
  };
}

function _doResetToDefaults() {
  _storageRemove(KEYS.settings);
  _storageRemove(KEYS.models);
  _storageRemove(KEYS.selectedModel);
  // Keep chat history — user probably wants to keep it
}

// ---------------------------------------------------------------------------
// RAGConfig — the global config object
// ---------------------------------------------------------------------------
migrateOldKeys();

const _state = {
  settings: _doLoadSettings(),
  models:   _doLoadModels(),
};

const APP_VERSION = 'v1.5';

window.RAGConfig = {
  version: APP_VERSION,

  // Read a dot-path value, e.g. RAGConfig.get('llm.temperature')
  get(path) {
    return getByPath(_state.settings, path);
  },

  // Write a dot-path value and persist
  set(path, value) {
    setByPath(_state.settings, path, value);
    _doSaveSettings(_state.settings);
  },

  // Get the full settings object (read-only copy)
  getSettings() {
    return JSON.parse(JSON.stringify(_state.settings));
  },

  // Replace entire settings object and persist
  applySettings(settings) {
    _state.settings = deepMerge(DEFAULT_SETTINGS, settings);
    _doSaveSettings(_state.settings);
  },

  // Get model list
  get models() {
    return _state.models;
  },

  // Replace model list and persist
  applyModels(models) {
    _state.models = models.filter(validateModel).map(normaliseModel);
    _doSaveModels(_state.models);
  },

  // Export to file
  export() {
    _doExportSettings(_state.settings, _state.models);
  },

  // Import from JSON string — returns { ok, error?, settings?, models?, diffSummary?, diffCount?, modelsImported? }
  import(jsonString) {
    return _doImportSettings(jsonString);
  },

  // Apply imported result (call after user confirms)
  applyImport(result) {
    if (!result.ok) return;
    _state.settings = result.settings;
    _doSaveSettings(_state.settings);
    if (result.models) {
      _state.models = result.models;
      _doSaveModels(_state.models);
    }
  },

  // Reset to factory defaults (does NOT clear chat history)
  reset() {
    _doResetToDefaults();
    _state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    _state.models   = JSON.parse(JSON.stringify(DEFAULT_MODELS));
  },

  // Storage key constants — used by app.js
  KEYS,

  // Defaults — used by settings panel to show reset values
  DEFAULT_SETTINGS,
  DEFAULT_MODELS,
};

console.log('✅ RAGConfig loaded', {
  version: APP_VERSION,
  settingsKeys: Object.keys(_state.settings),
  modelCount: _state.models.length,
});

// Stamp version into the header as soon as the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('app-version');
  if (el) el.textContent = APP_VERSION;
});
