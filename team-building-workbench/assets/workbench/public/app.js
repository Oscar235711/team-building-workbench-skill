(function () {
  'use strict';

  var API = '/api';
  var LOCAL_KEY = 'team-building-workbench-local-drafts-v1';
  var DEFAULT_QUARTER = {
    id: 'offline', name: '团建工作台', budgetCents: null, people: null, open: false, deadline: null,
  };

  var state = {
    view: 'dashboard', workbench: { title: '团建工作台' }, quarter: null, quarters: [], terms: [], history: [], stats: {
      participants: 0, submissions: 0, levels: { 1: [], 2: [], 3: [] }, groups: [],
    }, me: null, isAdmin: false, activeLevel: 1, level3Filter: 'all', level3PlayFilter: 'all', activeSlot: 1,
    plans: { 1: emptyPlan(), 2: emptyPlan() }, revisions: { 1: 0, 2: 0 }, draftIds: {},
    submissions: { 1: null, 2: null },
    slotDirty: { 1: false, 2: false }, slotSeq: { 1: 0, 2: 0 },
    slotSaveTimers: { 1: null, 2: null }, slotSaving: { 1: false, 2: false }, slotSaveQueued: { 1: false, 2: false },
    localDirty: false, saving: false, saveError: '', scopeToken: 0, termRenameId: '', termRenameError: '',
    pollingTimer: null, pendingPreview: null, selectedGroup: null,
    selectedHistory: null, pendingBundle: null, inflation: 10, loaded: false, offline: false,
  };

  function byId(id) { return document.getElementById(id); }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (char) {
      var random = Math.random() * 16 | 0;
      var value = char === 'x' ? random : (random & 3 | 8);
      return value.toString(16);
    });
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function text(value, fallback) {
    return value == null || value === '' ? (fallback || '') : String(value);
  }

  function cents(value) {
    if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
    var number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : null;
  }

  function yuanToCents(value) {
    var number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 100) : 0;
  }

  function formatMoney(value, fallback) {
    if (value == null || (typeof value === 'string' && value.trim() === '')) return fallback || '待补充';
    if (value == null || !Number.isFinite(Number(value))) return fallback || '待补充';
    return '¥' + (Number(value) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDate(value) {
    if (!value) return '未设置日期';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  function publicHistoryNote(entry) {
    var note = text(entry && entry.note, '历史活动记录，仅供当前安排参考');
    return note.replace(/(?:收支明细表|Q[1-3]_明细表|总账|Excel|来源|摘要)[^。；;，,]*/gi, '').replace(/[；;，,]\s*[；;，,]/g, '，').replace(/^[；;，,]\s*|\s*[；;，,]$/g, '').trim() || '历史活动记录，仅供当前安排参考';
  }

  function historyPerPerson(entry) {
    var total = cents(entry && entry.totalCents), people = Number(entry && entry.people);
    return total != null && Number.isFinite(people) && people > 0 ? Math.round(total / people) : null;
  }

  function emptyPlan() {
    return { title: '', note: '', events: [{ id: uuid(), timeId: '', playIds: [], items: [], sharedCents: 0 }] };
  }

  function clonePlan(plan) {
    try { return JSON.parse(JSON.stringify(normalizePlan(plan))); } catch (error) { return emptyPlan(); }
  }

  function canonicalTermId(id) {
    return text(id);
  }

  function normalizePlan(plan) {
    var source = plan || {};
    var events = Array.isArray(source.events) ? source.events : [];
    return {
      title: text(source.title), note: text(source.note),
      events: events.map(function (event) {
        return {
          id: text(event.id) || uuid(), timeId: text(event.timeId),
          playIds: Array.isArray(event.playIds) ? event.playIds.map(String).filter(Boolean) : [],
          items: Array.isArray(event.items) ? event.items.map(function (item) {
            return { termId: canonicalTermId(item.termId), quantity: Math.max(1, Number(item.quantity) || 1) };
          }).filter(function (item) { return item.termId; }) : [],
          sharedCents: 0,
        };
      }),
    };
  }

  function parseMaybeJson(value, fallback) {
    if (value && typeof value === 'object') return value;
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch (error) { return fallback; }
    }
    return fallback;
  }

  function normalizeTerm(term) {
    var attrs = term && term.attrs && typeof term.attrs === 'object' ? term.attrs : {};
    attrs = Object.assign({}, attrs, { pricingMode: attrs.pricingMode === 'per_event' ? 'per_event' : 'per_person' });
    return {
      id: text(term && term.id), level: Number(term && term.level) || 1, name: text(term && term.name),
      parentId: term && term.parentId ? String(term.parentId) : null, active: term && term.active !== false,
      version: Number(term && term.version) || 1, attrs: attrs, canComplete: Boolean(term && term.canComplete),
    };
  }

  function getTerm(id) {
    var canonical = canonicalTermId(id);
    return state.terms.find(function (term) { return String(term.id) === String(canonical); }) || state.terms.find(function (term) { return String(term.id) === String(id); }) || null;
  }

  function getTerms(level) {
    return state.terms.filter(function (term) { return Number(term.level) === Number(level) && term.active !== false; });
  }

  function isIndoorTerm(term) {
    if (!term || Number(term.level) !== 3) return false;
    var parent = term.parentId ? getTerm(term.parentId) : null;
    return Boolean(parent && parent.attrs && parent.attrs.baseType === 'indoor');
  }

  function largeIndoorValue(term) {
    if (!isIndoorTerm(term)) return null;
    var value = term.attrs && term.attrs.largeIndoor;
    if (value === true || value === false) return value;
    var parent = term.parentId ? getTerm(term.parentId) : null;
    return parent && parent.attrs && parent.attrs.indoorScale === 'small' ? false : null;
  }

  function playColorIndex(playId) {
    var plays = state.terms.filter(function (term) { return Number(term.level) === 2; });
    var index = plays.findIndex(function (term) { return String(term.id) === String(playId); });
    return index < 0 ? 1 : index % 6 + 1;
  }

  function playChip(term) {
    if (!term) return '';
    return '<span class="term-parent-chip term-parent-chip--' + playColorIndex(term.id) + '">' + esc(term.name) + '</span>';
  }

  function getPlayName(id) {
    var term = getTerm(id);
    return term ? term.name : '待选择玩法';
  }

  function planForSlot(slot) {
    if (!state.plans[slot]) state.plans[slot] = emptyPlan();
    if (!Array.isArray(state.plans[slot].events)) state.plans[slot] = normalizePlan(state.plans[slot]);
    return state.plans[slot];
  }

  function localDrafts() {
    try { return JSON.parse(window.localStorage.getItem(LOCAL_KEY) || '{}') || {}; } catch (error) { return {}; }
  }

  function localIdentity() {
    return state.me && state.me.code ? 'code:' + String(state.me.code) : 'guest';
  }

  function localScope(all, create) {
    if (!state.quarter) return null;
    var quarterId = String(state.quarter.id);
    if (!all[quarterId] || typeof all[quarterId] !== 'object' || Array.isArray(all[quarterId])) {
      if (!create) return null;
      all[quarterId] = {};
    }
    var identity = localIdentity();
    if (!all[quarterId][identity] || typeof all[quarterId][identity] !== 'object' || Array.isArray(all[quarterId][identity])) {
      if (!create) return null;
      all[quarterId][identity] = {};
    }
    return all[quarterId][identity];
  }

  function syncSaveFlags() {
    state.localDirty = [1, 2].some(function (slot) { return Boolean(state.slotDirty[slot]); });
    state.saving = [1, 2].some(function (slot) { return Boolean(state.slotSaving[slot]); });
  }

  function saveStatusText(slot) {
    return state.slotSaving[slot] ? '正在保存草稿…' : state.saveError ? state.saveError : state.me ? (state.slotDirty[slot] ? '有改动，稍后自动保存' : '已与服务器同步') : '未登记 · 只保存在本机草稿';
  }

  function builderInputFocused() {
    var active = document.activeElement;
    return Boolean(active && active.closest && active.closest('#builder-content') && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
  }

  function updateBuilderSaveLine() {
    var line = document.querySelector('#builder-content .save-line');
    if (!line) return;
    var slot = state.activeSlot;
    line.className = 'save-line ' + (state.slotSaving[slot] ? 'is-saving' : state.saveError ? 'is-error' : '');
    var first = line.querySelector('span');
    if (first) first.textContent = saveStatusText(slot);
  }

  function renderBuilderAfterSave() {
    if (builderInputFocused()) updateBuilderSaveLine(); else renderBuilder();
  }

  function dirtySlots() {
    return [1, 2].filter(function (slot) { return Boolean(state.slotDirty[slot] || state.slotSaving[slot] || state.slotSaveTimers[slot]); });
  }

  function cancelPendingSaves(clearDirty) {
    [1, 2].forEach(function (slot) {
      if (state.slotSaveTimers[slot]) window.clearTimeout(state.slotSaveTimers[slot]);
      state.slotSaveTimers[slot] = null;
      state.slotSaveQueued[slot] = false;
      state.slotSaving[slot] = false;
      if (clearDirty) state.slotDirty[slot] = false;
    });
    syncSaveFlags();
  }

  function persistLocalDrafts() {
    if (!state.quarter || !window.localStorage) return;
    var all = localDrafts();
    var scope = localScope(all, true);
    if (!scope) return;
    [1, 2].forEach(function (slot) {
      scope[slot] = { plan: clonePlan(state.plans[slot]), revision: Number(state.revisions[slot]) || 0, dirty: Boolean(state.slotDirty[slot]) };
    });
    try { window.localStorage.setItem(LOCAL_KEY, JSON.stringify(all)); } catch (error) { /* storage is optional */ }
  }

  function restoreLocalDrafts() {
    if (!state.quarter) return;
    var saved = localScope(localDrafts(), false);
    if (!saved) return;
    [1, 2].forEach(function (slot) {
      var raw = saved[slot];
      if (!raw) return;
      var entry = raw && raw.plan ? raw : { plan: raw, revision: 0, dirty: true };
      var hasServerDraft = state.me && Array.isArray(state.me.drafts) && state.me.drafts.some(function (draft) { return Number(draft.slot) === slot; });
      var hasSubmission = Boolean(state.submissions[slot]);
      if (hasServerDraft && !entry.dirty) return;
      if (hasSubmission && !entry.dirty) return;
      state.plans[slot] = normalizePlan(entry.plan);
      if (entry.dirty) {
        state.slotDirty[slot] = true;
        state.slotSeq[slot] += 1;
      }
    });
    syncSaveFlags();
    [1, 2].forEach(function (slot) {
      if (state.me && state.slotDirty[slot]) scheduleDraftSave(slot, 0);
    });
  }

  async function api(path, options) {
    var opts = options || {};
    var response;
    try {
      response = await fetch(API + path, Object.assign({ credentials: 'include', headers: { Accept: 'application/json' } }, opts, {
        headers: Object.assign({ Accept: 'application/json' }, opts.headers || {}, opts.body ? { 'Content-Type': 'application/json' } : {}),
      }));
    } catch (error) {
      var network = new Error('暂时无法连接服务器，请稍后重试');
      network.network = true;
      throw network;
    }
    var raw = await response.text();
    var data = null;
    try { data = raw ? JSON.parse(raw) : {}; } catch (error) { data = { error: raw || response.statusText }; }
    if (!response.ok) {
      var failure = new Error(text(data && data.error, response.statusText || '请求失败'));
      failure.status = response.status;
      failure.data = data;
      throw failure;
    }
    return data;
  }

  function fallbackState() {
    cancelPendingSaves(true);
    state.scopeToken += 1;
    state.workbench = { title: '团建工作台' };
    state.quarter = Object.assign({}, DEFAULT_QUARTER);
    state.quarters = [];
    state.terms = [];
    state.history = [];
    state.stats = { participants: 0, submissions: 0, levels: { 1: [], 2: [], 3: [] }, groups: [] };
    state.me = null;
    state.submissions = { 1: null, 2: null };
    state.plans = { 1: emptyPlan(), 2: emptyPlan() };
    state.revisions = { 1: 0, 2: 0 };
    state.draftIds = {};
    state.isAdmin = false;
    state.adminRegistrations = null;
    state.termRenameId = '';
    state.termRenameError = '';
    state.offline = true;
    restoreLocalDrafts();
    syncSaveFlags();
  }

  function applyState(data, options) {
    var opts = options || {};
    var payload = data || {};
    var oldIdentity = localIdentity();
    var oldQuarterId = state.quarter && state.quarter.id;
    state.workbench = payload.workbench && typeof payload.workbench === 'object' ? payload.workbench : { title: '团建工作台' };
    if (payload.quarter) state.quarter = payload.quarter;
    state.quarters = Array.isArray(payload.quarters) ? payload.quarters : (state.quarter ? [state.quarter] : []);
    state.terms = (Array.isArray(payload.terms) ? payload.terms : []).map(normalizeTerm);
    state.history = Array.isArray(payload.history) ? payload.history : [];
    var stats = payload.stats || {};
    state.stats = {
      participants: Number(stats.participants) || 0, submissions: Number(stats.submissions) || 0,
      levels: { 1: Array.isArray(stats.levels && stats.levels[1]) ? stats.levels[1] : [], 2: Array.isArray(stats.levels && stats.levels[2]) ? stats.levels[2] : [], 3: Array.isArray(stats.levels && stats.levels[3]) ? stats.levels[3] : [] },
      groups: Array.isArray(stats.groups) ? stats.groups : [],
    };
    state.me = payload.me || null;
    state.isAdmin = Boolean(payload.isAdmin);
    state.adminRegistrations = state.isAdmin ? payload.adminRegistrations || null : null;
    if (!state.isAdmin) { state.termRenameId = ''; state.termRenameError = ''; }
    if (!state.isAdmin && state.accountAction) { state.accountAction=null; closeDialog(byId('account-action-dialog')); }
    var identityChanged = oldIdentity !== localIdentity();
    var quarterChanged = Boolean(oldQuarterId && state.quarter && oldQuarterId !== state.quarter.id);
    var preserveSlots = Array.isArray(opts.preserveSlots) ? opts.preserveSlots.map(Number).filter(function (slot) { return slot === 1 || slot === 2; }) : (opts.preservePlan ? [1, 2] : []);
    if (identityChanged || quarterChanged) {
      cancelPendingSaves(true);
      state.scopeToken += 1;
      preserveSlots = [];
    }
    state.submissions = { 1: null, 2: null };
    (state.me && Array.isArray(state.me.submissions) ? state.me.submissions : []).forEach(function (submission) {
      var slot = Number(submission.slot);
      if (slot === 1 || slot === 2) state.submissions[slot] = submission;
    });
    var drafts = state.me && Array.isArray(state.me.drafts) ? state.me.drafts : [];
    [1, 2].forEach(function (slot) {
      if (preserveSlots.indexOf(slot) >= 0) return;
      var draft = drafts.find(function (entry) { return Number(entry.slot) === slot; });
      var submission = state.submissions[slot];
      if (draft) {
        state.plans[slot] = normalizePlan(parseMaybeJson(draft.plan, emptyPlan()));
        state.revisions[slot] = Number(draft.revision) || 0;
        state.draftIds[slot] = draft.id;
      } else if (submission) {
        state.plans[slot] = planFromSnapshot(submission.snapshot);
        state.revisions[slot] = 0;
        state.draftIds[slot] = null;
      } else {
        state.plans[slot] = emptyPlan();
        state.revisions[slot] = 0;
        state.draftIds[slot] = null;
      }
      state.slotDirty[slot] = false;
      state.slotSeq[slot] = 0;
    });
    restoreLocalDrafts();
    syncSaveFlags();
    state.loaded = true;
    state.offline = false;
  }

  async function loadState(options) {
    var opts = options || {};
    var requestedQuarterId = opts.quarterId || (state.quarter && state.quarter.id) || '';
    var changingQuarter = Boolean(requestedQuarterId && state.quarter && requestedQuarterId !== state.quarter.id);
    if (changingQuarter) {
      persistLocalDrafts();
      state.scopeToken += 1;
      cancelPendingSaves(true);
    }
    var requestToken = state.scopeToken;
    var preserveSlots = Array.isArray(opts.preserveSlots) ? opts.preserveSlots : (opts.preservePlan ? dirtySlots() : []);
    if (changingQuarter) preserveSlots = [];
    var query = requestedQuarterId ? '?quarter=' + encodeURIComponent(requestedQuarterId) : '';
    try {
      var data = await api('/state' + query);
      if (requestToken !== state.scopeToken) return null;
      if (requestedQuarterId && data && data.quarter && data.quarter.id !== requestedQuarterId) return null;
      applyState(data, { preserveSlots: preserveSlots });
      if (!state.quarter) fallbackState();
      if (opts.background) renderBackground(); else renderAll();
      return data;
    } catch (error) {
      if (!state.loaded) fallbackState();
      if (opts.background) renderBackground(); else renderAll();
      if (!opts.silent) toast(error.message, 'error');
      return null;
    }
  }

  function normalizePathView(view) {
    return ['dashboard', 'builder', 'stats', 'history', 'mine', 'admin'].indexOf(view) >= 0 ? view : 'dashboard';
  }

  function navigate(view) {
    state.view = normalizePathView(view);
    document.querySelectorAll('[data-view]').forEach(function (button) {
      button.classList.toggle('is-active', button.getAttribute('data-view') === state.view);
    });
    document.querySelectorAll('.view').forEach(function (section) {
      section.classList.toggle('is-visible', section.id === 'view-' + state.view);
    });
    if (state.view === 'builder') renderBuilder();
    if (state.view === 'stats') renderStats();
    if (state.view === 'mine') renderMine();
    if (state.view === 'admin') renderAdmin();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toast(message, kind) {
    var region = byId('toast-region');
    if (!region) return;
    var item = document.createElement('div');
    item.className = 'toast toast--' + (kind || 'success');
    var mark = document.createElement('span');
    mark.className = 'toast-mark';
    mark.textContent = kind === 'error' ? '!' : '✓';
    var content = document.createElement('span');
    content.textContent = text(message);
    item.appendChild(mark); item.appendChild(content); region.appendChild(item);
    window.setTimeout(function () { item.remove(); }, 4000);
  }

  function openDialog(id) {
    var dialog = byId(id);
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog(dialog) {
    var target = dialog && dialog.closest ? dialog.closest('dialog') : dialog;
    if (target && typeof target.close === 'function') target.close();
    else if (target) target.removeAttribute('open');
  }

  function openRegister() {
    var form = byId('register-form');
    if (form) form.reset();
    var error = byId('register-error');
    if (error) error.textContent = '';
    openDialog('register-dialog');
    window.setTimeout(function () { var code = byId('register-code'); if (code) code.focus(); }, 30);
  }

  function workbenchTitle() {
    return text(state.workbench && state.workbench.title, '团建工作台');
  }

  function renderHeader() {
    var quarter = state.quarter || DEFAULT_QUARTER;
    var name = byId('quarter-name');
    var status = byId('quarter-status');
    var register = byId('register-trigger');
    var profile = byId('user-menu-trigger');
    var avatar = byId('profile-avatar');
    var label = byId('profile-label');
    var workbench = byId('workbench-title');
    if (workbench) workbench.textContent = workbenchTitle();
    if (name) name.textContent = text(quarter.name, '当前活动期');
    if (status) {
      status.textContent = state.offline ? '暂时离线' : quarter.open === false ? '投票已关闭' : '开放中';
      status.className = 'status-pill ' + (state.offline || quarter.open === false ? 'status-pill--closed' : 'status-pill--open');
    }
    if (state.me) {
      if (register) register.hidden = true;
      if (profile) profile.hidden = false;
      if (avatar) avatar.textContent = text(state.me.nickname, '我').slice(0, 1);
      if (label) label.textContent = state.me.nickname + ' · ' + (Number(state.me.remaining) || 0) + '份可提交';
    } else {
      if (register) register.hidden = false;
      if (profile) profile.hidden = true;
    }
  }

  function eventLabel(event) {
    var time = getTerm(event.timeId);
    var plays = event.playIds.map(getPlayName).join('＋');
    return (time ? time.name : '时间待选') + (plays ? ' · ' + plays : '');
  }

  function snapshotEvents(snapshot) {
    var value = parseMaybeJson(snapshot, {});
    return Array.isArray(value && value.events) ? value.events : [];
  }

  function planFromSnapshot(snapshot) {
    var source = parseMaybeJson(snapshot, {});
    var events = Array.isArray(source.events) ? source.events : [];
    var plan = {
      title: text(source.title),
      note: text(source.note),
      events: events.map(function (event) {
        var timeId = event.timeId || (event.time && event.time.id) || '';
        var playIds = Array.isArray(event.playIds) ? event.playIds.map(function (id) { return typeof id === 'object' ? id.id : id; }) : (Array.isArray(event.plays) ? event.plays.map(function (play) { return play.id; }) : []);
        var items = Array.isArray(event.items) ? event.items.map(function (item) { return { termId: item.termId || item.id, quantity: Number(item.quantity) || 1 }; }).filter(function (item) { return item.termId; }) : [];
        return { id: uuid(), timeId: timeId, playIds: playIds, items: items, sharedCents: 0 };
      }),
    };
    return normalizePlan(plan);
  }

  function snapshotEventText(event) {
    var timeId = event.timeId || event.time && event.time.id;
    var time = (getTerm(timeId) || {}).name || (event.time && event.time.name) || '时间待选';
    var plays = Array.isArray(event.plays) ? event.plays.map(function (play) { return (getTerm(play.id) || {}).name || play.name || play.id; }) : (event.playIds || []).map(function (id) { return getPlayName(id); });
    var items = Array.isArray(event.items) ? event.items.map(function (item) { return ((getTerm(item.termId) || {}).name || item.name || '项目') + (Number(item.quantity) > 1 ? ' ×' + item.quantity : ''); }) : [];
    return { time: time, plays: plays, items: items };
  }

  function snapshotItemLines(event, people) {
    return Array.isArray(event && event.items) ? event.items.map(function (item) { return snapshotItemLine(item, people); }) : [];
  }

  function estimatePlan(plan) {
    var current = state.quarter || DEFAULT_QUARTER, people = current.people == null || current.people === '' ? null : Number(current.people);
    if (!Number.isFinite(people) || people < 0) people = null;
    var total = 0, hasUnknownPrice = false, flags = new Set(), seen = new Set(), issues = [];
    var events = plan && Array.isArray(plan.events) ? plan.events : [];
    if (!events.length) issues.push('至少添加一场活动');
    var detail = events.map(function (event, index) {
      var time = getTerm(event.timeId), plays = event.playIds.map(getTerm).filter(Boolean), eventTotal = 0, unknown = false;
      if (!time) issues.push('第' + (index + 1) + '场还没有选择时间');
      if (!plays.length) issues.push('第' + (index + 1) + '场至少选择一个玩法');
      if (plays.length > 3) issues.push('每场最多选择3个玩法');
      if (!event.items.length) issues.push('第' + (index + 1) + '场至少添加一个具体项目');
      if (time && time.attrs.dayType === 'weekday' && plays.some(function(p){return p.attrs.baseType === 'travel';})) issues.push('工作日不能安排出游');
      event.items.forEach(function (item) {
        var term = getTerm(item.termId), id = canonicalTermId(item.termId);
        if (seen.has(id) || Number(item.quantity) !== 1) issues.push('每个具体项目在一套方案中只能选择一次');
        seen.add(id);
        if (!term || !term.active) { issues.push('含已停用项目，请移除后重新选择'); return; }
        var price = itemPrice(term), large = largeIndoorValue(term);
        if (price == null || (pricingMode(term) === 'per_person' && people == null)) { flags.add(price == null ? '无估价' : '人数待配置'); hasUnknownPrice = true; unknown = true; }
        else eventTotal += itemCost(term, item.quantity, people);
        if (!term.attrs.location) flags.add('无地点');
        if (isIndoorTerm(term) && large == null) issues.push('请确认是否大型室内项目');
        if (time && time.attrs.dayType === 'weekday' && large === true) issues.push('工作日不能安排大型室内项目');
      });
      total += eventTotal;
      return {event:event,totalCents:unknown?null:eventTotal,eventComplete:!unknown,time:time,plays:plays};
    });
    var budget = cents(current.budgetCents), totalCents = hasUnknownPrice || issues.length ? null : total;
    var balance = budget == null || totalCents == null ? null : budget - totalCents;
    return {totalCents:totalCents,knownTotalCents:total,balanceCents:balance,status:issues.length?'incomplete':hasUnknownPrice?'unestimated':balance<0?'over':'ok',issues:Array.from(new Set(issues)),flags:Array.from(flags),detail:detail,people:people,budgetCents:budget};
  }

  function missingBadges(value) {
    var flags = value && Array.isArray(value.flags) ? value.flags.slice() : [];
    if (!flags.length && value && Array.isArray(value.events)) {
      var items = value.events.flatMap(function(e){return e.items || [];});
      if (items.some(function(i){return i.priceCents == null;})) flags.push('无估价');
      if (items.some(function(i){return !i.location && !(i.attrs && i.attrs.location);})) flags.push('无地点');
    }
    return flags.length ? '<span class="missing-badges">' + flags.map(function(label){return '<span class="tag tag--orange">' + esc(label) + '</span>';}).join('') + '</span>' : '';
  }

  function itemPrice(term) {
    var value = term && term.attrs ? cents(term.attrs.priceCents) : null;
    return value == null ? null : value;
  }

  function pricingMode(term) {
    return term && term.attrs && term.attrs.pricingMode === 'per_event' ? 'per_event' : 'per_person';
  }

  function pricingUnit(term) {
    return pricingMode(term) === 'per_event' ? '次' : '人';
  }

  function itemCost(term, quantity, people) {
    var price = itemPrice(term);
    if (price == null) return null;
    var count = Math.max(1, Number(quantity) || 1);
    if (pricingMode(term) === 'per_person' && (people == null || !Number.isFinite(Number(people)))) return null;
    return price * count * (pricingMode(term) === 'per_event' ? 1 : Math.max(0, Number(people) || 0));
  }

  function snapshotPricingMode(item) {
    return item && (item.pricingMode === 'per_event' || item.attrs && item.attrs.pricingMode === 'per_event') ? 'per_event' : 'per_person';
  }

  function snapshotItemLine(item, people) {
    var name = item && ((getTerm(item.termId) || {}).name || item.name || item.termId) || '项目';
    var quantity = Math.max(1, Number(item && item.quantity) || 1);
    var price = item && item.priceCents != null ? cents(item.priceCents) : null;
    if (price == null) return name + (quantity > 1 ? ' ×' + quantity : '');
    var mode = snapshotPricingMode(item);
    var total = price * quantity * (mode === 'per_event' ? 1 : Math.max(0, Number(people) || 0));
    return name + (quantity > 1 ? ' ×' + quantity : '') + ' · ' + formatMoney(price) + '/' + (mode === 'per_event' ? '次' : '人') + ' · 小计 ' + formatMoney(total);
  }

  function estimateValue(value, fallback) {
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'totalCents')) {
      return value.totalCents;
    }
    return value == null ? fallback : value;
  }

  function localDeadline(value) {
    var raw = String(value || '').trim();
    if (!raw) return null;
    if (/Z$|[+-]\d{2}:\d{2}$/.test(raw)) return raw;
    return raw.length === 16 ? raw + ':00+08:00' : raw + '+08:00';
  }

  function renderDashboard() {
    var root = byId('dashboard-content');
    if (!root) return;
    var quarter = state.quarter || DEFAULT_QUARTER;
    var stats = state.stats || {};
    var groups = Array.isArray(stats.groups) ? stats.groups : [];
    var leader = groups[0];
    var leaderSnapshot = leader ? parseMaybeJson(leader.snapshot, {}) : null;
    var leaderEvents = leaderSnapshot && Array.isArray(leaderSnapshot.events) ? leaderSnapshot.events : [];
    var budget = cents(quarter.budgetCents);
    var people = quarter.people == null || quarter.people === '' ? null : Number(quarter.people);
    if (!Number.isFinite(people) || people < 0) people = null;
    var leaderEstimate = leader ? estimateValue(leader.currentEstimate, leaderSnapshot && leaderSnapshot.totalCents) : null;
    var leaderPeople = leaderSnapshot && leaderSnapshot.people != null ? leaderSnapshot.people : people;
    var leaderOver = leaderEstimate != null && budget != null && leaderEstimate > budget;
    root.innerHTML = '<div class="hero-row">' +
      '<div><div class="page-kicker">TEAM WORKBENCH / ' + esc(workbenchTitle()) + '</div><h1 id="dashboard-title">一起拼出可执行的团建安排。</h1><p class="page-intro">登记后提交两套方案，查看团队选择并继续编辑自己的安排。</p></div>' +
      '<div class="hero-actions"><button type="button" class="button button--primary" data-action="go-builder">开始拼方案 <span aria-hidden="true">↗</span></button><button type="button" class="button button--soft" data-action="go-stats">看大家的灵感</button></div>' +
      '</div>' +
      '<div class="stat-grid">' +
        '<article class="stat-card stat-card--accent"><div class="stat-label">公共预算 <span class="tag tag--orange">当前配置</span></div><div class="stat-value">' + esc(formatMoney(budget, '待配置')) + '</div><div class="stat-foot">预计人数 ' + esc(people == null ? '待配置' : String(people)) + ' · 人均约 <strong>' + esc(budget != null && people ? formatMoney(Math.round(budget / people)) : '待补充') + '</strong></div></article>' +
        '<article class="stat-card"><div class="stat-label">已参与人数 <span class="tag tag--green">当前活动期</span></div><div class="stat-value">' + esc(state.offline ? '暂不可读' : String(Number(stats.participants) || 0)) + (state.offline ? '' : '<small class="stat-unit">人</small>') + '</div><div class="stat-foot">正式提交至少一套方案</div></article>' +
        '<article class="stat-card"><div class="stat-label">已提交方案 <span class="tag tag--purple">每人最多两份</span></div><div class="stat-value">' + esc(state.offline ? '暂不可读' : String(Number(stats.submissions) || 0)) + (state.offline ? '' : '<small class="stat-unit">份</small>') + '</div><div class="stat-foot">草稿和历史记录不计入</div></article>' +
        '<article class="stat-card"><div class="stat-label">历史参考 <span class="tag tag--muted">仅供参考</span></div><div class="stat-value">' + esc(state.offline ? '暂不可读' : String(state.history.length)) + (state.offline ? '' : '<small class="stat-unit">条</small>') + '</div><div class="stat-foot">金额与记录以接口返回为准</div></article>' +
      '</div>' +
      '<div class="dashboard-grid"><article class="panel leader-panel"><div class="panel-head"><div><h3>当前领先的完整方案</h3><p>支持人数以工号去重；同一人的两份方案只计一人。</p></div><button type="button" class="text-button" data-action="go-stats">查看全部 →</button></div>' +
        (leader ? '<div class="leader-ornament"><div class="leader-crown">✦</div></div><div class="panel-body"><div class="leader-title"><strong>' + esc(text(leader.title || (leaderSnapshot && leaderSnapshot.title), '未命名方案')) + '</strong><span class="tag tag--orange">' + esc(String(Number(leader.supporters) || 0)) + ' 人支持</span></div><div class="leader-meta"><span>预计人数 <strong>' + esc(leaderPeople == null ? '待配置' : String(leaderPeople) + ' 人') + '</strong></span><span>预计总额 <strong>' + esc(formatMoney(leaderEstimate)) + '</strong></span>' + (leaderOver ? '<span class="tag tag--red">预计超额 ' + esc(formatMoney(leaderEstimate - budget)) + '</span>' : '') + (leader.tied ? '<span class="tag tag--orange">并列首位</span>' : '') + '<span>' + esc(leader.nicknames && leader.nicknames.length ? leader.nicknames.slice(0, 3).join('、') : '匿名支持') + '</span></div><div class="leader-events">' + leaderEvents.slice(0, 3).map(function (event) { var line = snapshotEventText(event); return '<div class="leader-event"><span class="leader-event-dot"></span><span><b>' + esc(line.time) + '</b> · ' + esc(line.plays.join('＋') || '玩法待补') + ' · ' + esc(line.items.join('、') || '项目待补') + '</span></div>'; }).join('') + '</div><div class="group-actions leader-actions"><button type="button" class="button button--ghost" data-action="group-detail" data-group-index="0">查看详情</button><button type="button" class="button button--soft" data-action="adopt-group" data-group-index="0">采用此方案</button></div></div>' : '<div class="leader-empty"><div><strong>第一套完整方案还在等你</strong><span>现在登记并提交，灵感就会出现在这里。</span><br /><button type="button" class="button button--soft" data-action="go-builder">去拼第一套方案</button></div></div>') +
      '</article><article class="panel quick-panel"><div class="panel-head"><div><h3>从这里开始</h3><p>每一步都可以先浏览，再决定是否登记。</p></div></div><div class="quick-list"><button type="button" class="quick-link" data-action="go-builder"><span class="quick-link-main"><span class="quick-icon">✦</span><span><strong>拼一套活动安排</strong><span>拖入时间、玩法和项目</span></span></span><span class="quick-arrow">›</span></button><button type="button" class="quick-link" data-action="go-stats"><span class="quick-link-main"><span class="quick-icon">◒</span><span><strong>看看大家选了什么</strong><span>柱状图、词云和完整方案</span></span></span><span class="quick-arrow">›</span></button><button type="button" class="quick-link" data-action="go-history"><span class="quick-link-main"><span class="quick-icon">↺</span><span><strong>翻翻历史参考</strong><span>了解费用结构和折算口径</span></span></span><span class="quick-arrow">›</span></button><button type="button" class="quick-link" data-action="open-register"><span class="quick-link-main"><span class="quick-icon">♡</span><span><strong>' + (state.me ? '继续我的方案' : '登记你的额度') + '</strong><span>每季最多提交两套方案</span></span></span><span class="quick-arrow">›</span></button></div></article></div>';
  }

  function currentBuilderEvent() {
    var plan = planForSlot(state.activeSlot);
    var selected = plan.events.find(function (entry) { return entry.id === state.activeEventId; }) || plan.events[0] || ensureEvent(plan);
    state.activeEventId = selected.id;
    return selected;
  }

  function goLibraryStep(level) {
    var event = currentBuilderEvent();
    var time = getTerm(event.timeId);
    if (level > 1 && (!time || !time.active)) { state.activeLevel = 1; toast('先为这一场选择一个时间。', 'error'); renderBuilder(); return; }
    if (level > 2 && (!event.playIds.length || event.playIds.length > 3)) { state.activeLevel = 2; toast('请为这一场选择1至3个玩法。', 'error'); renderBuilder(); return; }
    state.activeLevel = Math.max(1, Math.min(3, level));
    state.librarySearch = '';
    state.level3PlayFilter = 'all';
    renderBuilder();
  }

  function nextLibraryStep() { goLibraryStep(Math.min(3, state.activeLevel + 1)); }

  function termCard(term) {
    var attrs = term.attrs || {};
    var price = itemPrice(term);
    var parent = term.level === 3 ? getTerm(term.parentId) : null;
    var parentChip = parent ? playChip(parent) : '';
    var activity = currentBuilderEvent();
    var selectedItem = planForSlot(state.activeSlot).events.flatMap(function(e){return e.items;}).find(function (item) { return item.termId === term.id; });
    var selected = term.level === 1 ? activity.timeId === term.id : term.level === 2 ? activity.playIds.indexOf(term.id) >= 0 : Boolean(selectedItem);
    var selectedLabel = '已选';
    var meta = [];
    if (term.level === 1) meta.push(attrs.dayType === 'weekday' ? '工作日' : attrs.dayType === 'weekend' ? '周末' : '时段待补');
    if (term.level === 2) meta.push({ travel: '户外走走，周末出发', tea: '轻松分享美食', dinner: '一起好好吃顿饭', indoor: attrs.indoorScale === 'small' ? '轻松的小型室内活动' : '一起体验室内活动', other: '自定义活动玩法' }[attrs.baseType] || '活动性质待补');
    if (term.level === 3) {
      meta.push(price == null ? '无估价' : '估价 ' + formatMoney(price) + '/' + pricingUnit(term));
      meta.push(attrs.location || '无地点');
       if (largeIndoorValue(term) === true) meta.push('大型室内');
       if (largeIndoorValue(term) === false) meta.push('非大型室内');
    }
    var card = '<button type="button" class="library-card ' + (selected ? 'is-selected ' : '') + (term.active === false ? 'is-inactive' : '') + '" ' + (term.level === 3 && selected ? 'disabled ' : '') + 'draggable="true" data-action="add-term" data-term-id="' + esc(term.id) + '" aria-pressed="' + String(selected) + '" aria-label="添加 ' + esc(term.name) + '"><span class="library-card-name"><span>' + esc(term.name) + '</span>' + (selected ? '<span class="library-selection">✓ ' + esc(selectedLabel) + '</span>' : term.level === 3 && price == null ? '<span class="tag tag--muted">待补充</span>' : '') + '</span><span class="library-card-meta">' + meta.map(function (part, index) { return '<span class="' + (index === 0 && term.level === 3 && price != null ? 'price' : '') + '">' + esc(part) + '</span>'; }).join('') + parentChip + '</span></button>';
    var attrsComplete = term.level === 3 && term.canComplete;
    return '<div class="library-card-wrap">' + card + (attrsComplete ? '<button type="button" class="library-edit" data-action="edit-term" data-term-id="' + esc(term.id) + '">补齐</button>' : '') + '</div>';
  }

  function renderBudget(summary) {
    var statusText = summary.status === 'over' ? '预计超预算' : summary.status === 'incomplete' ? '请处理方案规则问题' : summary.totalCents == null ? '可提交，预算暂无法判断' : '当前估价在预算内';
    var statusClass = summary.status === 'over' ? 'tag--red' : summary.status === 'incomplete' || summary.totalCents == null ? 'tag--muted' : 'tag--green';
    var balance = summary.balanceCents;
    var increase = summary.totalCents == null ? null : Math.round(summary.totalCents * (1 + state.inflation / 100));
    var increaseBalance = increase == null || summary.budgetCents == null ? null : summary.budgetCents - increase;
    return '<aside class="panel budget-panel"><div class="budget-hero"><span class="eyebrow">方案 ' + state.activeSlot + ' · 实时估算</span><div class="budget-total">' + esc(formatMoney(summary.totalCents)) + '</div><div class="budget-sub">' + esc(summary.people == null ? '人数待配置，暂不计算人均' : '按当前配置的 ' + String(summary.people) + ' 人计算') + '</div></div><div class="budget-body"><div class="budget-line"><span>公共预算</span><strong>' + esc(formatMoney(summary.budgetCents, '待配置')) + '</strong></div><div class="budget-line"><span>预计人均</span><strong>' + esc(summary.totalCents == null || !summary.people ? '待补充' : formatMoney(Math.round(summary.totalCents / summary.people))) + '</strong></div><div class="budget-balance ' + (balance != null && balance < 0 ? 'is-over' : '') + '"><span>' + esc(balance != null && balance < 0 ? '预计超额' : '预算余额') + '</span><strong>' + esc(balance == null ? '待补充' : formatMoney(Math.abs(balance))) + '</strong></div><span class="tag ' + statusClass + '">' + esc(statusText) + '</span>' + missingBadges(summary) + (balance != null && balance < 0 ? '<div class="budget-warning">这套方案只是超预算，仍然可以提交；工作日规则冲突需要先修正。估价和地点可留空提交。</div>' : '') + '<div class="inflate-control"><span>费用上浮测算</span><label><input class="number-input" type="number" min="0" max="100" step="1" data-action="inflation" value="' + esc(String(state.inflation)) + '" /> %</label></div>' + (increaseBalance != null ? '<div class="budget-note">上浮 ' + esc(String(state.inflation)) + '% 后：' + (increaseBalance < 0 ? '<span class="tag tag--red">可能超 ' + esc(formatMoney(Math.abs(increaseBalance))) + '</span>' : '<strong>' + esc(formatMoney(increaseBalance)) + '</strong> 仍有余量') + '。这是测算假设，不是超预算概率。</div>' : '<div class="budget-note">补齐所有项目估价和人数后，会显示费用上浮测算。</div>') + '</div></aside>';
  }

  function renderEvent(event, index, plan) {
    var timeTerms = getTerms(1);
    var playTerms = getTerms(2);
    var itemMap = Object.create(null);
    event.items.forEach(function (item) { itemMap[item.termId] = item; });
    var items = event.items.map(function (item) {
      var term = getTerm(item.termId);
      var price = itemPrice(term);
      var people = state.quarter && state.quarter.people != null ? Number(state.quarter.people) : null;
      var lineTotal = itemCost(term, item.quantity, people);
      var unitPrice = price == null ? '待补充' : formatMoney(price) + '/' + pricingUnit(term);
      var rowCost = lineTotal == null ? '无估价' : formatMoney(lineTotal) + (pricingMode(term) === 'per_event' ? '/次' : '/场');
      return '<div class="item-row"><div class="item-row-name" title="' + esc(term ? term.name : item.termId) + '">' + esc(term ? term.name : '未知项目') + '<span class="item-row-sub">' + esc(term && term.attrs && (term.attrs.location || term.attrs.locationHint) ? (term.attrs.location || term.attrs.locationHint) : '无地点') + '</span></div><span class="item-single">已选一次</span><span class="item-row-cost" title="单价 ' + esc(unitPrice) + ' · 当前小计 ' + esc(rowCost) + '">' + esc(rowCost) + '</span><button type="button" class="icon-button" data-action="remove-item" data-event-id="' + esc(event.id) + '" data-term-id="' + esc(item.termId) + '" aria-label="移除项目">×</button></div>';
    }).join('');
    return '<article class="event-card' + (state.activeEventId === event.id ? ' is-active-event' : '') + '" data-drop-event="' + esc(event.id) + '" data-event-id="' + esc(event.id) + '"><div class="event-card-head"><div class="event-index"><span class="event-number">' + esc(String(index + 1).padStart(2, '0')) + '</span><strong>' + esc(eventLabel(event)) + '</strong></div><div class="event-actions"><button type="button" class="button button--ghost event-choose" data-action="choose-event" data-event-id="' + esc(event.id) + '">为本场选词</button><button type="button" class="icon-button" data-action="copy-event" data-event-id="' + esc(event.id) + '" aria-label="复制活动卡">⧉</button><button type="button" class="icon-button" data-action="remove-event" data-event-id="' + esc(event.id) + '" aria-label="删除活动卡">×</button></div></div><div class="event-grid"><div><label class="event-field-label" for="time-' + esc(event.id) + '">什么时候</label><select id="time-' + esc(event.id) + '" class="select-input" data-action="set-time" data-event-id="' + esc(event.id) + '"><option value="">选择时间</option>' + timeTerms.map(function (term) { return '<option value="' + esc(term.id) + '" ' + (term.id === event.timeId ? 'selected' : '') + '>' + esc(term.name) + '</option>'; }).join('') + '</select></div><div><span class="event-field-label">想怎么玩</span><div class="play-chips">' + (event.playIds.length ? event.playIds.map(function (playId) { return '<span class="chip">' + esc(getPlayName(playId)) + '<button type="button" data-action="remove-play" data-event-id="' + esc(event.id) + '" data-play-id="' + esc(playId) + '" aria-label="移除 ' + esc(getPlayName(playId)) + '">×</button></span>'; }).join('') : '<span class="empty-chip">从上方点击或拖入玩法</span>') + '</div></div></div><div class="items-block"><div class="items-head"><strong>具体项目</strong><span>' + esc(String(event.items.reduce(function (sum, item) { return sum + (Number(item.quantity) || 1); }, 0))) + ' 次安排</span></div>' + (items || '<div class="drop-zone">把具体项目拖到这张卡的任意位置，或点击上方项目</div>') + '</div><div class="drop-zone" data-drop-event="' + esc(event.id) + '">拖入时间、玩法或项目到这里 <strong>＋</strong></div></article>';
  }

  function renderBuilder() {
    var root = byId('builder-content');
    if (!root) return;
    var plan = planForSlot(state.activeSlot);
    var activity = currentBuilderEvent();
    var activityIndex = plan.events.findIndex(function (entry) { return entry.id === activity.id; });
    var summary = estimatePlan(plan);
    var hasSubmission = Boolean(submissionForSlot(state.activeSlot));
    var level = state.activeLevel;
    var names = { 1: '时间', 2: '玩法', 3: '具体项目' };
    var selectedPlays = getTerms(2).filter(function (play) { return activity.playIds.indexOf(play.id) >= 0; });
    var selectedTime = getTerm(activity.timeId);
    if (state.level3PlayFilter !== 'all' && !selectedPlays.some(function (play) { return play.id === state.level3PlayFilter; })) state.level3PlayFilter = 'all';
    var terms = getTerms(level).filter(function (term) {
      if (level === 3 && activity.playIds.indexOf(term.parentId) < 0) return false;
      if (level === 3 && state.level3PlayFilter !== 'all' && term.parentId !== state.level3PlayFilter) return false;
      var search = (state.librarySearch || '').trim().toLowerCase();
      return !search || term.name.toLowerCase().indexOf(search) >= 0 || String(term.attrs && term.attrs.location || '').toLowerCase().indexOf(search) >= 0;
    });
    var filter = level === 3 ? '<div class="play-filter"><span class="library-filter-label">只看本场已选玩法</span><div class="play-filter-chips"><button type="button" class="play-filter-chip ' + (state.level3PlayFilter === 'all' ? 'is-active' : '') + '" data-action="library-play-filter" data-play-id="all">全部已选玩法</button>' + selectedPlays.map(function (play) { return '<button type="button" class="play-filter-chip play-filter-chip--' + playColorIndex(play.id) + ' ' + (state.level3PlayFilter === play.id ? 'is-active' : '') + '" data-action="library-play-filter" data-play-id="' + esc(play.id) + '">' + esc(play.name) + '</button>'; }).join('') + '</div></div>' : '';
    var context = '<div class="library-context"><span>正在搭配</span><select class="select-input" data-action="builder-event" aria-label="选择正在搭配的活动">' + plan.events.map(function (event, index) { return '<option value="' + esc(event.id) + '" ' + (event.id === activity.id ? 'selected' : '') + '>第' + (index + 1) + '场 · ' + esc(eventLabel(event)) + '</option>'; }).join('') + '</select></div>';
    var stepHint = level === 1 ? '时间单选，先决定这一场什么时候见面。' : level === 2 ? '玩法可多选，最多3个；再次点击可取消。' : '按已选玩法挑项目，每套方案每个项目只能选一次。也可拖到下方整张活动卡。';
    var selection = level === 1 ? selectedTime ? '已选：' + selectedTime.name : '尚未选择时间' : level === 2 ? '已选 ' + activity.playIds.length + '/3：' + (selectedPlays.map(function (p) { return p.name; }).join('、') || '请选择玩法') : '本场已选 ' + activity.items.reduce(function (sum, item) { return sum + item.quantity; }, 0) + ' 个具体项目';
    var next = level < 3 ? '<button type="button" class="button button--primary" data-action="library-next" ' + ((level === 1 && !selectedTime || level === 2 && (!activity.playIds.length || activity.playIds.length > 3)) ? 'disabled' : '') + '>下一步：' + (level === 1 ? '选玩法' : '选具体项目') + ' →</button>' : '<button type="button" class="button button--primary" data-action="library-finish">查看本场活动 ↓</button>';
    root.innerHTML = '<div class="builder-head"><div><div class="page-kicker">BUILD YOUR PLAN</div><h2 id="builder-title">把想法拼进活动卡。</h2><p class="page-intro">团建方案模拟，每人可提交两套方案，计入最终投票</p></div><div class="slot-switcher">' + [1, 2].map(function (slot) { return '<button type="button" class="slot-button ' + (state.activeSlot === slot ? 'is-active' : '') + '" data-action="slot" data-slot="' + slot + '">方案' + (slot === 1 ? '一' : '二') + '</button>'; }).join('') + '</div></div>' +
      '<div class="builder-layout"><section class="panel library-panel" aria-label="灵感词库"><div class="library-head"><div><h3>灵感词库</h3><p>' + esc(stepHint) + '</p></div>' + context + '</div><div class="library-stepbar"><div class="level-tabs">' + [1, 2, 3].map(function (step) { return '<button type="button" class="level-tab ' + (level === step ? 'is-active' : '') + '" data-action="level" data-level="' + step + '" aria-current="' + (level === step ? 'step' : 'false') + '"><span class="step-number">' + step + '</span>' + names[step] + (step === 1 ? '<small>单选</small>' : step === 2 ? '<small>最多3个</small>' : '') + '</button>'; }).join('') + '</div></div>' +
      (level === 3 ? '<div class="library-tools">' + filter + '<div class="library-search"><input class="text-input" type="search" placeholder="搜索项目或地点" value="' + esc(state.librarySearch || '') + '" data-action="library-search" aria-label="搜索词库" /></div></div>' : '') +
      '<div class="library-list library-list--' + level + '">' + (terms.length ? terms.map(termCard).join('') : '<div class="empty-state"><div><strong>当前玩法下暂无可选项目</strong><span>可返回选择其他玩法，或补充一个新项目。</span></div></div>') + '</div>' +
      '<div class="library-footer"><div><strong>' + esc(selection) + '</strong>' + (level === 1 ? '<span class="eyebrow">时间词条已锁定</span>' : '<button type="button" class="text-button" data-action="open-term-form">＋ 补充词条</button>') + '</div><div class="library-next-actions">' + (level > 1 ? '<button type="button" class="button button--ghost" data-action="library-back">上一步</button>' : '') + next + '</div></div></section>' +
      '<section class="canvas-panel"><div class="canvas-toolbar"><div><input class="plan-title-input" type="text" maxlength="80" value="' + esc(plan.title || '') + '" placeholder="给这套方案取个名字" data-action="plan-title" aria-label="方案名称" /><span>方案 ' + state.activeSlot + '</span></div><button type="button" class="button button--primary" data-action="preview" data-slot="' + state.activeSlot + '">' + (hasSubmission ? '预览修改' : '预览并提交') + '</button></div><textarea class="plan-note-input" maxlength="500" placeholder="可选：写下集合地点、适合谁，或你最想保留的细节" data-action="plan-note" aria-label="方案说明">' + esc(plan.note || '') + '</textarea><div class="event-stack">' + plan.events.map(function (event, index) { return renderEvent(event, index, plan); }).join('') + '<button type="button" class="add-event-card" data-action="add-event">＋ 添加另一场活动</button></div><div class="save-line"><span>' + esc(saveStatusText(state.activeSlot)) + '</span><span>每套方案独立比较预算</span></div></section>' + renderBudget(summary) + '</div>';
  }

  function levelWords(level) {
    var counts = state.stats.levels[level] || [];
    var map = Object.create(null);
    counts.forEach(function (entry) { map[String(entry.id)] = entry; });
    var source = state.terms.filter(function (term) {
      if (Number(term.level) !== level) return false;
      if (term.active === false) return false;
      if (level === 3 && state.level3Filter !== 'all' && term.parentId !== state.level3Filter) return false;
      return true;
    });
    return source.map(function (term) {
      var entry = map[String(term.id)] || {};
      return { id: term.id, name: term.name, count: Number(entry.count) || 0, meta: term.attrs || {} };
    }).filter(function (entry) { return entry.count > 0; }).sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name, 'zh'); });
  }

  function statsBarRows(level) {
    if (state.offline) return '<div class="bar-empty">统计暂时无法读取，请恢复网络后重试。</div>';
    var list = levelWords(level);
    var raw = state.stats.levels[level] || [];
    var max = raw.reduce(function (value, entry) { return Math.max(value, Number(entry.count) || 0); }, 0);
    if (!list.length) return '<div class="bar-empty">还没有这一层的有效票数。登记并提交后，这里会按不同工号去重。</div>';
    return '<div class="bar-list">' + list.map(function (entry) { return '<div class="bar-row"><span class="bar-label" title="' + esc(entry.name) + '">' + esc(entry.name) + '</span><span class="bar-track"><span class="bar-fill" style="width:' + (max ? Math.max(3, entry.count / max * 100) : 0).toFixed(2) + '%"></span></span><strong class="bar-count">' + esc(String(entry.count)) + '</strong></div>'; }).join('') + '</div>';
  }

  function renderCloudList(words) {
    return words.length ? '<div class="cloud-list">' + words.map(function (word) { return '<button type="button" class="cloud-list-item" data-action="cloud-detail" data-term-id="' + esc(word.id) + '"><span>' + esc(word.name) + '</span><strong>' + esc(String(word.count)) + '人</strong></button>'; }).join('') + '</div>' : '';
  }

  function renderGroupCard(group, index) {
    var snapshot = parseMaybeJson(group.snapshot, {});
    var events = snapshotEvents(snapshot);
    var support = Number(group.supporters) || 0;
    var estimate = estimateValue(group.currentEstimate, snapshot.totalCents);
    var people = snapshot.people != null ? Number(snapshot.people) : state.quarter && state.quarter.people != null ? Number(state.quarter.people) : null;
    if (!Number.isFinite(people) || people < 0) people = null;
    var budget = cents(state.quarter && state.quarter.budgetCents);
    var over = estimate != null && budget != null && estimate > budget;
    return '<article class="group-card ' + (index === 0 ? 'is-leading' : '') + '"><div class="group-card-head"><div class="group-card-title"><span class="rank-badge">' + esc(String(group.rank || index + 1)) + '</span><h4>' + esc(text(group.title || snapshot.title, '完整方案 ' + (index + 1))) + '</h4></div><span class="group-support">' + esc(String(support)) + ' 人</span></div><div class="group-summary"><span>预计 ' + esc(formatMoney(estimate)) + '</span><span>' + esc(people == null ? '人数待配置' : String(people) + ' 人参加') + '</span>' + (over ? '<span class="tag tag--red">预计超额</span>' : '') + (group.tied ? '<span class="tag tag--orange">并列</span>' : '') + '</div>' + missingBadges(snapshot) + '<div class="group-events">' + events.slice(0, 4).map(function (event) { var line = snapshotEventText(event); return '<div class="group-event"><b>' + esc(line.time) + '</b> · ' + esc(line.plays.join('＋') || '玩法待补') + '<br />' + esc(line.items.join('、') || '项目待补') + '</div>'; }).join('') + '</div><div class="group-actions"><button type="button" class="button button--ghost" data-action="group-detail" data-group-index="' + index + '">查看详情</button><button type="button" class="button button--soft" data-action="adopt-group" data-group-index="' + index + '">采用此方案</button></div></article>';
  }

  function renderStats() {
    var root = byId('stats-content');
    if (!root) return;
    var activeWords = levelWords(state.activeLevel);
    var levelTitle = state.activeLevel === 1 ? '时间词' : state.activeLevel === 2 ? '玩法词' : '具体项目';
    root.innerHTML = '<div class="stats-toolbar"><div><div class="page-kicker">COLLECTIVE SIGNALS / ' + esc(workbenchTitle()) + '</div><h2 id="stats-title">大家的灵感，正在长成一朵云。</h2><p class="page-intro">支持人数以工号去重；同一人的两份方案只计一位支持者。多选项相加不会强行凑成100%。</p></div><div class="stats-switcher">' + [1, 2, 3].map(function (level) { return '<button type="button" class="stats-switch ' + (state.activeLevel === level ? 'is-active' : '') + '" data-action="stats-level" data-level="' + level + '">' + (level === 1 ? '时间' : level === 2 ? '玩法' : '项目') + '</button>'; }).join('') + '</div></div><div class="stats-top-grid"><article class="panel stats-card"><div class="panel-head"><div><h3>' + esc(levelTitle) + '支持人数</h3><p>与右侧词云使用同一份统计结果。</p></div><span class="tag tag--muted">' + esc(state.offline ? '暂不可读' : String(Number(state.stats.participants) || 0) + ' 人参与') + '</span></div>' + (state.activeLevel === 3 ? '<div class="level-filter-line"><label class="eyebrow" for="level3-filter">玩法筛选</label><select id="level3-filter" class="select-input" data-action="level3-filter"><option value="all">全部具体项目</option>' + getTerms(2).map(function (term) { return '<option value="' + esc(term.id) + '" ' + (term.id === state.level3Filter ? 'selected' : '') + '>' + esc(term.name) + '</option>'; }).join('') + '</select></div>' : '') + statsBarRows(state.activeLevel) + '</article><article class="panel stats-card cloud-card"><div class="panel-head"><div><h3>' + esc(levelTitle) + '灵感云</h3><p>缩小看是一朵云，放大可以读清每个真实词。</p></div><span class="tag tag--orange">动态布局</span></div><div id="cloud-mount" class="cloud-stage" aria-label="' + esc(levelTitle) + '词云"></div>' + renderCloudList(activeWords) + '</article></div><article class="panel groups-section"><div class="panel-head"><div><h3>热门完整方案</h3><p>按不同支持者人数排名；金额是提交时快照与当前参考估价的明确范围。</p></div><span class="tag tag--green">' + esc(state.offline ? '暂不可读' : String((state.stats.groups || []).length) + ' 套组合') + '</span></div><div class="group-list">' + ((state.offline ? '<div class="empty-state"><div><strong>统计暂时无法读取</strong><span>恢复网络后会显示团队提交的方案。</span></div></div>' : (state.stats.groups || []).length ? state.stats.groups.slice(0, 12).map(renderGroupCard).join('') : '<div class="empty-state"><div><strong>还没有正式方案</strong><span>第一份提交后，完整方案会在这里按组合归并。</span></div></div>')) + '</div></article>';
    var mount = byId('cloud-mount');
    if (mount && state.offline) {
      mount.innerHTML = '<div class="cloud-empty">统计暂时无法读取，恢复网络后重试</div>';
    } else if (mount && window.CloudRenderer) {
      window.CloudRenderer.render(mount, activeWords, { key: 'level-' + state.activeLevel + '-' + state.level3Filter, onWord: function (word) { showTermDetail(word.id); } });
    }
  }

  function renderHistory() {
    var root = byId('history-content');
    if (!root) return;
    root.innerHTML = '<div class="hero-row"><div><div class="page-kicker">REFERENCE SHELF / ' + esc(workbenchTitle()) + '</div><h2 id="history-title">历史参考，给当前安排一个坐标。</h2><p class="page-intro">这些记录用于了解过往活动的安排与金额；是否带入当前方案由你决定。</p></div><div class="hero-stamp"><span class="tag tag--muted">历史不产生当前投票</span></div></div>' + (state.offline ? '<div class="empty-state"><div><strong>历史参考暂时无法读取</strong><span>恢复网络后会显示可用的历史记录。</span></div></div>' : state.history.length ? '<div class="history-grid">' + state.history.map(function (entry, index) { var perPerson = historyPerPerson(entry); return '<article class="history-card"><div class="history-date">' + esc(formatDate(entry.date)) + '</div><h3>' + esc(text(entry.name, '历史活动')) + '</h3><p class="history-note">' + esc(publicHistoryNote(entry)) + '</p><div class="history-cost"><strong>' + esc(formatMoney(entry.totalCents)) + '</strong><span>记录总额</span></div><div class="history-meta"><span>' + esc(text(entry.people, '人数未知')) + ' 人</span><span>折算约 ' + esc(perPerson == null ? '不可计算' : formatMoney(perPerson) + '/人') + '</span></div><div class="history-card-actions"><button type="button" class="button button--ghost" data-action="history-detail" data-history-index="' + index + '">看费用结构</button><button type="button" class="button button--soft" data-action="adopt-history" data-history-index="' + index + '">带入整套参考</button></div></article>'; }).join('') + '</div>' : '<div class="empty-state"><div><strong>暂无历史参考</strong><span>当前工作台还没有可展示的历史活动记录。</span></div></div>');
  }

  function submissionForSlot(slot) {
    if (state.submissions && state.submissions[slot]) return state.submissions[slot];
    return state.me && Array.isArray(state.me.submissions) ? state.me.submissions.find(function (submission) { return Number(submission.slot) === slot; }) : null;
  }

  function renderMine() {
    var root = byId('mine-content');
    if (!root) return;
    if (!state.me) {
      root.innerHTML = '<div class="hero-row"><div><div class="page-kicker">YOUR DESK</div><h2 id="mine-title">先登记，再保存你的两套备选。</h2><p class="page-intro">登记只需要工号后三位和昵称。工号用于归并额度，不代表已经完成真实身份验证。</p></div><button type="button" class="button button--primary" data-action="open-register">登记参与</button></div><div class="empty-state"><div><strong>这是你的工作台</strong><span>未登记时可以浏览和模拟，正式提交需要先登记。</span><br /><button type="button" class="button button--soft" data-action="go-builder">先去模拟一套</button></div></div>';
      return;
    }
    var used = [1, 2].filter(function (slot) { return Boolean(submissionForSlot(slot)); }).length;
    root.innerHTML = '<div class="mine-header"><div><div class="page-kicker">YOUR DESK / ' + esc(text(state.me.nickname, '参与者')) + '</div><h2 id="mine-title">你的两张方案卡。</h2><p class="page-intro">草稿会自动保存；提交后仍可编辑并更新投票。两套备选各自比较预算，不会相加。</p></div><div class="quota-card"><div class="quota-dots"><span class="quota-dot ' + (used >= 1 ? 'is-used' : '') + '"></span><span class="quota-dot ' + (used >= 2 ? 'is-used' : '') + '"></span></div><div class="quota-copy"><strong>还可提交 ' + esc(String(Math.max(0, 2 - used))) + ' 份</strong><span>额度归属 ' + esc(text(state.quarter && state.quarter.name, '当前活动期')) + ' · 工号 ' + esc(text(state.me.code, '未显示')) + '</span></div></div></div><div class="my-slots">' + [1, 2].map(renderMineSlot).join('') + '</div><div class="mine-callout">登记使用的是团队内部信任制工号格式检查，页面不会声称已经验证操作者身份。提交成功后仍可继续编辑；保存修改会更新对应投票统计。</div>';
  }

  function renderMineSlot(slot) {
    var submission = submissionForSlot(slot);
    var draft = state.me && Array.isArray(state.me.drafts) ? state.me.drafts.find(function (entry) { return Number(entry.slot) === slot; }) : null;
    var plan = planForSlot(slot);
    var snapshot = submission ? parseMaybeJson(submission.snapshot, {}) : null;
    var estimate = estimatePlan(plan).totalCents;
    if (estimate == null && snapshot) estimate = snapshot.totalCents;
    var events = plan.events;
    return '<article class="my-slot ' + (submission ? 'is-submitted' : '') + '"><div class="slot-header"><h3>方案 ' + esc(String(slot)) + '</h3>' + (submission ? '<span class="tag tag--green">已提交 · 可编辑</span>' : draft ? '<span class="tag tag--orange">草稿已保存</span>' : '<span class="tag tag--muted">空白</span>') + '</div>' + (submission ? '<div class="submitted-banner">✓ 已计入当前投票 · 提交于 ' + esc(formatDate(submission.createdAt)) + '</div>' + missingBadges(snapshot) + '<div class="slot-details"><div class="slot-detail-row"><span>方案名称</span><strong>' + esc(text(plan.title || snapshot && snapshot.title, '未命名方案')) + '</strong></div><div class="slot-detail-row"><span>活动场次</span><strong>' + esc(String(events.length)) + ' 场</strong></div><div class="slot-detail-row"><span>预计总额</span><strong>' + esc(formatMoney(estimate)) + '</strong></div></div><div class="history-card-actions"><button type="button" class="button button--primary" data-action="edit-slot" data-slot="' + slot + '">编辑方案</button></div>' : '<div class="slot-placeholder"><div><strong>' + (draft ? esc(text(plan.title, '未命名草稿')) : '还没有方案') + '</strong><span>' + (draft ? esc(String(plan.events.length)) + ' 场活动 · ' + esc(formatMoney(estimate)) : '去做方案页拼一套自己的安排') + '</span><br /><button type="button" class="button button--soft" data-action="edit-slot" data-slot="' + slot + '">' + (draft ? '继续编辑' : '开始拼装') + '</button></div></div>') + '</article>';
  }

  function accountTable(rows, deleted) {
    return '<div class="registration-table-scroll"><table class="registration-table registration-table--accounts"><thead><tr><th>工号后三位</th><th>昵称</th><th>' + (deleted ? '已撤下方案' : '已提交方案') + '</th><th>状态</th><th>账号操作</th></tr></thead><tbody>' + (rows.length ? rows.map(function(row){
      var status = row.status || 'active', own = state.me && state.me.code === row.code;
      var button = function(operation,label,danger){return '<button type="button" class="button button--soft account-button ' + (danger?'account-delete':'') + '" data-action="account-action" data-code="' + esc(row.code) + '" data-operation="' + operation + '" ' + (own && ['ban','delete'].includes(operation)?'disabled title="不能停用当前登录的工号"':'') + '>' + label + '</button>';};
      var actions = deleted ? button('restore',row.restoreStatus==='banned'?'恢复（保留封禁）':'恢复账号',false) : button(status==='banned'?'unban':'ban',status==='banned'?'解封':'封号',false) + button('delete','删除账号',true);
      return '<tr><td><span class="employee-code">' + esc(row.code) + '</span></td><td>' + esc(row.nickname) + '</td><td><span class="tag ' + (row.submittedCount===2?'tag--green':row.submittedCount?'tag--orange':'tag--muted') + '">' + esc(String(row.submittedCount)) + ' 份</span></td><td><span class="tag ' + (status==='active'?'tag--green':status==='banned'?'tag--red':'tag--muted') + '">' + ({active:'正常',banned:'已封禁',deleted:'已删除'}[status]||'未知') + '</span></td><td><div class="account-actions">' + actions + '</div></td></tr>';
    }).join('') : '<tr><td colspan="5" class="registration-empty">' + (deleted?'暂无已删除账号':'暂时还没有人登记') + '</td></tr>') + '</tbody></table></div>';
  }

  function registrationPanel() {
    if (!state.isAdmin) return '';
    var data = state.adminRegistrations || {totalRegistered:0,submittedPeople:0,submittedPlans:0,rows:[]}, deleted = data.deletedRows || [];
    var quarter = state.quarter || DEFAULT_QUARTER;
    return '<section id="admin-registrations" class="panel registration-panel" aria-label="登记与提交情况"><div class="panel-head"><div><h3>登记与提交情况</h3><p>仅管理员可见。名单包含未删除的登记工号，提交数量按所选活动期统计。</p></div><span class="tag tag--orange">' + esc(quarter.name) + '</span></div><div class="registration-summary"><div><span>已登记人数</span><strong>' + esc(String(data.totalRegistered)) + '<small>人</small></strong></div><div><span>本期已提交人数</span><strong>' + esc(String(data.submittedPeople)) + '<small>人</small></strong></div><div><span>本期已提交方案</span><strong>' + esc(String(data.submittedPlans)) + '<small>份</small></strong></div></div>' + accountTable(data.rows,false) + '<p class="registration-note">每人每期最多两份，草稿和修改不增加份数。封号保留已有票数；删除会撤下所有活动期的方案、票数及留言，可在下方恢复。手机可横向滑动表格查看操作。</p><details class="deleted-accounts"><summary>已删除账号（' + deleted.length + '） · 可恢复</summary>' + accountTable(deleted,true) + '</details></section>';
  }

  function openAccountAction(code, operation) {
    if (!state.isAdmin || !state.adminRegistrations) return;
    if (state.accountAction && state.accountAction.busy) return;
    var rows = state.adminRegistrations.rows.concat(state.adminRegistrations.deletedRows || []);
    var account = rows.find(function(row){return row.code===code;}); if (!account) return;
    state.accountAction = {code:account.code,nickname:account.nickname,operation:operation,revision:account.revision || 0,busy:false};
    var labels = {ban:'封禁账号',unban:'解除封禁',delete:'删除账号（可恢复）',restore:'恢复账号'};
    var descriptions = {ban:'封禁后，该工号不能重新登记、提交方案、修改方案、补充词库或留言；已有方案和票数保留。旧登录会立即失效。',unban:'解封后，该工号可以重新登记登录。原有额度和记录保留，旧登录不会自动恢复。',delete:'该账号在所有活动期的方案、票数和留言将被隐藏，并从登记名单移入已删除账号。原记录保留，可由管理员恢复。共享词库不受影响，旧登录立即失效。',restore:account.restoreStatus==='banned'?'恢复后，原方案、票数和留言会重新显示。该账号删除前已封禁，恢复后仍保持封禁，可再单独解封。':'恢复后，该账号重新出现在登记名单，原方案、票数和留言会重新显示；需要重新登记登录。'};
    byId('account-action-title').textContent = labels[operation] || '账号操作';
    byId('account-action-description').textContent = descriptions[operation] || '';
    byId('account-action-target').textContent = account.code + ' · ' + account.nickname;
    byId('account-confirm-code').value = '';
    byId('account-confirm-field').hidden = operation !== 'delete';
    byId('account-action-error').textContent = '';
    var button = byId('account-action-confirm'); button.disabled = operation==='delete'; button.textContent = '确认' + ({ban:'封号',unban:'解封',delete:'删除账号',restore:'恢复'}[operation] || '操作');
    button.classList.toggle('account-confirm--danger',operation==='delete');
    openDialog('account-action-dialog');
  }

  async function confirmAccountAction() {
    var pending = state.accountAction; if (!state.isAdmin || !pending || pending.busy) return;
    var code = byId('account-confirm-code').value;
    if (pending.operation==='delete' && code!==pending.code) return;
    pending.busy = true; var button=byId('account-action-confirm'); button.disabled=true;
    try {
      var result=await api('/admin/participants/' + encodeURIComponent(pending.code),{method:'PATCH',body:JSON.stringify({action:pending.operation,revision:pending.revision,confirmCode:code})});
      closeDialog(byId('account-action-dialog')); state.accountAction=null;
      await loadState({silent:true});
      toast(pending.operation==='restore' && result.status==='banned'?'账号已恢复，仍保持封禁状态。':({ban:'账号已封禁，旧登录已失效。',unban:'账号已解封，请重新登记登录。',delete:'账号已删除，方案和票数已撤下；可在已删除账号中恢复。',restore:'账号及其方案和票数已恢复。'}[pending.operation]),'success');
    } catch(error) {
      if(error.status===409){closeDialog(byId('account-action-dialog'));state.accountAction=null;await loadState({silent:true});toast(error.message,'error');}
      else byId('account-action-error').textContent=error.message;
    } finally {pending.busy=false;if(state.accountAction===pending)button.disabled=pending.operation==='delete' && byId('account-confirm-code').value!==pending.code;}
  }

  function refreshRegistrationPanel() {
    var panel = byId('admin-registrations');
    if (!panel) return;
    if (!state.isAdmin) { panel.remove(); return; }
    var expanded = panel.querySelector('.deleted-accounts') && panel.querySelector('.deleted-accounts').open;
    var scrolls = Array.from(panel.querySelectorAll('.registration-table-scroll')).map(function(table){return {left:table.scrollLeft,top:table.scrollTop};});
    panel.outerHTML = registrationPanel();
    var replacement = byId('admin-registrations');
    if (expanded) replacement.querySelector('.deleted-accounts').open = true;
    replacement.querySelectorAll('.registration-table-scroll').forEach(function(table,index){if(scrolls[index]){table.scrollLeft=scrolls[index].left;table.scrollTop=scrolls[index].top;}});
  }

  function renderAdminTermRow(term) {
    var editing = state.termRenameId === String(term.id);
    var attrs = term.attrs || {};
    var descriptor = attrs.location || attrs.baseType || attrs.dayType || '属性待补';
    var name = editing ? '<div class="term-rename-wrap"><input class="text-input term-rename-input" type="text" maxlength="80" value="' + esc(term.name) + '" data-term-rename-id="' + esc(term.id) + '" aria-label="修改 ' + esc(term.name) + ' 的名称" /><div class="term-rename-actions"><button type="button" class="button button--soft" data-action="save-term-rename" data-term-id="' + esc(term.id) + '">保存</button><button type="button" class="text-button" data-action="cancel-term-rename">取消</button></div>' + (state.termRenameError ? '<small class="term-rename-error">' + esc(state.termRenameError) + '</small>' : '') + '</div>' : '<span class="term-admin-name">' + esc(term.name) + '<small>' + esc(descriptor) + '</small></span>';
    var rename = !editing && Number(term.level) <= 2 ? '<button type="button" class="button button--soft term-rename-button" data-action="start-term-rename" data-term-id="' + esc(term.id) + '">改名</button>' : '';
    return '<div class="term-admin-row' + (editing ? ' term-admin-row--renaming' : '') + '"><span class="term-level">L' + esc(String(term.level)) + '</span>' + name + '<div class="term-admin-actions">' + rename + '<button type="button" class="toggle ' + (term.active !== false ? 'is-on' : '') + '" data-action="toggle-term" data-term-id="' + esc(term.id) + '" aria-label="' + (term.active !== false ? '停用' : '启用') + ' ' + esc(term.name) + '"></button></div></div>';
  }

  function syncAdminTermFields(form) {
    if (!form || !form.elements.level) return;
    var level = Number(form.elements.level.value);
    form.querySelectorAll('[data-admin-field]').forEach(function (field) {
      var kind = field.getAttribute('data-admin-field');
      var visible = level === 3 || kind === 'dayType' && level === 1 || kind === 'baseType' && level === 2 || kind === 'indoorScale' && level === 2;
      field.classList.toggle('admin-field-hidden', !visible);
    });
    if (form.elements.parentId) form.elements.parentId.required = level === 3;
  }

  function adminTermAttrsFromForm(form) {
    var level = Number(form.elements.level.value);
    if (level === 1) return { dayType: form.elements.dayType.value };
    if (level === 2) {
      var baseType = form.elements.baseType.value || 'other';
      var attrs = { baseType: baseType };
      if (baseType === 'other') attrs.allowedDays = [form.elements.dayType.value];
      if (baseType === 'indoor' && form.elements.indoorScale && ['small', 'large'].indexOf(form.elements.indoorScale.value) >= 0) attrs.indoorScale = form.elements.indoorScale.value;
      return attrs;
    }
    var large = form.elements.largeIndoor.value === 'unknown' ? null : form.elements.largeIndoor.value === 'true';
    return { priceCents: form.elements.price.value === '' ? null : yuanToCents(form.elements.price.value), location: String(form.elements.location.value || '').trim(), largeIndoor: large, pricingMode: form.elements.pricingMode.value === 'per_event' ? 'per_event' : 'per_person' };
  }

  function startTermRename(termId) {
    if (!state.isAdmin) return;
    var term = getTerm(termId);
    if (!term || Number(term.level) > 2) return;
    state.termRenameId = String(term.id);
    state.termRenameError = '';
    renderAdmin();
    var input = Array.from(document.querySelectorAll('[data-term-rename-id]')).find(function (entry) { return entry.getAttribute('data-term-rename-id') === String(term.id); });
    if (input) { input.focus(); input.select(); }
  }

  async function saveTermRename(termId) {
    if (!state.isAdmin || state.termRenameId !== String(termId)) return;
    var term = getTerm(termId), input = Array.from(document.querySelectorAll('[data-term-rename-id]')).find(function (entry) { return entry.getAttribute('data-term-rename-id') === String(termId); });
    if (!term || !input) return;
    var name = String(input.value || '').trim();
    if (!name) { state.termRenameError = '名称不能为空。'; renderAdmin(); return; }
    try {
      await api('/admin/terms/' + encodeURIComponent(term.id), { method: 'PATCH', body: JSON.stringify({ name: name, version: Number(term.version) || 1 }) });
      state.termRenameId = ''; state.termRenameError = '';
      await loadState({ silent: true });
      toast('词条名称已更新。', 'success');
    } catch (error) {
      state.termRenameError = error.message;
      renderAdmin();
    }
  }

  function renderAdmin() {
    var root = byId('admin-content');
    if (!root) return;
    if (!state.isAdmin) {
      root.innerHTML = '<div class="hero-row"><div><div class="page-kicker">ADMIN CONSOLE</div><h2 id="admin-title">只给管理员的配置台。</h2><p class="page-intro">管理员凭据只在服务端环境校验。普通工号和昵称不能取得管理员权限。</p></div></div><div class="panel" style="max-width:440px"><div class="panel-head"><div><h3>管理员登录</h3><p>请输入服务端配置的管理员令牌。</p></div></div><form id="admin-login-form" class="admin-form"><label class="form-field"><span class="form-label">管理员令牌</span><input class="text-input" type="password" name="token" autocomplete="current-password" required /></label><div id="admin-login-error" class="form-error"></div><button class="button button--primary" type="submit">进入管理台</button></form></div>';
      return;
    }
    var quarter = state.quarter || DEFAULT_QUARTER;
    root.innerHTML = '<div class="hero-row"><div><div class="page-kicker">ADMIN CONSOLE / ' + esc(workbenchTitle()) + '</div><h2 id="admin-title">把活动期和共享词库守在同一处。</h2><p class="page-intro">停用词条不会删除已有提交快照。预算、人数出现首份提交后应视为锁定配置。</p></div><button type="button" class="button button--soft" data-action="admin-logout">退出管理员</button></div>' + registrationPanel() + '<div class="admin-grid"><article class="panel admin-panel"><div class="panel-head"><div><h3>当前活动期</h3><p>关闭投票后，普通提交接口也会停止接收。</p></div><span class="status-pill ' + (quarter.open === false ? 'status-pill--closed' : 'status-pill--open') + '">' + (quarter.open === false ? '已关闭' : '开放中') + '</span></div><form id="quarter-form" class="admin-form"><label class="form-field"><span class="form-label">当前活动期</span><select class="select-input" data-action="admin-quarter-select" aria-label="切换活动期">' + state.quarters.map(function (entry) { return '<option value="' + esc(entry.id) + '" ' + (entry.id === quarter.id ? 'selected' : '') + '>' + esc(entry.name) + '</option>'; }).join('') + '</select></label><label class="form-field"><span class="form-label">活动期名称</span><input class="text-input" name="name" value="' + esc(text(quarter.name)) + '" maxlength="50" required /></label><div class="form-row"><label class="form-field"><span class="form-label">预算（元）</span><input class="text-input" type="number" name="budget" min="0" step="0.01" value="' + esc(quarter.budgetCents == null ? '' : (Number(quarter.budgetCents) / 100).toFixed(2)) + '" required /></label><label class="form-field"><span class="form-label">预计人数</span><input class="text-input" type="number" name="people" min="1" step="1" value="' + esc(quarter.people == null ? '' : String(quarter.people)) + '" required /></label></div><label class="form-field"><span class="form-label">截止时间（可留空）</span><input class="text-input" type="datetime-local" name="deadline" value="' + esc(quarter.deadline ? String(quarter.deadline).slice(0, 16) : '') + '" /></label><div class="admin-actions"><button class="button button--primary" type="submit">保存活动期配置</button><button class="button button--soft" type="button" data-action="toggle-quarter">' + (quarter.open === false ? '重新开放投票' : '关闭投票') + '</button></div><div id="quarter-form-error" class="form-error"></div></form><div class="admin-export"><a class="button button--soft" href="' + API + '/admin/export?quarter=' + encodeURIComponent(quarter.id) + '&type=submissions" download>导出方案 CSV</a><a class="button button--soft" href="' + API + '/admin/export?quarter=' + encodeURIComponent(quarter.id) + '&type=stats" download>导出统计 CSV</a><a class="button button--soft" href="' + API + '/admin/export?quarter=' + encodeURIComponent(quarter.id) + '&type=budget" download>导出预算 CSV</a></div></article><article class="panel admin-panel"><div class="panel-head"><div><h3>共享词库启停与名称</h3><p>共有 ' + esc(String(state.terms.length)) + ' 个词条；L1 与 L2 可由管理员改名，已有分类属性由服务端维护。</p></div></div><form id="new-quarter-form" class="admin-form" style="margin-bottom:17px;padding-bottom:17px;border-bottom:1px solid var(--line)"><div class="form-label">新建活动期</div><div class="form-row"><label class="form-field"><span class="form-label">名称</span><input class="text-input" name="name" maxlength="60" placeholder="例如 下一期活动" required /></label><label class="form-field"><span class="form-label">预算（元）</span><input class="text-input" type="number" name="budget" min="0.01" step="0.01" required /></label></div><div class="form-row"><label class="form-field"><span class="form-label">预计人数</span><input class="text-input" type="number" name="people" min="1" step="1" required /></label><label class="form-field"><span class="form-label">截止时间（可留空）</span><input class="text-input" type="datetime-local" name="deadline" /></label></div><div id="new-quarter-form-error" class="form-error"></div><button class="button button--soft" type="submit">创建并切换</button></form><div class="term-admin-list">' + state.terms.map(renderAdminTermRow).join('') + '</div><form id="admin-term-form" class="admin-form" style="margin-top:17px;padding-top:17px;border-top:1px solid var(--line)"><div class="form-row"><label class="form-field"><span class="form-label">层级</span><select class="select-input" name="level" data-action="admin-term-level"><option value="1">1 · 时间</option><option value="2">2 · 玩法</option><option value="3">3 · 具体项目</option></select></label><label class="form-field"><span class="form-label">新词条名称</span><input class="text-input" name="name" maxlength="80" required /></label></div><div class="form-row"><label class="form-field" data-admin-field="parent"><span class="form-label">父级 ID（L3必填）</span><input class="text-input" name="parentId" maxlength="80" /></label><label class="form-field" data-admin-field="price"><span class="form-label" data-pricing-label>人均费用预估（元）</span><input class="text-input" type="number" name="price" min="0" step="0.01" placeholder="可填 0" /></label></div><div class="form-row"><label class="form-field" data-admin-field="pricing"><span class="form-label">计价方式</span><select class="select-input" name="pricingMode" data-action="pricing-mode"><option value="per_person">人均（按预计人数）</option><option value="per_event">每次（整场一次）</option></select></label><label class="form-field" data-admin-field="location"><span class="form-label">地点</span><input class="text-input" name="location" maxlength="120" /></label></div><div class="form-row"><label class="form-field" data-admin-field="baseType"><span class="form-label">基础类型</span><select class="select-input" name="baseType"><option value="other">其他</option><option value="travel">出游</option><option value="tea">下午茶</option><option value="dinner">晚餐</option><option value="indoor">室内活动</option></select></label><label class="form-field" data-admin-field="dayType"><span class="form-label">适用时段</span><select class="select-input" name="dayType"><option value="weekend">周末</option><option value="weekday">工作日</option></select></label></div><div class="form-row"><label class="form-field" data-admin-field="indoorScale"><span class="form-label">室内规模</span><select class="select-input" name="indoorScale"><option value="unknown">未指定</option><option value="small">小型室内</option><option value="large">大型室内</option></select></label><label class="form-field" data-admin-field="largeIndoor"><span class="form-label">大型室内项目</span><select class="select-input" name="largeIndoor"><option value="unknown">未知</option><option value="true">是</option><option value="false">否</option></select></label></div><div id="admin-term-form-error" class="form-error"></div><button class="button button--soft" type="submit">新增词条</button></form></article></div>';
    syncAdminTermFields(byId('admin-term-form'));
  }

  function renderAll() {
    renderHeader();
    document.querySelectorAll('[data-view]').forEach(function (button) { button.classList.toggle('is-active', button.getAttribute('data-view') === state.view); });
    document.querySelectorAll('.view').forEach(function (section) { section.classList.toggle('is-visible', section.id === 'view-' + state.view); });
    renderDashboard(); renderBuilder(); renderStats(); renderHistory(); renderMine(); renderAdmin();
  }

  function renderBackground() {
    renderHeader();
    renderDashboard(); renderStats(); renderMine();
    if (state.view === 'admin') refreshRegistrationPanel();
  }

  function markPlanChanged() {
    var slot = arguments.length && arguments[0] != null ? Number(arguments[0]) : state.activeSlot;
    var shouldRender = arguments.length < 2 || arguments[1] !== false;
    if (slot !== 1 && slot !== 2) slot = state.activeSlot;
    state.slotSeq[slot] += 1;
    state.slotDirty[slot] = true;
    state.saveError = '';
    syncSaveFlags();
    persistLocalDrafts();
    if (shouldRender) renderBuilder();
    scheduleDraftSave(slot);
  }

  function scheduleDraftSave(slot, delay) {
    if (!state.me || !state.quarter || (slot !== 1 && slot !== 2)) return;
    if (state.slotSaveTimers[slot]) window.clearTimeout(state.slotSaveTimers[slot]);
    state.slotSaveTimers[slot] = window.setTimeout(function () {
      state.slotSaveTimers[slot] = null;
      saveDraftSlot(slot);
    }, delay == null ? 720 : delay);
  }

  function planSignature(plan) {
    return JSON.stringify(normalizePlan(plan));
  }

  async function saveDraftSlot(slot) {
    if (!state.me || !state.quarter || (slot !== 1 && slot !== 2) || !state.slotDirty[slot]) return;
    if (state.slotSaving[slot]) { state.slotSaveQueued[slot] = true; return; }
    var requestToken = state.scopeToken;
    var quarterId = state.quarter.id;
    var sequence = state.slotSeq[slot];
    var plan = clonePlan(planForSlot(slot));
    var signature = planSignature(plan);
    var revision = Number(state.revisions[slot]) || 0;
    state.slotSaving[slot] = true;
    state.slotSaveQueued[slot] = false;
    state.saveError = '';
    syncSaveFlags();
    if (state.activeSlot === slot) renderBuilderAfterSave();
    try {
      var saved = await api('/drafts/' + slot, { method: 'PUT', body: JSON.stringify({ quarterId: quarterId, plan: plan, revision: revision }) });
      if (requestToken !== state.scopeToken || !state.quarter || state.quarter.id !== quarterId) return;
      state.revisions[slot] = Number(saved.revision) || state.revisions[slot];
      state.draftIds[slot] = saved.id || state.draftIds[slot];
      var unchanged = state.slotSeq[slot] === sequence && planSignature(planForSlot(slot)) === signature;
      state.slotDirty[slot] = !unchanged;
      state.saveError = '';
      persistLocalDrafts();
      if (!unchanged) scheduleDraftSave(slot, 0);
    } catch (error) {
      if (requestToken !== state.scopeToken) return;
      state.saveError = error.status === 409 ? '草稿版本发生冲突，请刷新后确认保留哪一版。' : error.message;
      if (error.status === 409) toast(state.saveError, 'error');
    } finally {
      if (requestToken !== state.scopeToken) return;
      state.slotSaving[slot] = false;
      state.slotSaveQueued[slot] = false;
      syncSaveFlags();
      if (state.slotDirty[slot] && !state.slotSaveTimers[slot] && !state.saveError) scheduleDraftSave(slot, 0);
      if (state.activeSlot === slot) renderBuilderAfterSave();
      renderMine();
    }
  }

  function ensureEvent(plan) {
    if (!plan.events.length) plan.events.push({ id: uuid(), timeId: '', playIds: [], items: [], sharedCents: 0 });
    return plan.events[plan.events.length - 1];
  }

  function addTerm(termId, eventId, toggleExisting) {
    var term = getTerm(termId);
    if (!term || !term.active) return;
    var plan = planForSlot(state.activeSlot);
    var event = eventId ? plan.events.find(function (entry) { return entry.id === eventId; }) : currentBuilderEvent();
    if (!event) event = currentBuilderEvent();
    var requiredPlay = term.level === 2 ? term.id : term.level === 3 ? term.parentId : null;
    if (requiredPlay && event.playIds.indexOf(requiredPlay) < 0 && event.playIds.length >= 3) { toast('每场活动最多选择3个玩法，请先取消一个。', 'error'); return; }
    if (term.level === 1) event.timeId = term.id;
    if (term.level === 2) {
      if (event.playIds.indexOf(term.id) < 0) event.playIds.push(term.id);
      else if (toggleExisting !== false) { event.playIds = event.playIds.filter(function (id) { return id !== term.id; }); event.items = event.items.filter(function (item) { var project = getTerm(item.termId); return project && project.parentId !== term.id; }); }
    }
    if (term.level === 3) {
      var existing = plan.events.some(function(entry){return entry.items.some(function(item){return canonicalTermId(item.termId) === term.id;});});
      if (existing) { toast('这个项目已在本套方案中选择，每个项目只能选一次。', 'error'); return; }
      event.items.push({ termId: term.id, quantity: 1 });
      if (term.parentId && event.playIds.indexOf(term.parentId) < 0) event.playIds.push(term.parentId);
    }
    state.activeEventId = event.id;
    markPlanChanged();
  }

  function findEvent(eventId) { return planForSlot(state.activeSlot).events.find(function (event) { return event.id === eventId; }); }

  function deleteEvent(eventId) {
    var plan = planForSlot(state.activeSlot);
    if (plan.events.length <= 1) {
      plan.events[0] = { id: uuid(), timeId: '', playIds: [], items: [], sharedCents: 0 };
    } else plan.events = plan.events.filter(function (event) { return event.id !== eventId; });
    markPlanChanged();
  }

  function copyEvent(eventId) {
    var plan = planForSlot(state.activeSlot);
    var index = plan.events.findIndex(function (event) { return event.id === eventId; });
    if (index < 0) return;
    var copy = clonePlan({ events: [plan.events[index]] }).events[0];
    copy.id = uuid();
    copy.items = [];
    plan.events.splice(index + 1, 0, copy);
    markPlanChanged();
  }

  function setPlanField(field, value) {
    planForSlot(state.activeSlot)[field] = String(value || '');
    markPlanChanged(state.activeSlot, false);
  }

  function openPreview(slot) {
    if (!state.me) { openRegister(); toast('先登记后才能正式提交；当前仍可继续模拟。', 'error'); return; }
    var plan = clonePlan(planForSlot(slot || state.activeSlot));
    if (!state.quarter) return;
    state.pendingPreview = { slot: slot || state.activeSlot, plan: plan };
    var content = byId('preview-content');
    if (content) content.innerHTML = '<div class="empty-state"><div><strong>正在核对费用和规则…</strong><span>服务端会再次检查工作日限制、项目完整度和预算。</span></div></div>';
    var submit = byId('preview-submit'); if (submit) submit.disabled = true;
    openDialog('preview-dialog');
    api('/preview', { method: 'POST', body: JSON.stringify({ quarterId: state.quarter.id, plan: plan }) }).then(function (data) {
      state.pendingPreview.result = data;
      renderPreview(data);
    }).catch(function (error) {
      if (content) content.innerHTML = '<div class="preview-issues"><strong>暂时无法完成预览</strong>' + esc(error.message) + '</div>';
      toast(error.message, 'error');
    });
  }

  function renderPreview(data) {
    var content = byId('preview-content');
    var submit = byId('preview-submit');
    if (!content) return;
    var snapshot = parseMaybeJson(data.snapshot, {});
    var events = Array.isArray(snapshot.events) ? snapshot.events : [];
    var issues = Array.isArray(data.issues) ? data.issues : [];
    var total = data.totalCents != null ? data.totalCents : snapshot.totalCents;
    var balance = data.balanceCents != null ? data.balanceCents : snapshot.balanceCents;
    var over = balance != null && balance < 0;
    var isUpdate = Boolean(state.pendingPreview && submissionForSlot(state.pendingPreview.slot));
    content.innerHTML = '<div class="preview-summary"><div class="preview-stat"><span>预计总额</span><strong class="' + (over ? 'is-over' : '') + '">' + esc(formatMoney(total)) + '</strong></div><div class="preview-stat"><span>' + (over ? '预计超额' : '预算余额') + '</span><strong class="' + (over ? 'is-over' : '') + '">' + esc(balance == null ? '待补充' : formatMoney(Math.abs(balance))) + '</strong></div><div class="preview-stat"><span>预计人均</span><strong>' + esc(total == null || !snapshot.people ? '待补充' : formatMoney(Math.round(total / snapshot.people))) + '</strong></div></div>' + missingBadges(snapshot) + '<div class="preview-events">' + events.map(function (event, index) { var line = snapshotEventText(event); var itemLines = snapshotItemLines(event, snapshot.people); return '<div class="preview-event"><div class="preview-event-head"><span>第' + (index + 1) + '场 · ' + esc(line.time) + '</span><strong>' + esc(formatMoney(event.totalCents)) + '</strong></div><div class="preview-event-items">' + esc(line.plays.join('＋') || '玩法待补') + '<br />' + esc(itemLines.join('、') || line.items.join('、') || '项目待补') + '</div></div>'; }).join('') + '</div>' + (issues.length ? '<div class="preview-issues"><strong>提交前需要处理</strong>' + issues.map(function (issue) { return '<div>· ' + esc(issue) + '</div>'; }).join('') + '</div>' : '<div class="tag tag--green" style="margin-top:13px">可以提交。缺少估价或地点会保留对应标签，超预算方案仍会标红保存。</div>') + '<p class="small muted" style="margin-top:13px">正式提交后仍可继续编辑；保存修改会更新对应投票统计。词库提交后不能修改。</p>';
    if (submit) { submit.disabled = issues.length > 0 || !state.me; submit.textContent = isUpdate ? '保存修改并更新投票' : '确认提交方案'; }
  }

  async function submitPreview() {
    if (!state.pendingPreview || !state.pendingPreview.result || !state.me || !state.quarter) return;
    var result = state.pendingPreview.result;
    if (Array.isArray(result.issues) && result.issues.length) return;
    var slot = state.pendingPreview.slot;
    var submission = submissionForSlot(slot);
    var key = state.pendingPreview.idempotencyKey || (state.pendingPreview.idempotencyKey = uuid());
    var requestToken = state.scopeToken;
    var sequence = state.slotSeq[slot];
    var signature = planSignature(state.pendingPreview.plan);
    var quarterId = state.quarter.id;
    var button = byId('preview-submit'); if (button) button.disabled = true;
    try {
      var body = { quarterId: quarterId, plan: normalizePlan(state.pendingPreview.plan), idempotencyKey: key };
      var path = '/submit';
      var method = 'POST';
      if (submission && submission.id) {
        path = '/submissions/' + encodeURIComponent(submission.id);
        method = 'PUT';
        body.revision = Number(submission.revision) || 0;
      } else body.slot = slot;
      await api(path, { method: method, body: JSON.stringify(body) });
      if (requestToken !== state.scopeToken || !state.quarter || state.quarter.id !== quarterId) return;
      var unchanged = state.slotSeq[slot] === sequence && planSignature(planForSlot(slot)) === signature;
      state.slotDirty[slot] = !unchanged;
      syncSaveFlags();
      persistLocalDrafts();
      if (!unchanged) scheduleDraftSave(slot, 0);
      closeDialog(byId('preview-dialog'));
      state.pendingPreview = null;
      toast(method === 'PUT' ? '方案修改已保存，投票统计已更新。' : '方案已提交，之后仍可继续编辑。', 'success');
      var preserveAfterSubmit = dirtySlots();
      if (preserveAfterSubmit.indexOf(slot) < 0) preserveAfterSubmit.push(slot);
      await loadState({ silent: true, quarterId: quarterId, preserveSlots: preserveAfterSubmit });
      navigate('mine');
    } catch (error) {
      if (button) button.disabled = false;
      toast(error.message, 'error');
    }
  }

  function adoptSnapshot(snapshot, title) {
    var source = parseMaybeJson(snapshot, {});
    var events = Array.isArray(source.events) ? source.events : [];
    var plan = { title: text(title || source.title, '采用的方案'), note: '采用完整方案后，请按当前词库估价重新核对。', events: events.map(function (event) {
      var timeId = event.timeId || (event.time && event.time.id) || '';
      var playIds = Array.isArray(event.playIds) ? event.playIds.map(function (id) { return typeof id === 'object' ? id.id : id; }) : (Array.isArray(event.plays) ? event.plays.map(function (play) { return play.id; }) : []);
      var items = Array.isArray(event.items) ? event.items.map(function (item) { return { termId: item.termId || item.id, quantity: Number(item.quantity) || 1 }; }).filter(function (item) { return item.termId; }) : [];
      return { id: uuid(), timeId: timeId, playIds: playIds, items: items, sharedCents: 0 };
    }) };
    if (!plan.events.length) plan.events = emptyPlan().events;
    state.plans[state.activeSlot] = normalizePlan(plan);
    markPlanChanged();
    navigate('builder');
    toast('已复制到方案 ' + state.activeSlot + '，请检查当前估价和规则。', 'success');
  }

  function showGroupDetail(index) {
    var group = index >= 0 ? (state.stats.groups && state.stats.groups[index]) : state.selectedGroup;
    if (!group) return;
    state.selectedGroup = group;
    var snapshot = parseMaybeJson(group.snapshot, {});
    var events = snapshotEvents(snapshot);
    var estimate = estimateValue(group.currentEstimate, snapshot.totalCents);
    var people = snapshot.people != null ? Number(snapshot.people) : state.quarter && state.quarter.people != null ? Number(state.quarter.people) : null;
    if (!Number.isFinite(people) || people < 0) people = null;
    var budget = cents(state.quarter && state.quarter.budgetCents);
    var balance = estimate == null || budget == null ? null : budget - estimate;
    var over = balance != null && balance < 0;
    var content = byId('detail-content');
    if (!content) return;
    content.innerHTML = '<div class="detail-lead"><div><div class="page-kicker">组合详情 · ' + esc(String(Number(group.supporters) || 0)) + ' 人支持</div><h2>' + esc(text(group.title || snapshot.title, '完整方案')) + '</h2><p class="muted small">支持者：' + esc(group.nicknames && group.nicknames.length ? group.nicknames.join('、') : '匿名') + '</p></div><span class="tag ' + (over ? 'tag--red' : 'tag--orange') + '">' + esc(over ? '预计超预算' : (group.tied ? '并列热门' : '当前热门')) + '</span></div>' + missingBadges(snapshot) + '<div class="detail-events">' + events.map(function (event, index) { var line = snapshotEventText(event); return '<div class="detail-event"><div class="detail-event-head"><strong>第' + (index + 1) + '场 · ' + esc(line.time) + '</strong><span>' + esc(formatMoney(event.totalCents)) + '</span></div><div class="detail-event-items">' + line.plays.concat(line.items).map(function (item) { return '<span>' + esc(item) + '</span>'; }).join('') + '</div></div>'; }).join('') + '</div><div class="detail-foot"><span>预计人数 <strong>' + esc(people == null ? '待配置' : String(people) + ' 人') + '</strong></span><span>预计总额 <strong class="' + (over ? 'is-over' : '') + '">' + esc(formatMoney(estimate)) + '</strong></span><span>' + (over ? '预计超额' : '预算余额') + ' <strong class="' + (over ? 'is-over' : '') + '">' + esc(balance == null ? '待补充' : formatMoney(Math.abs(balance))) + '</strong></span><span>提交时估价范围 <strong>' + esc(group.minCents != null && group.maxCents != null ? formatMoney(group.minCents) + ' – ' + formatMoney(group.maxCents) : '暂无') + '</strong></span></div>' + (group.key ? '<div id="comments-board" class="comments-board" data-combo-key="' + esc(group.key) + '"><div class="comments-loading">正在读取昵称留言…</div></div>' : '') + '<div class="modal-actions"><button type="button" class="button button--soft" data-action="close-modal">关闭</button><button type="button" class="button button--primary" data-action="adopt-selected-group">采用此方案</button></div>';
    openDialog('detail-dialog');
    if (group.key) loadComments(group.key);
  }

  async function loadComments(key) {
    var board = byId('comments-board');
    if (!board) return;
    try {
      var data = await api('/comments?quarter=' + encodeURIComponent(state.quarter && state.quarter.id || '') + '&key=' + encodeURIComponent(key));
      renderComments(Array.isArray(data.comments) ? data.comments : []);
    } catch (error) {
      var loading = board.querySelector('.comments-loading');
      if (loading) loading.textContent = '留言暂时无法读取';
    }
  }

  function renderComments(comments) {
    var board = byId('comments-board');
    if (!board) return;
    var key = board.getAttribute('data-combo-key') || '';
    board.innerHTML = '<div class="comments-head"><div><strong>昵称留言板</strong><span>聊聊你愿意保留的细节</span></div><span class="tag tag--muted">' + esc(String(comments.length)) + ' 条</span></div>' + (comments.length ? '<div class="comments-list">' + comments.map(function (comment) { return '<article class="comment-item"><div class="comment-top"><strong>' + esc(text(comment.nickname, '同事')) + '</strong><time>' + esc(formatDate(comment.createdAt)) + '</time></div><p>' + esc(comment.content) + '</p></article>'; }).join('') + '</div>' : '<div class="comments-empty">还没有留言，成为第一个留下细节的人。</div>') + (state.me ? '<form id="comment-form" class="comment-form"><textarea class="textarea-input" name="content" maxlength="500" placeholder="例如：希望保留集合方便、晚餐不要太晚" required></textarea><input type="hidden" name="comboKey" value="' + esc(key) + '" /><button class="button button--soft" type="submit">留下昵称留言</button><div id="comment-form-error" class="form-error"></div></form>' : '<div class="comments-hint">登记后可以留言；游客可以阅读，但不会参与方案形成。</div>');
  }

  function showTermDetail(termId) {
    var term = getTerm(termId);
    if (!term) return;
    var entry = (state.stats.levels[term.level] || []).find(function (item) { return String(item.id) === String(term.id); });
    var attrs = term.attrs || {};
    toast(term.name + ' · ' + (Number(entry && entry.count) || 0) + ' 人支持' + (attrs.location ? ' · ' + attrs.location : '') + (itemPrice(term) != null ? ' · ' + formatMoney(itemPrice(term)) + '/' + pricingUnit(term) : ''), 'success');
  }

  function showHistoryDetail(index) {
    var entry = state.history[index];
    if (!entry) return;
    state.selectedHistory = entry;
    var root = byId('history-detail-content');
    if (!root) return;
    var parts = Array.isArray(entry.parts) ? entry.parts : [];
    var perPerson = historyPerPerson(entry);
    root.innerHTML = '<div class="modal-kicker">历史参考</div><h2>' + esc(text(entry.name, '历史活动')) + '</h2><p class="modal-intro">' + esc(publicHistoryNote(entry)) + '</p><div class="history-meta"><span>' + esc(formatDate(entry.date)) + '</span><span>' + esc(text(entry.people, '人数未知')) + ' 人</span></div>' + (parts.length ? '<ul class="history-parts">' + parts.map(function (part) { return '<li class="history-part"><span>' + esc(part.name) + '</span><strong>' + esc(formatMoney(part.totalCents)) + '</strong></li>'; }).join('') + '</ul>' : '<div class="empty-state" style="margin-top:16px;min-height:120px">暂无分项记录</div>') + '<div class="detail-foot"><span>记录总额 <strong>' + esc(formatMoney(entry.totalCents)) + '</strong></span><span>折算参考 <strong>' + esc(perPerson == null ? '不可计算' : formatMoney(perPerson) + '/人') + '</strong></span></div><div class="modal-actions"><button type="button" class="button button--soft" data-action="close-modal">关闭</button><button type="button" class="button button--primary" data-action="adopt-selected-history">带入整套参考</button></div>';
    openDialog('history-dialog');
  }

  function adoptHistory(entry) {
    if (!entry) return;
    var plan = planForSlot(state.activeSlot), event = ensureEvent(plan);
    state.pendingBundle = { entry: entry, eventId: event.id };
    closeDialog(byId('history-dialog'));
    navigate('builder');
    prepareTermForm(null, entry);
    toast('请为参考活动选择玩法并补充当前可用的项目资料；历史记录不会被改写。', 'success');
  }

  function prepareTermForm(term, bundleEntry) {
    var form = byId('term-dialog-form');
    if (!form) return;
    var attrs = term && term.attrs ? term.attrs : {};
    form.reset();
    form.elements.mode.value = term ? 'update' : 'new';
    form.elements.termId.value = term ? term.id : '';
    form.elements.version.value = term ? String(term.version || 1) : '';
    form.elements.historyId.value = bundleEntry ? text(bundleEntry.id) : text(attrs.historyId);
    form.elements.pricingBasis.value = bundleEntry ? 'bundle' : (attrs.pricingBasis === 'bundle' ? 'bundle' : 'component');
    form.elements.pricingMode.value = attrs.pricingMode === 'per_event' ? 'per_event' : 'per_person';
    form.elements.level.value = term ? String(term.level) : '3';
    form.elements.name.value = term ? term.name : '';
    form.elements.parentId.innerHTML = '<option value="">选择所属玩法</option>' + getTerms(2).map(function (play) { return '<option value="' + esc(play.id) + '">' + esc(play.name) + '</option>'; }).join('');
    form.elements.parentId.value = term && term.parentId ? term.parentId : '';
    form.elements.price.value = attrs.priceCents == null ? '' : (Number(attrs.priceCents) / 100).toFixed(2);
    form.elements.location.value = attrs.location || '';
    form.elements.baseType.value = attrs.baseType || (term && term.parentId && getTerm(term.parentId) && getTerm(term.parentId).attrs.baseType) || 'other';
    form.elements.dayType.value = attrs.dayType || 'weekend';
    var parentTerm = form.elements.parentId.value ? getTerm(form.elements.parentId.value) : null;
    form.elements.largeIndoor.value = attrs.largeIndoor == null && parentTerm && parentTerm.attrs && parentTerm.attrs.indoorScale === 'small' ? 'false' : (attrs.largeIndoor == null ? 'unknown' : String(attrs.largeIndoor));
    form.elements.note.value = attrs.note || '';
    if (bundleEntry) {
      var bundleParent = text(bundleEntry.parentId || bundleEntry.playId || bundleEntry.activityTypeId || (Array.isArray(bundleEntry.playIds) ? bundleEntry.playIds[0] : '') || (bundleEntry.play && bundleEntry.play.id));
      var bundleParentTerm = bundleParent ? getTerm(bundleParent) : null;
      var bundlePerPerson = historyPerPerson(bundleEntry);
      form.elements.name.value = text(bundleEntry.name, '历史活动') + '（参考项目）';
      form.elements.parentId.value = bundleParent;
      form.elements.price.value = bundlePerPerson == null ? '' : (bundlePerPerson / 100).toFixed(2);
      form.elements.location.value = text(bundleEntry.location);
      form.elements.baseType.value = text(bundleEntry.baseType || bundleParentTerm && bundleParentTerm.attrs && bundleParentTerm.attrs.baseType, 'other');
      form.elements.largeIndoor.value = 'unknown';
      form.elements.pricingMode.value = 'per_person';
      form.elements.note.value = bundlePerPerson == null ? '参考活动可作为当前方案中的一个项目；未提供可计算的历史账单。' : '参考活动可作为当前方案中的一个项目；估价仅作参考。';
    }
    updatePricingLabel(form);
    byId('term-dialog-title').textContent = term ? '补齐「' + term.name + '」' : (bundleEntry ? '建立历史整套项目' : '补充一个新项目');
    var level = form.elements.level;
    level.disabled = Boolean(term);
    form.elements.name.readOnly = Boolean(term);
    form.elements.parentId.disabled = Boolean(term);
    form.elements.baseType.disabled = Boolean(term);
    form.elements.dayType.disabled = Boolean(term);
    form.elements.largeIndoor.disabled = Boolean(term);
    form.elements.pricingMode.disabled = Boolean(term);
    var error = byId('term-dialog-error'); if (error) error.textContent = '';
    openDialog('term-dialog');
  }

  function updatePricingLabel(form) {
    if (!form || !form.elements.pricingMode) return;
    var label = form.querySelector('[data-pricing-label]');
    if (label) label.textContent = form.elements.pricingMode.value === 'per_event' ? '每次费用预估（元）' : '人均费用预估（元）';
  }

  function termAttrsFromForm(form) {
    var level = Number(form.elements.level.value);
    var large = form.elements.largeIndoor.value === 'unknown' ? null : form.elements.largeIndoor.value === 'true';
    var parent = getTerm(form.elements.parentId.value);
    var baseType = form.elements.baseType.value;
    if (level === 2 && !baseType) baseType = 'other';
    if (level === 1) return { dayType: form.elements.dayType.value };
    if (level === 2) {
      var playAttrs = { baseType: baseType };
      if (baseType === 'other') playAttrs.allowedDays = [form.elements.dayType.value];
      return playAttrs;
    }
    var attrs = {
      priceCents: form.elements.price.value === '' ? null : yuanToCents(form.elements.price.value),
      location: String(form.elements.location.value || '').trim(),
      largeIndoor: large,
      pricingMode: form.elements.pricingMode.value === 'per_event' ? 'per_event' : 'per_person',
      note: String(form.elements.note.value || '').trim(),
      historyId: String(form.elements.historyId.value || '').trim() || undefined,
      pricingBasis: form.elements.pricingBasis.value === 'bundle' ? 'bundle' : 'component',
    };
    if (parent && parent.attrs && parent.attrs.baseType !== 'indoor') attrs.largeIndoor = null;
    return attrs;
  }

  async function handleSubmit(event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.id === 'register-form') {
      event.preventDefault();
      var code = String(form.elements.code.value || '').trim();
      var nickname = String(form.elements.nickname.value || '').trim();
      var error = byId('register-error');
      if (!/^\d{3}$/.test(code) || !nickname) { if (error) error.textContent = '工号必须是三位数字，昵称不能为空。'; return; }
      try {
        await api('/register', { method: 'POST', body: JSON.stringify({ code: code, nickname: nickname }) });
        closeDialog(byId('register-dialog')); toast('登录成功，正在读取你的方案额度。', 'success'); await loadState({ silent: true });
      } catch (failure) { if (error) error.textContent = failure.message; }
    }
    if (form.id === 'admin-login-form') {
      event.preventDefault();
      var loginError = byId('admin-login-error');
      try { await api('/admin/login', { method: 'POST', body: JSON.stringify({ token: String(form.elements.token.value || '') }) }); await loadState({ silent: true }); navigate('admin'); toast('管理员登录成功。', 'success'); } catch (failure) { if (loginError) loginError.textContent = failure.message; }
    }
    if (form.id === 'quarter-form') {
      event.preventDefault();
      var quarterError = byId('quarter-form-error');
      if (!state.quarter) return;
      try {
        await api('/admin/quarters/' + encodeURIComponent(state.quarter.id), { method: 'PATCH', body: JSON.stringify({ budgetCents: yuanToCents(form.elements.budget.value), people: Number(form.elements.people.value), deadline: localDeadline(form.elements.deadline.value) }) });
        await loadState({ silent: true }); toast('活动期配置已保存。', 'success');
      } catch (failure) { if (quarterError) quarterError.textContent = failure.message; }
    }
    if (form.id === 'term-dialog-form') {
      event.preventDefault();
      var dialogError = byId('term-dialog-error');
      var dialogLevel = Number(form.elements.level.value);
      var attrs = termAttrsFromForm(form);
      try {
        var termResponse = null;
        if (form.elements.mode.value === 'update') {
          await api('/terms/' + encodeURIComponent(form.elements.termId.value), { method: 'PATCH', body: JSON.stringify({ version: Number(form.elements.version.value) || 1, attrs: attrs }) });
        } else {
          termResponse = await api('/terms', { method: 'POST', body: JSON.stringify({ level: dialogLevel, name: String(form.elements.name.value || '').trim(), parentId: String(form.elements.parentId.value || '').trim() || undefined, attrs: attrs }) });
        }
        var createdTermId = form.elements.mode.value === 'update' ? (form.elements.termId.value || null) : (termResponse && termResponse.id) || null;
        var bundle = state.pendingBundle;
        closeDialog(byId('term-dialog')); state.pendingBundle = null; await loadState({ silent: true });
        if (bundle && createdTermId) {
          var bundlePlan = planForSlot(state.activeSlot), bundleEvent = bundlePlan.events.find(function (entry) { return entry.id === bundle.eventId; }) || ensureEvent(bundlePlan);
          bundleEvent.sharedCents = 0;
          var existingBundle = bundlePlan.events.some(function(e){return e.items.some(function(i){return i.termId === createdTermId;});});
          if (!existingBundle) bundleEvent.items.push({ termId: createdTermId, quantity: 1 });
          if (form.elements.parentId.value && bundleEvent.playIds.indexOf(form.elements.parentId.value) < 0) bundleEvent.playIds.push(form.elements.parentId.value);
          markPlanChanged();
          toast('历史整套项目已加入当前活动卡；没有叠加内部明细。', 'success');
        } else toast(form.elements.mode.value === 'update' ? '词条资料已补齐，已保留版本记录。' : '新词条已加入共享词库。', 'success');
      } catch (failure) { if (dialogError) dialogError.textContent = failure.message; }
    }
    if (form.id === 'admin-term-form') {
      event.preventDefault();
      var adminTermError = byId('admin-term-form-error');
      var adminLevel = Number(form.elements.level.value);
      var adminAttrs = adminTermAttrsFromForm(form);
      try {
        await api('/terms', { method: 'POST', body: JSON.stringify({ level: adminLevel, name: String(form.elements.name.value || '').trim(), parentId: String(form.elements.parentId.value || '').trim() || undefined, attrs: adminAttrs }) });
        form.reset(); syncAdminTermFields(form); await loadState({ silent: true }); toast('新词条已加入共享词库。', 'success');
      } catch (failure) { if (adminTermError) adminTermError.textContent = failure.message; }
    }
    if (form.id === 'new-quarter-form') {
      event.preventDefault();
      var newQuarterError = byId('new-quarter-form-error');
      try {
        var createdQuarter = await api('/admin/quarters', { method: 'POST', body: JSON.stringify({ name: String(form.elements.name.value || '').trim(), budgetCents: yuanToCents(form.elements.budget.value), people: Number(form.elements.people.value), deadline: localDeadline(form.elements.deadline.value) }) });
        var createdQuarterId = createdQuarter && (createdQuarter.id || createdQuarter.quarterId || (createdQuarter.quarter && createdQuarter.quarter.id));
        form.reset();
        await loadState({ silent: true, quarterId: createdQuarterId || undefined });
        toast('新活动期已创建并切换。', 'success');
      } catch (failure) { if (newQuarterError) newQuarterError.textContent = failure.message; }
    }
    if (form.id === 'comment-form') {
      event.preventDefault();
      var commentError = byId('comment-form-error');
      var content = String(form.elements.content.value || '').trim();
      var comboKey = String(form.elements.comboKey.value || '');
      if (!content) { if (commentError) commentError.textContent = '留言不能为空。'; return; }
      try {
        await api('/comments', { method: 'POST', body: JSON.stringify({ quarterId: state.quarter && state.quarter.id, key: comboKey, content: content }) });
        await loadComments(comboKey); toast('留言已显示在这套方案下。', 'success');
      } catch (failure) { if (commentError) commentError.textContent = failure.message; }
    }
  }

  async function handleClick(event) {
    var target = event.target.closest('[data-action], [data-view]');
    if (!target) return;
    var action = target.getAttribute('data-action');
    var view = target.getAttribute('data-view');
    if (view) { navigate(view); return; }
    if (action === 'open-register') { openRegister(); return; }
    if (action === 'continue-anonymous') { closeDialog(byId('register-dialog')); return; }
    if (action === 'close-modal') { closeDialog(target); return; }
    if (action === 'go-builder') { navigate('builder'); return; }
    if (action === 'go-stats') { navigate('stats'); return; }
    if (action === 'go-history') { navigate('history'); return; }
    if (action === 'slot') { var slot = Number(target.dataset.slot); if (slot === 1 || slot === 2) { state.activeSlot = slot; renderBuilder(); } return; }
    if (action === 'level') { goLibraryStep(Number(target.dataset.level) || 1); return; }
    if (action === 'library-next') { nextLibraryStep(); return; }
    if (action === 'library-back') { goLibraryStep(state.activeLevel - 1); return; }
    if (action === 'library-finish') { var activeCard = document.querySelector('.event-card[data-event-id="' + state.activeEventId + '"]'); if (activeCard) activeCard.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (action === 'choose-event') { state.activeEventId = target.dataset.eventId; state.activeLevel = 1; renderBuilder(); var library = document.querySelector('.library-panel'); if (library) library.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (action === 'library-play-filter') { state.level3PlayFilter = target.dataset.playId || 'all'; renderBuilder(); return; }
    if (action === 'add-term') { addTerm(target.dataset.termId, state.activeEventId); return; }
    if (action === 'open-term-form') { if (state.activeLevel === 1) { toast('时间词条由管理员维护，请选择已有时间。', 'error'); return; } if (!state.me) { openRegister(); toast('登记后才能补充共享词库；游客可以继续浏览和模拟。', 'error'); return; } prepareTermForm(null); return; }
    if (action === 'edit-term') { if (!state.me) { openRegister(); toast('登记后才能补齐共享词条。', 'error'); return; } prepareTermForm(getTerm(target.dataset.termId)); return; }
    if (action === 'add-event') { var addedEvent = { id: uuid(), timeId: '', playIds: [], items: [], sharedCents: 0 }; planForSlot(state.activeSlot).events.push(addedEvent); state.activeEventId = addedEvent.id; state.activeLevel = 1; markPlanChanged(); return; }
    if (action === 'remove-event') { deleteEvent(target.dataset.eventId); return; }
    if (action === 'copy-event') { copyEvent(target.dataset.eventId); return; }
    if (action === 'remove-play') { var eventForPlay = findEvent(target.dataset.eventId); if (eventForPlay) { eventForPlay.playIds = eventForPlay.playIds.filter(function (id) { return id !== target.dataset.playId; }); eventForPlay.items = eventForPlay.items.filter(function (item) { return getTerm(item.termId)?.parentId !== target.dataset.playId; }); markPlanChanged(); } return; }
    if (action === 'remove-item') { var eventForItem = findEvent(target.dataset.eventId); if (eventForItem) { eventForItem.items = eventForItem.items.filter(function (item) { return item.termId !== target.dataset.termId; }); markPlanChanged(); } return; }
    if (action === 'preview') { openPreview(Number(target.dataset.slot) || state.activeSlot); return; }
    if (action === 'submit-preview') { await submitPreview(); return; }
    if (action === 'stats-level') { state.activeLevel = Number(target.dataset.level) || 1; state.level3Filter = 'all'; renderStats(); return; }
    if (action === 'cloud-detail') { showTermDetail(target.dataset.termId); return; }
    if (action === 'group-detail') { showGroupDetail(Number(target.dataset.groupIndex)); return; }
    if (action === 'adopt-group') { var group = state.stats.groups[Number(target.dataset.groupIndex)]; if (group) adoptSnapshot(group.snapshot, group.title); return; }
    if (action === 'adopt-selected-group') { if (state.selectedGroup) adoptSnapshot(state.selectedGroup.snapshot, state.selectedGroup.title); closeDialog(target); return; }
    if (action === 'history-detail') { showHistoryDetail(Number(target.dataset.historyIndex)); return; }
    if (action === 'adopt-history') { adoptHistory(state.history[Number(target.dataset.historyIndex)]); return; }
    if (action === 'adopt-selected-history') { adoptHistory(state.selectedHistory); return; }
    if (action === 'edit-slot') { state.activeSlot = Number(target.dataset.slot) || 1; navigate('builder'); return; }
    if (action === 'submission-detail') { var submission = submissionForSlot(Number(target.dataset.slot)); if (submission) { state.activeSlot = Number(target.dataset.slot) || 1; navigate('builder'); } return; }
    if (action === 'account-action') { openAccountAction(target.dataset.code,target.dataset.operation); return; }
    if (action === 'confirm-account-action') { await confirmAccountAction(); return; }
    if (action === 'start-term-rename') { startTermRename(target.dataset.termId); return; }
    if (action === 'cancel-term-rename') { state.termRenameId = ''; state.termRenameError = ''; renderAdmin(); return; }
    if (action === 'save-term-rename') { await saveTermRename(target.dataset.termId); return; }
    if (action === 'admin-logout') { try { await api('/admin/logout', { method: 'POST', body: JSON.stringify({}) }); await loadState({ silent: true }); navigate('admin'); toast('已退出管理员。', 'success'); } catch (error) { toast(error.message, 'error'); } return; }
    if (action === 'toggle-quarter') { try { await api('/admin/quarters/' + encodeURIComponent(state.quarter.id), { method: 'PATCH', body: JSON.stringify({ open: state.quarter.open === false }) }); await loadState({ silent: true }); toast(state.quarter.open === false ? '投票已重新开放。' : '投票已关闭。', 'success'); } catch (error) { toast(error.message, 'error'); } return; }
    if (action === 'toggle-term') { var term = getTerm(target.dataset.termId); if (!term) return; try { await api('/admin/terms/' + encodeURIComponent(term.id), { method: 'PATCH', body: JSON.stringify({ active: term.active === false }) }); await loadState({ silent: true }); toast('词条状态已更新。', 'success'); } catch (error) { toast(error.message, 'error'); } return; }
  }

  function handleInput(event) {
    var target = event.target;
    var action = target.getAttribute('data-action');
    if (action === 'account-confirm-code') { var pending=state.accountAction; byId('account-action-confirm').disabled=!pending || pending.busy || target.value!==pending.code; return; }
    if (action === 'library-search') { state.librarySearch = target.value; renderBuilder(); var input = document.querySelector('[data-action="library-search"]'); if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } return; }
    if (action === 'plan-title' || action === 'plan-note') { setPlanField(action === 'plan-title' ? 'title' : 'note', target.value); return; }
    if (action === 'inflation') { state.inflation = Math.max(0, Math.min(100, Number(target.value) || 0)); renderBuilder(); return; }
  }

  function handleChange(event) {
    var target = event.target;
    var action = target.getAttribute('data-action');
    if (action === 'builder-event') { state.activeEventId = target.value; state.activeLevel = 1; state.level3PlayFilter = 'all'; renderBuilder(); return; }
    if (action === 'set-time') { var timeEvent = findEvent(target.dataset.eventId); if (timeEvent) { timeEvent.timeId = target.value; markPlanChanged(); } return; }
    if (action === 'pricing-mode') { updatePricingLabel(target.closest('form')); return; }
    if (action === 'admin-term-level') { syncAdminTermFields(target.closest('form')); return; }
    if (action === 'level3-filter') { state.level3Filter = target.value || 'all'; renderStats(); return; }
    if (action === 'admin-quarter-select') { if (target.value && target.value !== (state.quarter && state.quarter.id)) loadState({ quarterId: target.value }); return; }
  }

  function handleDragStart(event) {
    var target = event.target.closest('[data-term-id]');
    if (!target || !event.dataTransfer) return;
    event.dataTransfer.setData('text/plain', target.dataset.termId);
    event.dataTransfer.effectAllowed = 'copy';
  }

  function handleDragOver(event) {
    var zone = event.target.closest('[data-drop-event]');
    if (!zone) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    var card = zone.closest('.event-card'); if (card) card.classList.add('is-drop-target');
  }

  function handleDragLeave(event) {
    var card = event.target.closest('.event-card'); if (card && (!event.relatedTarget || !card.contains(event.relatedTarget))) card.classList.remove('is-drop-target');
  }

  function handleDrop(event) {
    var zone = event.target.closest('[data-drop-event]');
    if (!zone) return;
    event.preventDefault();
    var card = zone.closest('.event-card'); if (card) card.classList.remove('is-drop-target');
    if (event.dataTransfer) addTerm(event.dataTransfer.getData('text/plain'), zone.dataset.dropEvent, false);
  }

  function startPolling() {
    if (state.pollingTimer) window.clearInterval(state.pollingTimer);
    state.pollingTimer = window.setInterval(function () {
      if (document.visibilityState === 'hidden' || !state.quarter) return;
      loadState({ silent: true, background: true, quarterId: state.quarter.id, preserveSlots: dirtySlots() });
    }, 5000);
  }

  function init() {
    document.addEventListener('click', handleClick);
    document.addEventListener('submit', handleSubmit);
    document.addEventListener('input', handleInput);
    document.addEventListener('change', handleChange);
    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);
    var register = byId('register-trigger'); if (register) register.addEventListener('click', openRegister);
    var profile = byId('user-menu-trigger'); if (profile) profile.addEventListener('click', function () { navigate('mine'); });
    renderAll();
    loadState({ silent: true }).then(function () { startPolling(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
