// app-hot.js — question panel logic.
// Wrapped in an IIFE so re-executing this file (cache-busted script injection)
// only reassigns window properties; no let/const re-declaration conflicts with app.js.
(function () {

  function selectDiverse(candidates, k) {
    if (!embMatrix || candidates.length <= k) return candidates.slice(0, k);
    const dot = (aIdx, bIdx) => {
      const a = embMatrix.subarray(aIdx * DIMS, (aIdx + 1) * DIMS);
      const b = embMatrix.subarray(bIdx * DIMS, (bIdx + 1) * DIMS);
      let s = 0;
      for (let i = 0; i < DIMS; i++) s += a[i] * b[i];
      return s;
    };
    const selected = [0];
    const minDist  = new Float32Array(candidates.length).fill(Infinity);
    minDist[0] = -1;
    for (let i = 1; i < candidates.length; i++) {
      minDist[i] = 1 - dot(candidates[0].id, candidates[i].id);
    }
    while (selected.length < k) {
      let bestI = -1, bestD = -1;
      for (let i = 0; i < candidates.length; i++) {
        if (minDist[i] > bestD) { bestD = minDist[i]; bestI = i; }
      }
      selected.push(bestI);
      minDist[bestI] = -1;
      for (let i = 0; i < candidates.length; i++) {
        if (minDist[i] < 0) continue;
        const d = 1 - dot(candidates[bestI].id, candidates[i].id);
        if (d < minDist[i]) minDist[i] = d;
      }
    }
    return selected.map(i => candidates[i]);
  }

  function renderQuestions(items) {
    const list = document.getElementById('questions-list');
    if (!list) return;
    list.innerHTML = '';
    const contextual = items.filter(d => d.kind === 'contextual');
    const explore    = items.filter(d => d.kind !== 'contextual');
    const bothGroups = contextual.length > 0 && explore.length > 0;
    const appendGroup = (group, label, cls) => {
      if (!group.length) return;
      if (bothGroups) {
        const hdr = document.createElement('div');
        hdr.className = 'questions-group-hdr';
        hdr.textContent = label;
        list.appendChild(hdr);
      }
      for (const item of group) {
        const btn = document.createElement('button');
        btn.className = `question-item ${cls}`;
        btn.textContent = item.question;
        btn.addEventListener('click', () => {
          const input = document.getElementById('input');
          if (!input) return;
          input.value = item.question;
          document.getElementById('questions-panel')?.classList.remove('open');
          document.getElementById('questions-backdrop')?.classList.remove('open');
          ask();
        });
        list.appendChild(btn);
      }
    };
    appendGroup(contextual, '↩ Related', 'q-contextual');
    appendGroup(explore,    '✦ Explore', 'q-explore');
  }

  function loadInitialQuestions() {
    const withQ = metaDocs.filter(d => d.question);
    if (!withQ.length) return;
    const seenChunk = new Set();
    const candidates = [];
    for (const doc of withQ) {
      if (!seenChunk.has(doc.chunkId)) {
        seenChunk.add(doc.chunkId);
        candidates.push(doc);
      }
    }
    const k = RAGConfig.get('questions.exploreCount') ?? 20;
    renderQuestions(selectDiverse(candidates, k).map(d => ({ ...d, kind: 'explore' })));
  }

  // msgIdx — index of the assistant message in the messages array.
  // Related questions are stored in window.messageRelated and rendered inline;
  // Explore questions go to the right panel only.
  async function updateQuestionsFromChat(lastAnswer, msgIdx) {
    if (!metaDocs.some(d => d.question)) return;
    const relatedCount  = RAGConfig.get('questions.relatedCount')  ?? 5;
    const exploreCount  = RAGConfig.get('questions.exploreCount')  ?? 20;

    // --- Related: top semantic matches for the answer ---
    const results = await search(lastAnswer, relatedCount * 6);
    const seenChunk = new Set();
    const contextualCandidates = [];
    for (const doc of results) {
      if (doc.question && !seenChunk.has(doc.chunkId)) {
        seenChunk.add(doc.chunkId);
        contextualCandidates.push(doc);
      }
    }
    const related = selectDiverse(contextualCandidates, relatedCount);

    // Store in window.messageRelated and re-render messages to show chips
    if (related.length && window.messageRelated && msgIdx >= 0) {
      window.messageRelated.set(msgIdx, related.map(d => d.question));
      if (window.renderMessages) window.renderMessages();
    }

    // --- Explore: diverse picks from full index, excluding related chunks ---
    const relatedChunks = new Set(related.map(d => d.chunkId));
    const withQ = metaDocs.filter(d => d.question);
    const seenExplore = new Set();
    const exploreCandidates = [];
    for (const doc of withQ) {
      if (!seenExplore.has(doc.chunkId) && !relatedChunks.has(doc.chunkId)) {
        seenExplore.add(doc.chunkId);
        exploreCandidates.push(doc);
      }
    }
    const explore = selectDiverse(exploreCandidates, exploreCount)
      .map(d => ({ ...d, kind: 'explore' }));
    if (explore.length) renderQuestions(explore);
  }

  // Expose on window so app.js call-sites and the hot-reload always get the live version
  window.renderQuestions         = renderQuestions;
  window.loadInitialQuestions    = loadInitialQuestions;
  window.updateQuestionsFromChat = updateQuestionsFromChat;
  window.selectDiverse           = selectDiverse;
  window.toggleQuestionsDrawer   = function () {
    document.getElementById('questions-panel')?.classList.toggle('open');
    document.getElementById('questions-backdrop')?.classList.toggle('open');
  };

})();
