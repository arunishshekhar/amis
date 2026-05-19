const views = new Set(['triage', 'history', 'insights', 'settings']);
const initialView = views.has(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'triage';
const state = { data: null, view: initialView, busy: false };
const $ = (selector) => document.querySelector(selector);
const view = $('#view');
const toast = $('#toast');

function text(value, fallback = '') {
  return value == null || value === '' ? fallback : String(value);
}

function date(value) {
  if (!value) return 'unknown';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function showToast(message) {
  toast.textContent = message;
  toast.style.display = 'block';
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { toast.style.display = 'none'; }, 4000);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

async function load() {
  if (state.busy) return;
  state.busy = true;
  $('#status').textContent = 'Refreshing...';
  try {
    state.data = await api('/api/dashboard');
    $('#status').textContent = `Updated ${date(Date.now())}`;
    render();
  } catch (error) {
    $('#status').textContent = 'Unable to load dashboard';
    showToast(error.message);
  } finally {
    state.busy = false;
  }
}

async function act(type, id) {
  try {
    await api('/api/action', { method: 'POST', body: JSON.stringify({ type, id }) });
    showToast(`${type} complete`);
    await load();
  } catch (error) {
    showToast(error.message);
  }
}

function setView(next, options = {}) {
  if (!views.has(next)) return;
  state.view = next;
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.view === next));
  });
  if (!options.skipHash && window.location.hash.slice(1) !== next) {
    window.location.hash = next;
  }
  render();
}

function updateMetrics(data) {
  $('#community').textContent = data.subredditName ? `r/${data.subredditName}` : 'Subreddit context unavailable';
  $('#metric-review').textContent = data.recs.length;
  $('#metric-approved').textContent = data.aiApprovedCount || 0;
  $('#metric-history').textContent = data.history.length;
  $('#metric-insights').textContent = data.insights.filter((i) => !i.acknowledged).length;
}

function pill(label, kind = '') {
  return `<span class="pill ${kind}">${label}</span>`;
}

function itemCard(rec, item, mode) {
  const title = text(item && item.title, text(item && item.body, rec.itemId));
  const body = text(item && item.body, 'No body captured.');
  const reports = item && item.reportReasons && item.reportReasons.length
    ? item.reportReasons.join(', ')
    : 'no reports';
  const duplicate = rec.isDuplicate ? pill(`duplicate ${Math.round((rec.duplicateSimilarity || 0) * 100)}%`, 'medium') : '';
  const actions = mode === 'triage' ? `
    <div class="actions">
      <button class="danger" type="button" data-action="remove" data-id="${rec.itemId}">Remove</button>
      <button type="button" data-action="approve" data-id="${rec.itemId}">Approve</button>
      <button type="button" data-action="escalate" data-id="${rec.itemId}">Escalate</button>
    </div>` : '';
  return `
    <article class="card">
      <div class="card-head">
        <div>
          <h3 class="title">${escapeHtml(title)}</h3>
          <div class="meta">
            ${pill(rec.riskLevel, rec.riskLevel)}
            ${pill(rec.suggestedAction, rec.suggestedAction)}
            ${duplicate}
            <span>${rec.confidenceScore}% confidence</span>
            <span>${date(rec.generatedAt)}</span>
          </div>
        </div>
        <div class="subtle">${escapeHtml(text(item && item.author, 'unknown'))}</div>
      </div>
      <p class="body">${escapeHtml(body)}</p>
      <p class="subtle">${escapeHtml(text(rec.rationale, 'No rationale.'))}</p>
      <p class="subtle">Policy: ${escapeHtml(text(rec.matchedPolicyTitle, 'none'))} | Reports: ${escapeHtml(reports)}</p>
      ${rec.actionTaken ? `<p class="subtle">Action: ${escapeHtml(rec.actionTaken)} by ${escapeHtml(text(rec.actionedBy, 'unknown'))} at ${date(rec.actionedAt)}</p>` : ''}
      ${actions}
    </article>`;
}

function renderTriage(data) {
  if (!data.recs.length) {
    return '<div class="empty">No recommendations need moderator review.</div>';
  }
  return `<div class="list">${data.recs.map((rec) => itemCard(rec, data.modItems[rec.itemId], 'triage')).join('')}</div>`;
}

