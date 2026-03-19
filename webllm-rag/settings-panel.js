/**
 * settings-panel.js — Settings panel UI
 * Depends on: config.js (RAGConfig), app.js (buildModelDropdown, setDefaultModel)
 */

'use strict';

// ---------------------------------------------------------------------------
// Panel open / close
// ---------------------------------------------------------------------------
function openSettingsPanel() {
  populatePanel();
  document.getElementById('settings-panel').classList.add('open');
  document.getElementById('settings-backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSettingsPanel() {
  document.getElementById('settings-panel').classList.remove('open');
  document.getElementById('settings-backdrop').classList.remove('open');
  document.body.style.overflow = '';
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------
function switchTab(tabId) {
  document.querySelectorAll('.sp-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });
  document.querySelectorAll('.sp-tab-pane').forEach(p => {
    p.classList.toggle('hidden', p.dataset.pane !== tabId);
  });
}

// ---------------------------------------------------------------------------
// Populate panel from current RAGConfig
// ---------------------------------------------------------------------------
function populatePanel() {
  const s = RAGConfig.getSettings();

  // Prompt tab
  _val('sp-system-prompt',  s.llm.systemPrompt);
  _val('sp-sys-cmd-prefix', s.ui.systemCommandPrefix);
  _val('sp-welcome-msg',    s.ui.welcomeMessage);

  // Inference tab
  _slider('sp-temperature',        s.llm.temperature);
  _slider('sp-repetition-penalty', s.llm.repetitionPenalty);
  _slider('sp-max-tokens',         s.llm.maxTokens);
  _slider('sp-history-exchanges',  s.llm.historyExchanges);

  // Retrieval tab
  const ragEnabledEl = document.getElementById('sp-rag-enabled');
  if (ragEnabledEl) {
    ragEnabledEl.checked = s.retrieval.ragEnabled !== false;
    // Sync visual state
    const ragTrack = document.getElementById('sp-rag-toggle-track');
    const ragThumb = document.getElementById('sp-rag-toggle-thumb');
    if (ragTrack) ragTrack.style.background = ragEnabledEl.checked ? '#3b82f6' : '#d1d5db';
    if (ragThumb) ragThumb.style.transform = ragEnabledEl.checked ? 'translateX(18px)' : 'translateX(0)';
  }
  _slider('sp-passage-char-limit',      s.retrieval.passageCharLimit);
  _slider('sp-contact-boost',           s.retrieval.contactBoost);
  _slider('sp-candidates-multiplier',   s.retrieval.candidatesMultiplier);
  _slider('sp-footnote-snippet-length', s.retrieval.footnoteSnippetLength);

  // Models tab
  renderModelCards();

  // Switch to first tab
  switchTab('prompt');
}

function _val(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? '';
}

function _slider(id, value) {
  const slider = document.getElementById(id);
  const display = document.getElementById(id + '-val');
  if (slider) slider.value = value;
  if (display) display.textContent = value;
}

// ---------------------------------------------------------------------------
// Slider live update
// ---------------------------------------------------------------------------
function initSliders() {
  document.querySelectorAll('.sp-slider').forEach(slider => {
    const display = document.getElementById(slider.id + '-val');
    slider.addEventListener('input', () => {
      if (display) display.textContent = slider.value;
    });
  });

  // RAG toggle visual wiring
  const ragCheckbox = document.getElementById('sp-rag-enabled');
  const ragTrack = document.getElementById('sp-rag-toggle-track');
  const ragThumb = document.getElementById('sp-rag-toggle-thumb');
  function updateRagToggleVisual() {
    if (!ragCheckbox || !ragTrack || !ragThumb) return;
    if (ragCheckbox.checked) {
      ragTrack.style.background = '#3b82f6';
      ragThumb.style.transform = 'translateX(18px)';
    } else {
      ragTrack.style.background = '#d1d5db';
      ragThumb.style.transform = 'translateX(0)';
    }
  }
  if (ragCheckbox) {
    ragCheckbox.addEventListener('change', updateRagToggleVisual);
    // Make the whole toggle area clickable
    const toggleArea = ragCheckbox.closest('label');
    if (toggleArea) toggleArea.style.cursor = 'pointer';
  }
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------
function saveSettings() {
  const current = RAGConfig.getSettings();

  // Prompt
  current.llm.systemPrompt         = document.getElementById('sp-system-prompt').value.trim();
  current.ui.systemCommandPrefix    = document.getElementById('sp-sys-cmd-prefix').value.trim() || '%SYSTEM%';
  current.ui.welcomeMessage         = document.getElementById('sp-welcome-msg').value.trim();

  // Inference
  current.llm.temperature           = parseFloat(document.getElementById('sp-temperature').value);
  current.llm.repetitionPenalty     = parseFloat(document.getElementById('sp-repetition-penalty').value);
  current.llm.maxTokens             = parseInt(document.getElementById('sp-max-tokens').value);
  current.llm.historyExchanges      = parseInt(document.getElementById('sp-history-exchanges').value);

  // Retrieval
  const ragEnabledEl = document.getElementById('sp-rag-enabled');
  current.retrieval.ragEnabled            = ragEnabledEl ? ragEnabledEl.checked : true;
  current.retrieval.passageCharLimit      = parseInt(document.getElementById('sp-passage-char-limit').value);
  current.retrieval.contactBoost          = parseFloat(document.getElementById('sp-contact-boost').value);
  current.retrieval.candidatesMultiplier  = parseInt(document.getElementById('sp-candidates-multiplier').value);
  current.retrieval.footnoteSnippetLength = parseInt(document.getElementById('sp-footnote-snippet-length').value);

  RAGConfig.applySettings(current);

  // Models — collect from cards
  const cards = document.querySelectorAll('.sp-model-card');
  const models = [];
  cards.forEach(card => {
    models.push({
      id:          card.querySelector('.sp-model-id').value.trim(),
      label:       card.querySelector('.sp-model-label').value.trim(),
      backend:     card.querySelector('.sp-model-backend').value,
      minMemoryGB: parseFloat(card.querySelector('.sp-model-minmem').value),
      url:         card.querySelector('.sp-model-url').value.trim(),
    });
  });
  const validModels = models.filter(m => m.id && m.label);
  if (validModels.length) {
    RAGConfig.applyModels(validModels);
    // Rebuild dropdown in app
    if (typeof buildModelDropdown === 'function') {
      buildModelDropdown();
      setDefaultModel();
    }
  }

  showNotification('✅ Settings saved');
  closeSettingsPanel();
}

// ---------------------------------------------------------------------------
// Reset to defaults
// ---------------------------------------------------------------------------
function resetToDefaults() {
  if (!confirm('Reset ALL settings to factory defaults?\n\nChat history will be kept. Page will reload.')) return;
  RAGConfig.reset();
  location.reload();
}

// ---------------------------------------------------------------------------
// Model cards
// ---------------------------------------------------------------------------
function renderModelCards() {
  const container = document.getElementById('sp-model-cards');
  if (!container) return;
  container.innerHTML = '';
  RAGConfig.models.forEach((m, i) => {
    container.appendChild(createModelCard(m, i));
  });
}

function createModelCard(model, index) {
  const div = document.createElement('div');
  div.className = 'sp-model-card';
  div.innerHTML = `
    <div class="sp-model-card-inner">
      <div class="sp-row">
        <div class="sp-field sp-field-grow">
          <label>Label</label>
          <input class="sp-input sp-model-label" value="${_esc(model.label)}" placeholder="Display name">
        </div>
        <div class="sp-field sp-field-shrink">
          <label>Backend</label>
          <select class="sp-input sp-model-backend">
            <option value="webgpu" ${model.backend==='webgpu'?'selected':''}>WebGPU</option>
            <option value="webnn"  ${model.backend==='webnn' ?'selected':''}>WebNN</option>
            <option value="cpu"    ${model.backend==='cpu'   ?'selected':''}>CPU</option>
          </select>
        </div>
        <div class="sp-field sp-field-shrink">
          <label>Min RAM</label>
          <select class="sp-input sp-model-minmem">
            ${[1,2,4,6,8,16].map(n => `<option value="${n}" ${model.minMemoryGB===n?'selected':''}>${n}GB</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="sp-row">
        <div class="sp-field sp-field-grow">
          <label>Model ID</label>
          <input class="sp-input sp-model-id" value="${_esc(model.id)}" placeholder="Model ID or HuggingFace repo path">
        </div>
      </div>
      <div class="sp-row">
        <div class="sp-field sp-field-grow">
          <label>URL override <span class="sp-hint">(leave empty for default CDN)</span></label>
          <input class="sp-input sp-model-url" value="${_esc(model.url||'')}" placeholder="https://... or leave empty">
        </div>
        <div class="sp-field sp-field-shrink sp-field-action">
          <button class="sp-btn-danger" onclick="removeModelCard(this)">🗑</button>
        </div>
      </div>
    </div>
  `;
  return div;
}

function removeModelCard(btn) {
  const cards = document.querySelectorAll('.sp-model-card');
  if (cards.length <= 1) {
    showNotification('⚠️ Cannot remove last model', 'warn');
    return;
  }
  btn.closest('.sp-model-card').remove();
}

function addModelCard() {
  const container = document.getElementById('sp-model-cards');
  const blank = { id: '', label: 'New Model', backend: 'webgpu', minMemoryGB: 4, url: '' };
  container.appendChild(createModelCard(blank, container.children.length));
  container.lastElementChild.querySelector('.sp-model-label').focus();
}

function uploadModelsJson() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('File must be a JSON array of model objects');
      const valid = parsed.filter(m => m.id && m.label);
      if (!valid.length) throw new Error('No valid model entries found');
      // Re-render cards with uploaded models
      const container = document.getElementById('sp-model-cards');
      container.innerHTML = '';
      valid.forEach((m, i) => container.appendChild(createModelCard(m, i)));
      showNotification(`✅ Loaded ${valid.length} models from file`);
    } catch(e) {
      showNotification('❌ ' + e.message, 'error');
    }
  };
  input.click();
}

// ---------------------------------------------------------------------------
// Import / Export
// ---------------------------------------------------------------------------
function exportSettings() {
  RAGConfig.export();
}

let _pendingImport = null;

function uploadSettingsJson() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = RAGConfig.import(text);
      if (!result.ok) {
        showNotification('❌ ' + result.error, 'error');
        return;
      }
      _pendingImport = result;
      // Show diff summary
      const diffEl = document.getElementById('sp-import-diff');
      const applyBtn = document.getElementById('sp-import-apply');
      if (diffEl) {
        diffEl.innerHTML = `
          <div class="sp-diff-summary">
            <strong>${result.diffCount} setting${result.diffCount !== 1 ? 's' : ''} changed</strong>
            ${result.modelsImported ? `, <strong>${result.modelsImported} models</strong> imported` : ''}
            ${result.diffCount > 0 ? `<pre class="sp-diff-pre">${_esc(result.diffSummary)}</pre>` : ''}
          </div>`;
        diffEl.classList.remove('hidden');
      }
      if (applyBtn) applyBtn.classList.remove('hidden');
    } catch(e) {
      showNotification('❌ ' + e.message, 'error');
    }
  };
  input.click();
}

function applyImport() {
  if (!_pendingImport) return;
  RAGConfig.applyImport(_pendingImport);
  _pendingImport = null;
  if (typeof buildModelDropdown === 'function') {
    buildModelDropdown();
    setDefaultModel();
  }
  showNotification('✅ Settings imported — reload to apply all changes');
  document.getElementById('sp-import-diff')?.classList.add('hidden');
  document.getElementById('sp-import-apply')?.classList.add('hidden');
  closeSettingsPanel();
}

// ---------------------------------------------------------------------------
// Notification toast
// ---------------------------------------------------------------------------
function showNotification(msg, type = 'success') {
  let toast = document.getElementById('sp-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sp-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = `sp-toast sp-toast-${type} show`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ---------------------------------------------------------------------------
// Escape HTML
// ---------------------------------------------------------------------------
function _esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---------------------------------------------------------------------------
// Init — wire up events after DOM ready
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Gear button
  const gearBtn = document.getElementById('settings-gear-btn');
  if (gearBtn) gearBtn.addEventListener('click', openSettingsPanel);

  // Backdrop
  const backdrop = document.getElementById('settings-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeSettingsPanel);

  // Close button
  const closeBtn = document.getElementById('sp-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeSettingsPanel);

  // Tab buttons
  document.querySelectorAll('.sp-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Save / Reset
  document.getElementById('sp-save-btn')?.addEventListener('click', saveSettings);
  document.getElementById('sp-reset-btn')?.addEventListener('click', resetToDefaults);

  // Models tab buttons
  document.getElementById('sp-add-model-btn')?.addEventListener('click', addModelCard);
  document.getElementById('sp-upload-models-btn')?.addEventListener('click', uploadModelsJson);

  // Import/Export tab buttons
  document.getElementById('sp-export-btn')?.addEventListener('click', exportSettings);
  document.getElementById('sp-import-btn')?.addEventListener('click', uploadSettingsJson);
  document.getElementById('sp-import-apply')?.addEventListener('click', applyImport);
  document.getElementById('sp-reset-defaults-btn')?.addEventListener('click', resetToDefaults);

  // Init sliders
  initSliders();
});
