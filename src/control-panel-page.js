/**
 * GUI 제어판 HTML — app-server.js가 그대로 응답으로 내려준다.
 * 의존성 없이 바닐라 JS(빌드 스텝 없음) — 프로젝트 전체의 "Node 표준
 * 모듈만 사용" 원칙과 일관성을 맞췄다.
 */

const PAGE_HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>국회 자막 모니터 — 제어판</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Malgun Gothic", sans-serif; margin: 0; background: #0f1420; color: #e6e8ee; }
  header { padding: 14px 24px; background: #171d2e; border-bottom: 1px solid #2a3350; display: flex; align-items: center; gap: 24px; position: sticky; top: 0; z-index: 10; }
  header h1 { margin: 0; font-size: 16px; white-space: nowrap; }
  nav { display: flex; gap: 4px; flex: 1; }
  nav button { background: none; border: none; color: #8a93ab; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  nav button.active { background: #2a3350; color: #fff; }
  #statusBadge { font-size: 12px; padding: 4px 10px; border-radius: 12px; background: #2a3350; }
  #statusBadge.running { background: #1e6b3f; color: #fff; }
  #monitorBtn { padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; }
  #monitorBtn.start { background: #27ae60; color: #fff; }
  #monitorBtn.stop { background: #c0392b; color: #fff; }
  main { padding: 24px; max-width: 1100px; margin: 0 auto; }
  .panel { display: none; }
  .panel.active { display: block; }
  .card { background: #171d2e; border-radius: 8px; padding: 20px 24px; margin-bottom: 16px; border: 1px solid #232a41; }
  .card h2 { font-size: 14px; margin: 0 0 14px 0; color: #c9cfdd; }
  label { display: block; font-size: 12px; color: #8a93ab; margin-bottom: 4px; }
  input[type=text], input[type=number], select { width: 100%; background: #0f1420; border: 1px solid #2a3350; color: #e6e8ee; padding: 8px 10px; border-radius: 6px; font-size: 13px; }
  input[type=checkbox] { width: auto; margin-right: 6px; }
  .row { display: flex; gap: 12px; margin-bottom: 12px; align-items: end; }
  .row > div { flex: 1; }
  .grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { text-align: left; padding: 6px 8px; font-size: 13px; border-bottom: 1px solid #232a41; }
  th { color: #8a93ab; font-weight: 500; font-size: 12px; }
  .btn { background: #2a3350; color: #e6e8ee; border: none; padding: 7px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .btn.primary { background: #2f6fed; color: #fff; }
  .btn.danger { background: #7a2b2b; color: #fff; }
  .btn.small { padding: 4px 8px; font-size: 12px; }
  .group-card { border: 1px solid #232a41; border-radius: 8px; padding: 14px 16px; margin-bottom: 12px; background: #0f1420; }
  .group-head { display: flex; gap: 10px; margin-bottom: 10px; }
  .group-head input, .group-head select { flex: 1; }
  .patterns { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .chip { background: #2a3350; padding: 4px 8px; border-radius: 12px; font-size: 12px; display: flex; align-items: center; gap: 6px; }
  .chip button { background: none; border: none; color: #8a93ab; cursor: pointer; font-size: 13px; line-height: 1; padding: 0; }
  .pattern-input { display: flex; gap: 6px; }
  .pattern-input input { flex: 1; }
  .banner { padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 14px; display: none; }
  .banner.ok { background: #1e6b3f; display: block; }
  .banner.err { background: #7a2b2b; display: block; }
  .hit { background: #171d2e; border: 1px solid #232a41; border-left: 4px solid #3498db; border-radius: 6px; padding: 12px 16px; margin-bottom: 10px; }
  .hit.high { border-left-color: #e74c3c; }
  .hit .meta { font-size: 12px; color: #8a93ab; margin-bottom: 6px; }
  .hit .kw { display: inline-block; background: #2a3350; padding: 1px 8px; border-radius: 10px; font-size: 12px; margin-right: 6px; }
  .hit .ctx { font-size: 13px; color: #8a93ab; margin-top: 6px; white-space: pre-line; }
  .hit img { display: block; margin-top: 8px; max-width: 480px; max-height: 270px; border-radius: 4px; border: 1px solid #2a3350; }
  .log-line { font-family: "Consolas", monospace; font-size: 12px; padding: 3px 0; border-bottom: 1px solid #1a2033; }
  .log-line.error { color: #ff8080; }
  .log-line .t { color: #6b7593; margin-right: 8px; }
  .empty { color: #6b7593; padding: 20px; text-align: center; font-size: 13px; }
  .hint { font-size: 12px; color: #6b7593; margin-top: -8px; margin-bottom: 14px; }
</style>
</head>
<body>
<header>
  <h1>국회 자막 모니터</h1>
  <nav>
    <button data-tab="sessions" class="active">세션 관리</button>
    <button data-tab="keywords">키워드 관리</button>
    <button data-tab="monitor">모니터링</button>
    <button data-tab="logs">로그</button>
  </nav>
  <span id="statusBadge">중지됨</span>
  <button id="monitorBtn" class="start">감시 시작</button>
</header>

<main>
  <div id="banner" class="banner"></div>

  <section id="panel-sessions" class="panel active">
    <div class="card">
      <h2>전역 설정</h2>
      <div class="grid4">
        <div>
          <label><input type="checkbox" id="cfgHeadless" /> 헤드리스 모드</label>
          <div class="hint" style="margin:4px 0 0">끄면 브라우저 창이 보입니다 (시연용 기본값)</div>
        </div>
        <div>
          <label>확정 대기(ms)</label>
          <input type="number" id="cfgSettleMs" value="1800" />
        </div>
        <div>
          <label>watchdog 대기(ms)</label>
          <input type="number" id="cfgWatchdogMs" value="300000" />
        </div>
        <div>
          <label>회의당 캡처 상한</label>
          <input type="number" id="cfgMaxShots" value="200" />
        </div>
      </div>
      <div class="row">
        <div>
          <label>키워드 재알림 쿨다운(ms)</label>
          <input type="number" id="cfgCooldownMs" value="60000" />
        </div>
      </div>
    </div>

    <div class="card">
      <h2>감시 세션 (상임위)</h2>
      <table id="sessionTable">
        <thead><tr><th style="width:25%">이름</th><th>URL</th><th style="width:60px"></th></tr></thead>
        <tbody></tbody>
      </table>
      <button class="btn" id="addSessionBtn">+ 세션 추가</button>
    </div>

    <button class="btn primary" id="saveConfigBtn">설정 저장</button>
  </section>

  <section id="panel-keywords" class="panel">
    <div class="card">
      <h2>키워드 그룹</h2>
      <div class="hint">AI 자막은 고유명사를 자주 틀립니다. 동의어·약칭·띄어쓰기 변형을 최대한 많이 추가하세요.</div>
      <div id="groupList"></div>
      <button class="btn" id="addGroupBtn">+ 그룹 추가</button>
    </div>
    <button class="btn primary" id="saveKeywordsBtn">키워드 저장</button>
  </section>

  <section id="panel-monitor" class="panel">
    <div class="card">
      <h2>세션 상태</h2>
      <div id="sessionStatusList" class="empty">감시가 시작되지 않았습니다.</div>
    </div>
    <div class="card">
      <h2>실시간 키워드 히트</h2>
      <div id="hitList" class="empty">아직 히트가 없습니다.</div>
    </div>
  </section>

  <section id="panel-logs" class="panel">
    <div class="card">
      <h2>실시간 로그</h2>
      <div id="logList" class="empty">로그가 없습니다.</div>
    </div>
  </section>
</main>

<script>
(function () {
  // ── 공통 유틸 ──────────────────────────────────────────────
  function $(sel) { return document.querySelector(sel); }
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    (children || []).forEach((c) => node.appendChild(c));
    return node;
  }
  function showBanner(msg, isError) {
    const b = $('#banner');
    b.textContent = msg;
    b.className = 'banner ' + (isError ? 'err' : 'ok');
    setTimeout(() => { b.className = 'banner'; }, 4000);
  }
  async function api(path, opts) {
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  // ── 탭 전환 ──────────────────────────────────────────────
  document.querySelectorAll('nav button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('nav button').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $('#panel-' + btn.dataset.tab).classList.add('active');
    });
  });

  // ── 세션 관리 ──────────────────────────────────────────────
  let sessions = [];

  function renderSessions() {
    const tbody = $('#sessionTable tbody');
    tbody.innerHTML = '';
    sessions.forEach((s, i) => {
      const nameInput = el('input', { type: 'text', value: s.name || '' });
      nameInput.addEventListener('input', () => { sessions[i].name = nameInput.value; });
      const urlInput = el('input', { type: 'text', value: s.url || '', placeholder: 'https://assembly.webcast.go.kr/...' });
      urlInput.addEventListener('input', () => { sessions[i].url = urlInput.value; });
      const delBtn = el('button', { class: 'btn danger small', text: '삭제', onclick: () => { sessions.splice(i, 1); renderSessions(); } });
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [nameInput]),
        el('td', {}, [urlInput]),
        el('td', {}, [delBtn]),
      ]));
    });
  }

  $('#addSessionBtn').addEventListener('click', () => {
    sessions.push({ name: '', url: '' });
    renderSessions();
  });

  $('#saveConfigBtn').addEventListener('click', async () => {
    const config = {
      sessions: sessions.map((s) => ({ name: (s.name || '').trim(), url: (s.url || '').trim() })),
      headless: $('#cfgHeadless').checked,
      settleMs: Number($('#cfgSettleMs').value) || 1800,
      watchdogIdleMs: Number($('#cfgWatchdogMs').value) || 300000,
      maxShotsPerSession: Number($('#cfgMaxShots').value) || 200,
      cooldownMs: Number($('#cfgCooldownMs').value) || 60000,
    };
    try {
      await api('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      showBanner('설정이 저장되었습니다.');
    } catch (e) {
      showBanner('저장 실패: ' + e.message, true);
    }
  });

  async function loadConfig() {
    const cfg = await api('/api/config');
    sessions = cfg.sessions || [];
    $('#cfgHeadless').checked = Boolean(cfg.headless);
    $('#cfgSettleMs').value = cfg.settleMs ?? 1800;
    $('#cfgWatchdogMs').value = cfg.watchdogIdleMs ?? 300000;
    $('#cfgMaxShots').value = cfg.maxShotsPerSession ?? 200;
    $('#cfgCooldownMs').value = cfg.cooldownMs ?? 60000;
    renderSessions();
  }

  // ── 키워드 관리 ──────────────────────────────────────────────
  let groups = [];

  function renderGroups() {
    const list = $('#groupList');
    list.innerHTML = '';
    if (groups.length === 0) {
      list.appendChild(el('div', { class: 'empty', text: '등록된 키워드 그룹이 없습니다.' }));
    }
    groups.forEach((g, gi) => {
      const labelInput = el('input', { type: 'text', placeholder: '그룹명 (예: 기관명)', value: g.label || '' });
      labelInput.addEventListener('input', () => { groups[gi].label = labelInput.value; });
      const deptInput = el('input', { type: 'text', placeholder: '담당부서', value: g.dept || '' });
      deptInput.addEventListener('input', () => { groups[gi].dept = deptInput.value; });
      const prioritySelect = el('select', {});
      ['normal', 'high'].forEach((p) => {
        const opt = el('option', { value: p, text: p === 'high' ? '높음' : '보통' });
        if (g.priority === p) opt.selected = true;
        prioritySelect.appendChild(opt);
      });
      prioritySelect.addEventListener('change', () => { groups[gi].priority = prioritySelect.value; });
      const delGroupBtn = el('button', { class: 'btn danger small', text: '그룹 삭제', onclick: () => { groups.splice(gi, 1); renderGroups(); } });

      const patternsDiv = el('div', { class: 'patterns' });
      (g.patterns || []).forEach((pat, pi) => {
        patternsDiv.appendChild(el('span', { class: 'chip' }, [
          el('span', { text: pat }),
          el('button', { text: '×', onclick: () => { groups[gi].patterns.splice(pi, 1); renderGroups(); } }),
        ]));
      });

      const patInput = el('input', { type: 'text', placeholder: '동의어/약칭 추가 후 Enter (예: 건보공단)' });
      patInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && patInput.value.trim()) {
          ev.preventDefault();
          if (!groups[gi].patterns) groups[gi].patterns = [];
          groups[gi].patterns.push(patInput.value.trim());
          patInput.value = '';
          renderGroups();
        }
      });

      list.appendChild(el('div', { class: 'group-card' }, [
        el('div', { class: 'group-head' }, [labelInput, deptInput, prioritySelect, delGroupBtn]),
        patternsDiv,
        el('div', { class: 'pattern-input' }, [patInput]),
      ]));
    });
  }

  $('#addGroupBtn').addEventListener('click', () => {
    groups.push({ label: '', dept: '', priority: 'normal', patterns: [] });
    renderGroups();
  });

  $('#saveKeywordsBtn').addEventListener('click', async () => {
    try {
      const result = await api('/api/keywords', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groups }) });
      showBanner(
        result.reloaded
          ? '키워드가 저장되고, 실행 중인 감시에 즉시 반영되었습니다 (' + result.groupCount + '개 그룹).'
          : '키워드가 저장되었습니다.',
      );
    } catch (e) {
      showBanner('저장 실패: ' + e.message, true);
    }
  });

  async function loadKeywords() {
    const kw = await api('/api/keywords');
    groups = kw.groups || [];
    renderGroups();
  }

  // ── 감시 시작/중지 ──────────────────────────────────────────────
  function applyStatus(status) {
    const badge = $('#statusBadge');
    const btn = $('#monitorBtn');
    if (status.running) {
      badge.textContent = '실행 중 (' + status.sessions.length + '개 세션)';
      badge.classList.add('running');
      btn.textContent = '감시 중지';
      btn.className = 'stop';
    } else {
      badge.textContent = '중지됨';
      badge.classList.remove('running');
      btn.textContent = '감시 시작';
      btn.className = 'start';
    }
    const list = $('#sessionStatusList');
    if (status.sessions.length === 0) {
      list.className = 'empty';
      list.textContent = '감시가 시작되지 않았습니다.';
    } else {
      list.className = '';
      list.innerHTML = '';
      status.sessions.forEach((s) => list.appendChild(el('div', { text: '● ' + s.name })));
    }
  }

  $('#monitorBtn').addEventListener('click', async () => {
    const btn = $('#monitorBtn');
    btn.disabled = true;
    try {
      if (btn.textContent === '감시 시작') {
        const status = await api('/api/monitor/start', { method: 'POST' });
        applyStatus(status);
        showBanner('감시를 시작했습니다.');
      } else {
        const status = await api('/api/monitor/stop', { method: 'POST' });
        applyStatus(status);
        showBanner('감시를 중지했습니다.');
      }
    } catch (e) {
      showBanner(e.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // ── 히트/로그 실시간 스트림 ──────────────────────────────────────────────
  function renderHit(hit) {
    const list = $('#hitList');
    if (list.className === 'empty') { list.className = ''; list.innerHTML = ''; }
    const card = el('div', { class: 'hit' + (hit.priority === 'high' ? ' high' : '') });
    card.appendChild(el('div', { class: 'meta', text: '[' + hit.session + '] ' + hit.videoTimeFormatted }));
    const kw = el('span', { class: 'kw', text: hit.group });
    card.appendChild(kw);
    card.appendChild(document.createTextNode(hit.keyword));
    const ctxText = [...(hit.contextBefore || []), '▶ ' + hit.text, ...(hit.contextAfter || [])].join('\\n');
    const ctx = el('div', { class: 'ctx' });
    ctx.textContent = ctxText;
    card.appendChild(ctx);
    if (hit.screenshotPath) {
      const filename = hit.screenshotPath.split(/[\\\\/]/).pop();
      card.appendChild(el('img', { src: '/shots/' + encodeURIComponent(filename), alt: '캡처' }));
    }
    list.prepend(card);
  }

  function renderLog(entry) {
    const list = $('#logList');
    if (list.className === 'empty') { list.className = ''; list.innerHTML = ''; }
    const time = new Date(entry.at || Date.now()).toLocaleTimeString('ko-KR', { hour12: false });
    const line = el('div', { class: 'log-line' + (entry.level === 'error' ? ' error' : '') });
    line.appendChild(el('span', { class: 't', text: time }));
    line.appendChild(document.createTextNode(entry.message || ''));
    list.prepend(line);
    // 너무 쌓이면 오래된 것부터 정리 (DOM 메모리 방지)
    while (list.children.length > 500) list.removeChild(list.lastChild);
  }

  function connectEvents() {
    const es = new EventSource('/events');
    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'init') {
        applyStatus(msg.status);
        (msg.events || []).forEach((e) => {
          if (e.type === 'hit') renderHit(e.payload);
          else if (e.type === 'log') renderLog(e.payload);
        });
      } else if (msg.type === 'hit') {
        renderHit(msg.payload);
      } else if (msg.type === 'log') {
        renderLog(msg.payload);
      } else if (msg.type === 'status') {
        applyStatus(msg.payload);
      }
    };
    es.onerror = () => { /* 브라우저가 자동 재연결 시도함 */ };
  }

  // ── 초기화 ──────────────────────────────────────────────
  Promise.all([loadConfig(), loadKeywords(), api('/api/monitor/status').then(applyStatus)])
    .catch((e) => showBanner('초기 로드 실패: ' + e.message, true));
  connectEvents();
})();
</script>
</body>
</html>`;

module.exports = { PAGE_HTML };