function renderHistory(data) {
  if (!data.history.length) return '<div class="empty">No AMIS moderation history yet.</div>';
  return `<div class="list">${data.history.map((rec) => itemCard(rec, data.allModItems[rec.itemId], 'history')).join('')}</div>`;
}

function renderInsights(data) {
  const insights = [...data.insights].sort((a, b) => {
    if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1;
    return b.detectedAt - a.detectedAt;
  });
  if (!insights.length) return '<div class="empty">No consistency insights found.</div>';
  return `<div class="list">${insights.map((insight) => `
    <article class="card">
      <div class="card-head">
        <div>
          <h3 class="title">${escapeHtml(insight.policyTitle || insight.type)}</h3>
          <div class="meta">
            ${pill(insight.type)}
            ${insight.acknowledged ? pill('acknowledged', 'low') : pill('open', 'medium')}
            <span>${date(insight.detectedAt)}</span>
          </div>
        </div>
        ${insight.acknowledged ? '' : `<button type="button" data-action="acknowledge" data-id="${insight.id}">Acknowledge</button>`}
      </div>
      <p class="body">${escapeHtml(insight.description)}</p>
      <p class="subtle">${escapeHtml(formatStats(insight.stats || {}))}</p>
    </article>`).join('')}</div>`;
}

function renderSettings(data) {
  const cfg = data.aiConfig || {};
  const apiKeyConfigured = Boolean(cfg.apiKeyConfigured);
  const voyageApiKeyConfigured = Boolean(cfg.voyageApiKeyConfigured);
  const currentProvider = ['openai', 'gemini', 'claude'].includes(cfg.provider || data.aiProvider)
    ? (cfg.provider || data.aiProvider)
    : 'openai';
  return `
    <h2>AI Configuration</h2>
    <form id="settings-form" class="form-grid">
      <label>Provider
        <select name="provider">
          ${['openai', 'gemini', 'claude'].map((provider) => `<option value="${provider}" ${provider === currentProvider ? 'selected' : ''}>${provider}</option>`).join('')}
        </select>
      </label>
      <label>Provider API key
        <input type="password" autocomplete="off" disabled placeholder="${apiKeyConfigured ? 'Configured in Devvit app settings' : 'Set AI_API_KEY in Devvit app settings'}">
        <span class="secret-status ${apiKeyConfigured ? 'configured' : ''}">${apiKeyConfigured ? 'Configured in secret app settings.' : 'Not configured in secret app settings.'}</span>
      </label>
      <label>Voyage API key
        <input type="password" autocomplete="off" disabled placeholder="${voyageApiKeyConfigured ? 'Configured in Devvit app settings' : 'Set VOYAGE_API_KEY in Devvit app settings'}">
        <span class="secret-status ${voyageApiKeyConfigured ? 'configured' : ''}">${voyageApiKeyConfigured ? 'Configured in secret app settings.' : 'Optional. Not configured in secret app settings.'}</span>
      </label>
      <div class="actions">
        <button class="primary" type="submit">Save</button>
      </div>
    </form>`;
}

function formatStats(stats) {
  return Object.entries(stats)
    .map(([key, value]) => `${key}: ${Number.isInteger(value) ? value : Number(value).toFixed(2)}`)
    .join(' | ');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function render() {
  const data = state.data;
  if (!data) {
    view.innerHTML = '<div class="empty">Loading dashboard...</div>';
    return;
  }
  updateMetrics(data);
  if (state.view === 'history') view.innerHTML = renderHistory(data);
  else if (state.view === 'insights') view.innerHTML = renderInsights(data);
  else if (state.view === 'settings') view.innerHTML = renderSettings(data);
  else view.innerHTML = renderTriage(data);
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setView(tab.dataset.view);
  });
});

window.addEventListener('hashchange', () => {
  setView(window.location.hash.slice(1), { skipHash: true });
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (button) act(button.dataset.action, button.dataset.id);
});

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'settings-form') return;
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = Object.fromEntries(form.entries());
  try {
    await api('/api/ai-config', { method: 'POST', body: JSON.stringify(payload) });
    showToast('AI configuration saved');
    await load();
  } catch (error) {
    showToast(error.message);
  }
});

$('#refresh').addEventListener('click', load);
setView(state.view, { skipHash: true });
load();
window.setInterval(load, 15000);
