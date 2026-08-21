/**
 * GUI 제어판 HTML — app-server.js가 그대로 응답으로 내려준다.
 * 의존성 없이 바닐라 JS(빌드 스텝 없음) — 프로젝트 전체의 "Node 표준
 * 모듈만 사용" 원칙과 일관성을 맞췄다.
 */

const PAGE_HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>국캐치 — 제어판</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet" />
<style>
  /* ── 디자인 토큰 (DESIGN-cal.md) ────────────────────────────────────
     Cal.com 디자인 시스템. 흰 캔버스 + 근접-검정 CTA + 연회색 카드.
     색은 전부 여기서만 정의한다 — 나중에 팔레트만 갈아끼울 수 있게.

     원본 스펙은 마케팅 페이지용이라 섹션 리듬이 96px인데, 제어판은
     정보 밀도가 높은 앱 UI라 그대로 쓰면 스크롤만 길어진다. 카드 간격은
     spacing.lg(24px), 카드 내부 여백은 spacing.xl(32px)로 조였다.
     그 외 색·타이포·라운드·컴포넌트 규칙은 스펙 그대로 따른다.

     폰트는 Inter를 CDN에서 받되 시스템 스택으로 폴백한다. 이 도구는
     회의 중 오프라인에서도 떠야 하는데, Windows의 Segoe UI가 Inter와
     성격이 가까워 폰트를 못 받아도 레이아웃이 깨지지 않는다. */
  :root {
    /* colors */
    --primary: #111111;
    --primary-active: #242424;
    --primary-disabled: #e5e7eb;
    --ink: #111111;
    --body: #374151;
    --muted: #6b7280;
    --muted-soft: #898989;
    --hairline: #e5e7eb;
    --hairline-soft: #f3f4f6;
    --canvas: #ffffff;
    --surface-soft: #f8f9fa;
    --surface-card: #f5f5f5;
    --surface-strong: #e5e7eb;
    --on-primary: #ffffff;
    --brand-accent: #3b82f6;
    --success: #10b981;
    --warning: #f59e0b;
    --error: #ef4444;
    --badge-violet: #8b5cf6;

    /* rounded */
    --r-sm: 6px;
    --r-md: 8px;
    --r-lg: 12px;
    --r-pill: 9999px;

    /* spacing */
    --s-xxs: 4px;
    --s-xs: 8px;
    --s-sm: 12px;
    --s-md: 16px;
    --s-lg: 24px;
    --s-xl: 32px;

    /* type */
    --font-ui: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", Roboto, sans-serif;
    --font-code: "JetBrains Mono", ui-monospace, Consolas, monospace;

    /* elevation — 스펙의 soft/modern 두 단계만 쓴다 */
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
  }

  * { box-sizing: border-box; }

  body {
    font-family: var(--font-ui);
    font-size: 16px;
    line-height: 1.5;
    margin: 0;
    background: var(--canvas);
    color: var(--body);
    -webkit-font-smoothing: antialiased;
  }

  /* ── top-nav (64px, 흰 캔버스, hairline 마감) ────────────────────── */
  header {
    height: 64px;
    padding: 0 var(--s-lg);
    background: var(--canvas);
    border-bottom: 1px solid var(--hairline);
    display: flex;
    align-items: center;
    gap: var(--s-lg);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  header h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.3px;
    color: var(--ink);
    white-space: nowrap;
  }

  /* nav-pill-group — 스펙의 시그니처 컴포넌트(pill 안의 pill) */
  nav {
    display: flex;
    gap: var(--s-xxs);
    flex: 1;
    background: var(--surface-soft);
    border-radius: var(--r-pill);
    padding: 6px;
    width: fit-content;
    flex-grow: 0;
  }
  nav button {
    background: transparent;
    border: none;
    color: var(--muted);
    padding: var(--s-xs) 14px;
    border-radius: var(--r-md);
    cursor: pointer;
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
  }
  nav button.active {
    background: var(--canvas);
    color: var(--ink);
    box-shadow: var(--shadow-sm);
  }

  .spacer { flex: 1; }

  #statusBadge {
    font-size: 13px;
    font-weight: 500;
    padding: var(--s-xxs) var(--s-sm);
    border-radius: var(--r-pill);
    background: var(--surface-card);
    color: var(--muted);
    white-space: nowrap;
  }
  #statusBadge.running {
    background: color-mix(in srgb, var(--success) 12%, white);
    color: #047857;
  }

  /* ── 버튼 ────────────────────────────────────────────────────────
     스펙상 액션 레이어는 모노크롬이다. 다만 "감시 중지"는 되돌리기
     번거로운 동작이라 secondary 형태에 error 색 테두리/글자만 입혔다 —
     배경까지 빨갛게 칠하면 스펙의 모노크롬 원칙에서 너무 멀어진다. */
  #monitorBtn, .btn {
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    line-height: 1;
    border-radius: var(--r-md);
    cursor: pointer;
    padding: var(--s-sm) 20px;
    height: 40px;
    border: 1px solid transparent;
    white-space: nowrap;
    transition: background-color 0.12s ease;
  }
  #monitorBtn.start { background: var(--primary); color: var(--on-primary); }
  #monitorBtn.start:active { background: var(--primary-active); }
  #monitorBtn.stop {
    background: var(--canvas);
    color: var(--error);
    border-color: var(--error);
  }
  .btn {
    background: var(--canvas);
    color: var(--ink);
    border-color: var(--hairline);
  }
  .btn.primary { background: var(--primary); color: var(--on-primary); border-color: var(--primary); }
  .btn.primary:active { background: var(--primary-active); }
  .btn.danger { background: var(--canvas); color: var(--error); border-color: var(--hairline); }
  .btn.small { padding: var(--s-xs) var(--s-sm); height: 32px; font-size: 13px; }
  .btn:disabled, #monitorBtn:disabled {
    background: var(--primary-disabled);
    color: var(--muted);
    border-color: transparent;
    cursor: not-allowed;
  }

  /* ── 레이아웃 ───────────────────────────────────────────────────── */
  main { padding: var(--s-xl) var(--s-lg); max-width: 1200px; margin: 0 auto; }
  .panel { display: none; }
  .panel.active { display: block; }

  /* feature-card: 연회색 면, 12px 라운드 */
  .card {
    background: var(--surface-card);
    border-radius: var(--r-lg);
    padding: var(--s-xl);
    margin-bottom: var(--s-lg);
  }
  .card h2 {
    font-size: 18px;
    font-weight: 600;
    margin: 0 0 var(--s-md) 0;
    color: var(--ink);
    letter-spacing: -0.2px;
  }

  /* ── 폼 ─────────────────────────────────────────────────────────── */
  label { display: block; font-size: 13px; font-weight: 500; color: var(--muted); margin-bottom: var(--s-xxs); }
  input[type=text], input[type=number], select {
    width: 100%;
    height: 40px;
    background: var(--canvas);
    border: 1px solid var(--hairline);
    color: var(--ink);
    padding: 10px 14px;
    border-radius: var(--r-md);
    font-family: inherit;
    font-size: 15px;
  }
  input[type=text]:focus, input[type=number]:focus, select:focus {
    outline: none;
    border-color: var(--ink);
  }
  input[type=checkbox] { width: auto; margin-right: var(--s-xs); accent-color: var(--primary); }
  .row { display: flex; gap: var(--s-sm); margin-bottom: var(--s-sm); align-items: end; }
  .row > div { flex: 1; }
  .grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s-sm); margin-bottom: var(--s-md); }

  table { width: 100%; border-collapse: collapse; margin-bottom: var(--s-sm); }
  th, td { text-align: left; padding: var(--s-xs); font-size: 14px; border-bottom: 1px solid var(--hairline); }
  th { color: var(--muted); font-weight: 500; font-size: 13px; }

  /* 키워드 그룹 — 흰 카드 + hairline (feature-icon-card) */
  .group-card {
    border: 1px solid var(--hairline);
    border-radius: var(--r-lg);
    padding: var(--s-lg);
    margin-bottom: var(--s-sm);
    background: var(--canvas);
  }
  .group-card.off { background: var(--surface-soft); }
  .group-head { display: flex; gap: var(--s-xs); margin-bottom: var(--s-md); align-items: center; }
  .group-head input { flex: 1; font-size: 16px; font-weight: 600; }
  .group-head select { width: 140px; flex: none; }

  /* 카드 안의 소제목 + 입력 묶음 */
  .field { margin-bottom: var(--s-md); }
  .field:last-child { margin-bottom: 0; }
  .field-label { font-size: 13px; font-weight: 500; color: var(--muted); margin-bottom: var(--s-xxs); }

  /* 카드 안에 중첩되는 접기 — 바깥 .advanced보다 한 단계 약하게 */
  .advanced.sub {
    border: none;
    border-top: 1px solid var(--hairline-soft);
    border-radius: 0;
    padding: 0;
    margin-bottom: 0;
    background: transparent;
  }
  .advanced.sub summary { padding: var(--s-sm) 0 0; font-size: 13px; }
  .advanced.sub[open] summary { border-bottom: none; margin-bottom: var(--s-sm); }
  .patterns { display: flex; flex-wrap: wrap; gap: var(--s-xxs); margin-bottom: var(--s-xs); }
  .chip {
    background: var(--surface-card);
    color: var(--ink);
    padding: var(--s-xxs) var(--s-sm);
    border-radius: var(--r-pill);
    font-size: 13px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: var(--s-xxs);
  }
  .chip button { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 14px; line-height: 1; padding: 0; }

  /* 키워드 칩 — 🔔 토글 + 이름 + × */
  .chip.kw { padding: 6px var(--s-sm); font-size: 14px; gap: var(--s-xs); }
  .chip.kw .bell { font-size: 15px; line-height: 1; }
  .chip.kw .x { color: var(--muted-soft); font-size: 16px; }
  /* 알림 끈 키워드는 흐리게 — 목록에서 바로 구분된다 */
  .chip.kw.off { background: transparent; border: 1px dashed var(--hairline); color: var(--muted); }
  .chip.kw.off .bell { opacity: 0.55; }
  .pattern-input { display: flex; gap: var(--s-xxs); }
  .pattern-input input { flex: 1; }

  /* ── 알림 배너 ──────────────────────────────────────────────────── */
  .banner {
    padding: var(--s-sm) var(--s-md);
    border-radius: var(--r-md);
    font-size: 14px;
    margin-bottom: var(--s-md);
    display: none;
    border: 1px solid transparent;
  }
  .banner.ok {
    display: block;
    background: color-mix(in srgb, var(--success) 10%, white);
    border-color: color-mix(in srgb, var(--success) 30%, white);
    color: #047857;
  }
  .banner.err {
    display: block;
    background: color-mix(in srgb, var(--error) 8%, white);
    border-color: color-mix(in srgb, var(--error) 30%, white);
    color: #b91c1c;
  }

  /* ── 키워드 히트 (product-mockup-card: 흰 면 + hairline) ─────────── */
  .hit {
    background: var(--canvas);
    border: 1px solid var(--hairline);
    border-left: 3px solid var(--brand-accent);
    border-radius: var(--r-lg);
    padding: var(--s-lg);
    margin-bottom: var(--s-sm);
  }
  .hit.high { border-left-color: var(--error); }
  .hit .meta { font-size: 13px; color: var(--muted); margin-bottom: var(--s-xs); }
  .hit .kw {
    display: inline-block;
    background: var(--surface-card);
    color: var(--ink);
    padding: 2px var(--s-sm);
    border-radius: var(--r-pill);
    font-size: 13px;
    font-weight: 500;
    margin-right: var(--s-xxs);
  }
  .hit .ctx { font-size: 14px; color: var(--muted); margin-top: var(--s-xs); white-space: pre-line; }
  .hit img { display: block; margin-top: var(--s-xs); max-width: 480px; max-height: 270px; border-radius: var(--r-md); border: 1px solid var(--hairline); }

  /* ── 로그 ───────────────────────────────────────────────────────── */
  .log-line {
    font-family: var(--font-code);
    font-size: 13px;
    padding: var(--s-xxs) 0;
    border-bottom: 1px solid var(--hairline-soft);
    color: var(--body);
  }
  .log-line.error { color: var(--error); }
  .log-line .t { color: var(--muted-soft); margin-right: var(--s-xs); }

  .empty { color: var(--muted-soft); padding: var(--s-xl); text-align: center; font-size: 14px; }
  .hint { font-size: 13px; font-weight: 500; color: var(--muted); margin-top: -8px; margin-bottom: var(--s-md); }

  /* ── 보고서 항목 ────────────────────────────────────────────────── */
  .rep {
    background: var(--canvas);
    border: 1px solid var(--hairline);
    border-left: 3px solid var(--ink);
    border-radius: var(--r-lg);
    padding: var(--s-lg);
    margin-bottom: var(--s-sm);
  }
  .rep.high { border-left-color: var(--error); }
  .rep.unclassified { border-left-color: var(--warning); }
  .rep .head { display: flex; align-items: baseline; gap: var(--s-xs); flex-wrap: wrap; margin-bottom: var(--s-sm); }
  .rep .subject { font-weight: 600; font-size: 18px; color: var(--ink); letter-spacing: -0.2px; }
  .rep .who { font-size: 14px; color: var(--muted); }
  .rep .kw {
    display: inline-block;
    background: var(--surface-card);
    color: var(--ink);
    padding: 2px var(--s-sm);
    border-radius: var(--r-pill);
    font-size: 13px;
    font-weight: 500;
  }
  .rep dl { margin: 0; font-size: 15px; line-height: 1.6; }
  .rep dt { color: var(--muted); font-size: 13px; font-weight: 500; margin-top: var(--s-sm); }
  .rep dd { margin: 2px 0 0; color: var(--body); }
  .rep .foot { margin-top: var(--s-sm); font-size: 13px; color: var(--muted-soft); font-family: var(--font-code); }

  .verify {
    font-size: 14px;
    padding: var(--s-sm) var(--s-md);
    border-radius: var(--r-md);
    margin-bottom: var(--s-md);
    background: var(--surface-soft);
    border: 1px solid var(--hairline);
    color: var(--body);
  }
  .verify.warn {
    background: color-mix(in srgb, var(--warning) 10%, white);
    border-color: color-mix(in srgb, var(--warning) 35%, white);
    color: #92400e;
  }

  /* ── 고급 설정 (접힘) ───────────────────────────────────────────── */
  .advanced {
    background: var(--canvas);
    border: 1px solid var(--hairline);
    border-radius: var(--r-lg);
    padding: 0 var(--s-lg);
    margin-bottom: var(--s-lg);
  }
  .advanced summary {
    cursor: pointer;
    padding: var(--s-md) 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--muted);
    list-style: none;
  }
  .advanced summary::-webkit-details-marker { display: none; }
  .advanced summary::before { content: "▸ "; color: var(--muted-soft); }
  .advanced[open] summary { color: var(--ink); border-bottom: 1px solid var(--hairline-soft); margin-bottom: var(--s-md); }
  .advanced[open] summary::before { content: "▾ "; }
  .advanced .grid4 { padding-bottom: var(--s-lg); margin-bottom: 0; }

  /* 체크박스 + 라벨을 한 줄로 */
  .inline-check {
    display: flex;
    align-items: center;
    font-size: 14px;
    font-weight: 500;
    color: var(--body);
    margin-bottom: 0;
    cursor: pointer;
  }

  /* ── 그룹 적용 상임위 선택 ──────────────────────────────────────── */
  .scope { margin-top: var(--s-sm); }
  .scope .scope-label { font-size: 13px; font-weight: 500; color: var(--muted); margin-bottom: var(--s-xxs); }
  .scope-opts { display: flex; flex-wrap: wrap; gap: var(--s-xs); }
  .scope-opts label {
    display: inline-flex;
    align-items: center;
    gap: var(--s-xxs);
    background: var(--surface-card);
    border: 1px solid transparent;
    padding: var(--s-xxs) var(--s-sm);
    border-radius: var(--r-pill);
    font-size: 13px;
    font-weight: 500;
    color: var(--body);
    margin-bottom: 0;
    cursor: pointer;
  }
  .scope-opts label.on { background: var(--canvas); border-color: var(--ink); color: var(--ink); }
  .scope-opts label.stale {
    background: color-mix(in srgb, var(--warning) 12%, white);
    border-color: color-mix(in srgb, var(--warning) 40%, white);
    color: #92400e;
  }
  .scope-opts label.stale button { background: none; border: none; color: inherit; cursor: pointer; font-size: 14px; line-height: 1; padding: 0; }
  .scope-opts input { margin: 0; }
  .scope .scope-label.warn { color: #92400e; }

  .envblock {
    font-family: var(--font-code);
    font-size: 13px;
    line-height: 1.7;
    background: var(--surface-soft);
    border: 1px solid var(--hairline);
    border-radius: var(--r-md);
    padding: var(--s-md);
    margin: 0;
    overflow-x: auto;
    color: var(--body);
  }
  .verify.ok {
    background: color-mix(in srgb, var(--success) 8%, white);
    border-color: color-mix(in srgb, var(--success) 30%, white);
    color: #047857;
  }
  /* 알림 끔 그룹의 히트는 기록에 가까우므로 흐리게 */
  .hit.muted { border-left-color: var(--hairline); opacity: 0.75; }

  @media (max-width: 900px) {
    .grid4 { grid-template-columns: repeat(2, 1fr); }
    header { gap: var(--s-sm); padding: 0 var(--s-md); }
    header h1 { font-size: 16px; }
    main { padding: var(--s-lg) var(--s-md); }
    .card { padding: var(--s-lg); }
  }
</style>
</head>
<body>
<header>
  <h1>국캐치</h1>
  <nav>
    <button data-tab="sessions" class="active">감시 대상</button>
    <button data-tab="keywords">키워드</button>
    <button data-tab="notify">알림 설정</button>
    <button data-tab="monitor">실시간</button>
    <button data-tab="report">보고서</button>
    <button data-tab="logs">로그</button>
  </nav>
  <div class="spacer"></div>
  <span id="statusBadge">중지됨</span>
  <button id="monitorBtn" class="start">감시 시작</button>
</header>

<main>
  <div id="banner" class="banner"></div>

  <section id="panel-sessions" class="panel active">
    <div class="card">
      <h2>감시할 상임위</h2>
      <table id="sessionTable">
        <thead><tr><th style="width:25%">이름</th><th>URL</th><th style="width:76px"></th></tr></thead>
        <tbody></tbody>
      </table>
      <button class="btn" id="addSessionBtn">+ 상임위 추가</button>

      <label class="inline-check" style="margin-top:20px">
        <input type="checkbox" id="cfgHeadless" /> 헤드리스 모드 (끄면 브라우저 창이 보입니다)
      </label>
    </div>

    <details class="advanced">
      <summary>고급 설정</summary>
      <div class="hint" style="margin:12px 0 16px">
        기본값으로 두어도 됩니다. 자막이 문장 중간에 끊기면 <b>확정 대기</b>를,
        같은 키워드 알림이 잦으면 <b>재알림 쿨다운</b>을 올리세요.
      </div>
      <div class="grid4">
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
        <div>
          <label>키워드 재알림 쿨다운(ms)</label>
          <input type="number" id="cfgCooldownMs" value="60000" />
        </div>
      </div>
    </details>

    <button class="btn primary" id="saveConfigBtn">설정 저장</button>
  </section>

  <section id="panel-keywords" class="panel">
    <div class="card">
      <h2>감시할 키워드</h2>
      <div class="hint">키워드를 적고 Enter를 누르면 추가됩니다. 🔔을 누르면 그 키워드의 알림만 끄고 켤 수 있습니다(끈 키워드도 보고서에는 남습니다).<br />
      묶음은 <b>상임위마다 다른 키워드를 볼 때</b> 나눕니다. 대부분은 묶음 하나로 충분하고, 상임위를 비워 두면 전체에 적용됩니다.<br />
      띄어쓰기는 신경 쓰지 않아도 됩니다 — "소상공인 시장 진흥 공단"도 "소상공인시장진흥공단"으로 잡힙니다. 약칭은 따로 추가하세요.</div>
      <div id="groupList"></div>
      <button class="btn" id="addGroupBtn">+ 묶음 추가</button>
    </div>
    <button class="btn primary" id="saveKeywordsBtn">키워드 저장</button>
  </section>

  <section id="panel-notify" class="panel">
    <div class="card">
      <h2>메일 알림</h2>
      <div class="hint">키워드가 감지되면 등록한 주소로 메일이 갑니다. 그룹이 "알림 끔"이면 발송하지 않습니다.</div>
      <div id="mailStatus" class="verify">확인 중...</div>
      <div class="row">
        <div>
          <label>기본 수신자 (쉼표로 여러 명)</label>
          <input type="text" id="cfgMailTo" placeholder="hong@example.com, kim@example.com" />
        </div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" id="saveMailBtn">수신자 저장</button>
        <button class="btn" id="testMailBtn">테스트 발송</button>
      </div>
      <div id="mailTestResult" class="hint" style="margin-top:12px"></div>
    </div>

    <div class="card">
      <h2>Windows 알림</h2>
      <div class="hint">
        키워드가 감지되면 이 PC 화면 오른쪽 아래에 알림이 뜹니다. 별도 설정 없이 동작합니다.
      </div>
      <div class="row">
        <button class="btn" id="testToastBtn">알림 테스트</button>
      </div>
      <div id="toastTestResult" class="hint" style="margin:12px 0 0"></div>
      <div class="hint" style="margin:12px 0 0">
        알림이 안 보이면 Windows <b>설정 → 시스템 → 알림</b>에서 알림이 꺼져 있거나
        <b>방해 금지(집중 지원)</b>가 켜져 있는지 확인하세요.
      </div>
    </div>

    <div class="card">
      <h2>SMTP 접속 정보</h2>
      <div class="hint">
        비밀번호가 포함되므로 화면이 아니라 <b>.env 파일</b>에서 관리합니다.
        수정한 뒤에는 제어판을 재시작해야 반영됩니다.
      </div>
      <pre class="envblock">SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=보내는계정@example.com
SMTP_PASS=앱_비밀번호
SMTP_FROM=국캐치 &lt;보내는계정@example.com&gt;</pre>
      <div class="hint" style="margin:12px 0 0">
        Gmail은 일반 비밀번호가 아니라 <b>앱 비밀번호</b>가 필요합니다(2단계 인증 필수).
        기관 메일 서버를 쓴다면 전산팀에 SMTP 주소·포트·인증 방식을 문의하세요.
      </div>
    </div>
  </section>

  <section id="panel-monitor" class="panel">
    <div class="card">
      <h2>감시 중인 상임위</h2>
      <div id="sessionStatusList" class="empty">감시가 시작되지 않았습니다.</div>
    </div>
    <div class="card">
      <h2>실시간 키워드 히트</h2>
      <div id="hitList" class="empty">아직 히트가 없습니다.</div>
    </div>
  </section>

  <section id="panel-report" class="panel">
    <div class="card">
      <h2>보고 초안 생성</h2>
      <div class="hint">회의가 끝난 뒤 실행하세요. 등록한 키워드와 관련된 질의만 보고서로 만듭니다. 감시 중에도 실행할 수 있지만 수 분이 걸립니다.</div>
      <div class="row">
        <div style="flex:2">
          <label>자막 파일</label>
          <select id="reportFile"></select>
        </div>
        <div style="flex:1">
          <label>담당부서 (비우면 키워드 그룹의 부서 사용)</label>
          <input type="text" id="reportDept" placeholder="예: 기획조정실" />
        </div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" id="reportRunBtn">보고서 생성</button>
        <button class="btn" id="reportRefreshBtn">파일 목록 새로고침</button>
      </div>
      <div id="reportProgress" class="hint" style="margin-top:12px"></div>
    </div>

    <div class="card">
      <h2>생성 결과</h2>
      <div class="row" style="margin-bottom:10px">
        <select id="reportPicker" style="flex:2"></select>
        <button class="btn" id="reportLoadBtn">불러오기</button>
        <button class="btn primary" id="reportDocxBtn">워드로 저장</button>
      </div>
      <div id="reportSummary"></div>
      <div id="reportList" class="empty">아직 생성된 보고서가 없습니다.</div>
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

  /**
   * config.json 전체를 저장한다. 세션 탭과 알림 탭이 같은 파일을 쓰므로
   * 한쪽만 보내면 다른 쪽 값이 날아간다 — 항상 화면 전체를 실어 보낸다.
   */
  async function saveConfig({ silent } = {}) {
    const config = {
      sessions: sessions.map((s) => ({ name: (s.name || '').trim(), url: (s.url || '').trim() })),
      headless: $('#cfgHeadless').checked,
      settleMs: Number($('#cfgSettleMs').value) || 1800,
      watchdogIdleMs: Number($('#cfgWatchdogMs').value) || 300000,
      maxShotsPerSession: Number($('#cfgMaxShots').value) || 200,
      cooldownMs: Number($('#cfgCooldownMs').value) || 60000,
      mailTo: $('#cfgMailTo').value.trim(),
    };
    await api('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!silent) showBanner('설정이 저장되었습니다.');
  }

  $('#saveConfigBtn').addEventListener('click', async () => {
    try {
      await saveConfig();
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
    $('#cfgMailTo').value = cfg.mailTo || '';
    renderSessions();
  }

  // ── 키워드 관리 ──────────────────────────────────────────────
  let groups = [];

  /**
   * 카드 하나 = 키워드 묶음 하나.
   *
   * 묶음을 나누는 기준은 "어느 상임위에 적용할지"다. 대부분은 묶음 하나로
   * 충분하고(상임위 전체 적용), 산자위에서만 볼 키워드가 생겼을 때 묶음을
   * 하나 더 만든다.
   *
   * 키워드는 Enter로 빠르게 추가하고, 각 키워드의 🔔을 눌러 알림을 켜고
   * 끈다. 알림은 묶음이 아니라 키워드마다 정한다 — 같은 상임위를 보더라도
   * 어떤 말은 즉시 알림을 받고 어떤 말은 기록만 남기고 싶기 때문이다.
   *
   * 띄어쓰기 변형은 따로 넣을 필요가 없다. 매칭 전에 공백을 모두 제거하므로
   * (src/keywords.js normalize) "소상공인 시장 진흥 공단"은
   * "소상공인시장진흥공단" 하나로 잡힌다.
   */
  function renderGroups() {
    const list = $('#groupList');
    list.innerHTML = '';
    if (groups.length === 0) {
      list.appendChild(el('div', { class: 'empty', text: '등록된 키워드가 없습니다. 아래 "+ 묶음 추가"를 누르세요.' }));
    }
    groups.forEach((g, gi) => {
      const labelInput = el('input', {
        type: 'text',
        placeholder: '묶음 이름 (예: 공통, 산자위 전용)',
        value: g.label || '',
      });
      labelInput.addEventListener('input', () => { groups[gi].label = labelInput.value; });

      const delBtn = el('button', {
        class: 'btn danger small', text: '묶음 삭제',
        onclick: () => { groups.splice(gi, 1); renderGroups(); },
      });

      // ── 키워드 칩: 🔔 토글 + × 삭제 ──
      const chips = el('div', { class: 'patterns' });
      (g.patterns || []).forEach((p, pi) => {
        const on = p.notify !== false;
        chips.appendChild(el('span', { class: 'chip kw' + (on ? '' : ' off') }, [
          el('button', {
            type: 'button',
            class: 'bell',
            title: on ? '알림 켜짐 — 누르면 끕니다' : '알림 꺼짐 — 누르면 켭니다',
            text: on ? '🔔' : '🔕',
            onclick: () => { groups[gi].patterns[pi].notify = !on; renderGroups(); },
          }),
          el('span', { text: p.text }),
          el('button', {
            type: 'button',
            class: 'x',
            title: '삭제',
            text: '×',
            onclick: () => { groups[gi].patterns.splice(pi, 1); renderGroups(); },
          }),
        ]));
      });

      const addInput = el('input', { type: 'text', placeholder: '키워드를 적고 Enter (예: 소상공인)' });
      addInput.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        const value = addInput.value.trim();
        if (!value) return;
        if (!groups[gi].patterns) groups[gi].patterns = [];
        if (groups[gi].patterns.some((x) => x.text === value)) {
          showBanner('이미 있는 키워드입니다: ' + value, true);
          return;
        }
        groups[gi].patterns.push({ text: value, notify: true });
        addInput.value = '';
        renderGroups();
        // 연속 입력을 위해 다시 포커스 — 렌더로 새 엘리먼트가 만들어지므로
        // 위치로 찾아 되돌린다.
        const inputs = list.querySelectorAll('.kw-add');
        if (inputs[gi]) inputs[gi].focus();
      });
      addInput.classList.add('kw-add');

      // ── 세부 설정 (접힘) ──
      const deptInput = el('input', { type: 'text', placeholder: '예: 정책기획실', value: g.dept || '' });
      deptInput.addEventListener('input', () => { groups[gi].dept = deptInput.value; });

      const details = el('details', { class: 'advanced sub' }, [
        el('summary', { text: '이 묶음의 적용 범위 (담당부서 · 상임위)' }),
        el('div', { class: 'field' }, [
          el('div', { class: 'field-label', text: '담당부서 — 보고서에 자동으로 채워집니다' }),
          deptInput,
        ]),
        buildScope(g, gi),
      ]);

      list.appendChild(el('div', { class: 'group-card' }, [
        el('div', { class: 'group-head' }, [labelInput, delBtn]),
        el('div', { class: 'field' }, [chips, el('div', { class: 'pattern-input' }, [addInput])]),
        details,
      ]));
    });
  }

  /**
   * 그룹의 적용 상임위 선택. 아무것도 체크하지 않으면 전체 적용이다 —
   * "전체" 체크박스를 따로 두지 않고 빈 선택을 전체로 해석해서, 세션을
   * 새로 추가했을 때 기존 그룹이 자동으로 그 세션까지 커버하게 한다.
   */
  function buildScope(g, gi) {
    const names = sessions.map((s) => (s.name || '').trim()).filter(Boolean);
    const selected = Array.isArray(g.sessions) ? g.sessions : [];
    const opts = el('div', { class: 'scope-opts' });

    if (names.length === 0) {
      opts.appendChild(el('span', { class: 'hint', style: 'margin:0', text: '세션을 먼저 등록하면 상임위를 지정할 수 있습니다.' }));
    }

    names.forEach((name) => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = selected.includes(name);
      const wrap = el('label', cb.checked ? { class: 'on' } : {}, [cb, el('span', { text: name })]);
      cb.addEventListener('change', () => {
        const cur = new Set(groups[gi].sessions || []);
        if (cb.checked) cur.add(name); else cur.delete(name);
        groups[gi].sessions = [...cur];
        renderGroups();
      });
      opts.appendChild(wrap);
    });

    // 세션 이름이 바뀌거나 삭제되면 그룹의 지정이 조용히 무효가 된다
    // (그 그룹은 어디에도 매칭되지 않는데 화면상 이유가 안 보인다).
    // 없어진 이름을 그대로 드러내고 지울 수 있게 한다.
    const stale = selected.filter((n) => !names.includes(n));
    stale.forEach((name) => {
      const wrap = el('label', { class: 'stale' }, [
        el('span', { text: '⚠ ' + name }),
        el('button', {
          type: 'button',
          text: '×',
          onclick: () => {
            groups[gi].sessions = (groups[gi].sessions || []).filter((x) => x !== name);
            renderGroups();
          },
        }),
      ]);
      opts.appendChild(wrap);
    });

    let note;
    if (selected.length === 0) note = '적용 상임위 — 전체';
    else note = '적용 상임위 — ' + selected.length + '개 선택';
    if (stale.length) note += ' (없는 상임위 ' + stale.length + '개 — 이 키워드는 그쪽에서 동작하지 않습니다)';

    return el('div', { class: 'scope' }, [
      el('div', { class: 'scope-label' + (stale.length ? ' warn' : ''), text: note }),
      opts,
    ]);
  }

  $('#addGroupBtn').addEventListener('click', () => {
    groups.push({ label: '', dept: '', sessions: [], patterns: [] });
    renderGroups();
  });

  $('#saveKeywordsBtn').addEventListener('click', async () => {
    try {
      const payload = groups.map((g) => ({
        label: (g.label || '').trim(),
        dept: (g.dept || '').trim(),
        sessions: g.sessions || [],
        // 키워드마다 알림 여부를 함께 저장한다.
        patterns: (g.patterns || []).map((p) => ({ text: p.text, notify: p.notify !== false })),
      }));
      const result = await api('/api/keywords', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: payload }),
      });
      showBanner(
        result.reloaded
          ? '키워드가 저장되고, 실행 중인 감시에 즉시 반영되었습니다 (' + result.groupCount + '개).'
          : '키워드가 저장되었습니다.',
      );
    } catch (e) {
      showBanner('저장 실패: ' + e.message, true);
    }
  });

  async function loadKeywords() {
    const kw = await api('/api/keywords');
    // 키워드는 "소상공인"(구) 또는 {text, notify}(신) 두 형식이 온다.
    // 구 형식은 묶음의 notify를 물려받는다 — 파일을 손으로 고치지 않아도
    // 화면에서 저장하는 순간 신 형식으로 넘어간다.
    groups = (kw.groups || []).map((g) => {
      const groupNotify = g.notify === undefined ? true : Boolean(g.notify);
      return {
        label: g.label || '',
        dept: g.dept || '',
        sessions: Array.isArray(g.sessions) ? [...g.sessions] : [],
        patterns: (g.patterns || [])
          .map((p) => {
            const text = typeof p === 'string' ? p : String(p?.text ?? '');
            const notify = typeof p === 'string' || p?.notify === undefined ? groupNotify : Boolean(p.notify);
            return { text, notify };
          })
          .filter((p) => p.text.trim()),
      };
    });
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

  // ── 알림 ──────────────────────────────────────────────
  async function loadMailStatus() {
    const s = await api('/api/notify/status');
    const box = $('#mailStatus');
    const parts = [];
    if (!s.installed) parts.push('nodemailer 미설치 — npm install 필요');
    else if (!s.host) parts.push('SMTP_HOST 미설정 — 아래 안내대로 .env를 채우세요');
    else {
      parts.push('SMTP ' + s.host + ':' + s.port);
      parts.push(s.user ? '계정 ' + s.user : '인증 없음');
      parts.push(s.hasPassword ? '비밀번호 설정됨' : '⚠ 비밀번호 없음');
    }
    parts.push(
      s.defaultRecipients.length
        ? '기본 수신자 ' + s.defaultRecipients.length + '명'
        : '기본 수신자 없음',
    );
    box.textContent = (s.ready ? '발송 준비 완료 · ' : '발송 불가 · ') + parts.join(' · ');
    box.className = 'verify ' + (s.ready ? 'ok' : 'warn');
  }

  $('#saveMailBtn').addEventListener('click', async () => {
    try {
      // config 전체를 다시 보내야 하므로 현재 화면 값을 그대로 실어 보낸다.
      await saveConfig({ silent: true });
      await loadMailStatus();
      showBanner('수신자가 저장되었습니다.');
    } catch (e) {
      showBanner('저장 실패: ' + e.message, true);
    }
  });

  $('#testMailBtn').addEventListener('click', async () => {
    const btn = $('#testMailBtn');
    const out = $('#mailTestResult');
    btn.disabled = true;
    out.textContent = '발송 중...';
    try {
      const r = await api('/api/notify/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: $('#cfgMailTo').value.trim() }),
      });
      out.textContent = '발송 완료 — ' + r.sent.join(', ') + ' (메일함을 확인하세요)';
      showBanner('테스트 메일을 보냈습니다.');
    } catch (e) {
      out.textContent = '실패: ' + e.message;
      showBanner('테스트 발송 실패: ' + e.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  $('#testToastBtn').addEventListener('click', async () => {
    const btn = $('#testToastBtn');
    const out = $('#toastTestResult');
    btn.disabled = true;
    out.textContent = '알림 띄우는 중...';
    try {
      const r = await api('/api/notify/test-toast', { method: 'POST' });
      out.textContent = '알림을 띄웠습니다 (' + r.method + '). 화면 오른쪽 아래를 확인하세요.';
      showBanner('Windows 알림을 띄웠습니다.');
    } catch (e) {
      out.textContent = '실패: ' + e.message;
      showBanner('알림 테스트 실패: ' + e.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // ── 보고서 ──────────────────────────────────────────────
  function fmtBytes(n) {
    return n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + 'MB' : Math.round(n / 1024) + 'KB';
  }

  async function loadReportFiles() {
    const data = await api('/api/report/files');
    const sel = $('#reportFile');
    sel.innerHTML = '';
    if (data.files.length === 0) {
      sel.appendChild(el('option', { value: '', text: '자막 파일이 없습니다 — 먼저 감시를 실행하세요' }));
    }
    data.files.forEach((f) => {
      sel.appendChild(el('option', {
        value: f.relPath,
        text: f.name + '  (' + f.kind + ', ' + fmtBytes(f.bytes) + ')',
      }));
    });
    $('#reportRunBtn').disabled = data.files.length === 0 || data.running || !data.hasApiKey;
    if (!data.hasApiKey) {
      $('#reportProgress').textContent = 'ANTHROPIC_API_KEY가 설정되지 않아 보고서를 생성할 수 없습니다 (.env 확인).';
    } else if (data.running) {
      $('#reportProgress').textContent = '보고서 생성이 진행 중입니다...';
    }
  }

  async function loadReportList() {
    const data = await api('/api/report/list');
    const sel = $('#reportPicker');
    sel.innerHTML = '';
    if (data.reports.length === 0) {
      sel.appendChild(el('option', { value: '', text: '생성된 보고서가 없습니다' }));
    }
    data.reports.forEach((r) => sel.appendChild(el('option', { value: r.name, text: r.name })));
    $('#reportLoadBtn').disabled = data.reports.length === 0;
    $('#reportDocxBtn').disabled = data.reports.length === 0;
  }

  function renderReport(data) {
    const summary = $('#reportSummary');
    summary.innerHTML = '';
    const v = data.검증 || {};
    const f = data.키워드필터 || {};
    const warn = (v.커버리지비율 ?? 100) < 100 || (v.미분류구간 || []).length > 0;
    const parts = [
      '자막 ' + (data.메타?.자막줄수 ?? '?') + '줄 / 커버리지 ' + (v.커버리지 || '?') + '줄 (' + (v.커버리지비율 ?? '?') + '%)',
      f.적용 ? '키워드 매칭 ' + f.대상 + '건, 미매칭 제외 ' + f.제외 + '건' : '키워드 미등록 — 전체 표시',
    ];
    if ((v.미분류구간 || []).length) parts.push('⚠ 미분류 구간 ' + v.미분류구간.length + '곳 (사람 확인 필요)');
    summary.appendChild(el('div', { class: 'verify' + (warn ? ' warn' : ''), text: parts.join(' · ') }));

    const list = $('#reportList');
    list.innerHTML = '';
    const items = data.보고서 || [];
    if (items.length === 0) {
      list.className = 'empty';
      list.textContent = f.적용
        ? '등록한 키워드와 관련된 질의가 없습니다.'
        : '생성된 항목이 없습니다.';
      return;
    }
    list.className = '';
    items.forEach((r) => {
      // 강조는 "사람이 확인해야 하는 것"에만 쓴다. 알림 여부는 보고서의
      // 중요도와 다른 축이라 색으로 구분하지 않는다.
      const card = el('div', { class: 'rep' + (r.미분류 ? ' unclassified' : '') });

      const head = el('div', { class: 'head' });
      head.appendChild(el('span', { class: 'subject', text: r.주제 || '(주제 미상)' }));
      head.appendChild(el('span', { class: 'who', text: r.의원명 + ' → ' + r.답변자 }));
      (r.매칭키워드 || []).forEach((k) => head.appendChild(el('span', { class: 'kw', text: k.그룹 + ' · ' + k.패턴 })));
      card.appendChild(head);

      const dl = el('dl');
      const add = (term, val) => {
        if (!val) return;
        dl.appendChild(el('dt', { text: term }));
        dl.appendChild(el('dd', { text: val }));
      };
      add('질의요지', r.질의요지);
      add('답변내용', r.답변내용);
      add('시사점', r.시사점);
      card.appendChild(dl);

      const q = (r.근거줄?.질의 || []).map((x) => x.시작줄 + '-' + x.끝줄).join(', ');
      const a = (r.근거줄?.답변 || []).map((x) => x.시작줄 + '-' + x.끝줄).join(', ');
      card.appendChild(el('div', {
        class: 'foot',
        text: '영상 ' + (r.영상시점 || '--:--:--') + ' · 근거 줄 [질의 ' + (q || '없음') + ' / 답변 ' + (a || '없음') + ']'
          + (r.담당부서 ? ' · ' + r.담당부서 : '')
          + (r.source === 'template' ? ' · ⚠ LLM 요약 실패(원문 발췌)' : ''),
      }));
      list.appendChild(card);
    });
  }

  function renderReportProgress(p) {
    const box = $('#reportProgress');
    if (p.phase === 'start') box.textContent = '시작: ' + p.파일;
    else if (p.phase === 'loaded') box.textContent = '자막 ' + p.줄수 + '줄 로드됨';
    else if (p.phase === 'segment-start') box.textContent = '[패스 1] 발언 구간 판정 중... (수 분 걸릴 수 있습니다)';
    else if (p.phase === 'segment-done') {
      box.textContent = '[패스 1] 완료 — 구간 ' + p.구간수 + '개, 질의-답변 ' + p.쌍수 + '건, 커버리지 ' + p.커버리지 + '줄'
        + (p.미분류 ? ' (미분류 ' + p.미분류 + '곳)' : '');
    } else if (p.phase === 'filter-done') {
      box.textContent = p.필터적용
        ? '[키워드 필터] 대상 ' + p.대상 + '건, 제외 ' + p.제외 + '건'
        : '[키워드 필터] 등록된 키워드가 없어 전체를 생성합니다';
    } else if (p.phase === 'summarize') {
      box.textContent = '[패스 2] 요약 중 ' + p.현재 + '/' + p.전체 + ' — ' + (p.주제 || '');
    } else if (p.phase === 'result') {
      box.textContent = '완료 — ' + (p.result.보고서 || []).length + '건 생성됨';
      renderReport(p.result);
      $('#reportRunBtn').disabled = false;
      loadReportList().catch(() => {});
      showBanner('보고서 생성이 완료되었습니다.');
    } else if (p.phase === 'error') {
      box.textContent = '실패: ' + p.message;
      $('#reportRunBtn').disabled = false;
      showBanner('보고서 생성 실패: ' + p.message, true);
    }
  }

  $('#reportRunBtn').addEventListener('click', async () => {
    const file = $('#reportFile').value;
    if (!file) return showBanner('자막 파일을 선택하세요.', true);
    $('#reportRunBtn').disabled = true;
    $('#reportProgress').textContent = '요청 중...';
    try {
      await api('/api/report/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, dept: $('#reportDept').value.trim() || null }),
      });
    } catch (e) {
      $('#reportProgress').textContent = '실패: ' + e.message;
      $('#reportRunBtn').disabled = false;
      showBanner(e.message, true);
    }
  });

  $('#reportRefreshBtn').addEventListener('click', () => {
    Promise.all([loadReportFiles(), loadReportList()])
      .then(() => showBanner('목록을 새로고침했습니다.'))
      .catch((e) => showBanner(e.message, true));
  });

  // 브라우저가 직접 받게 한다 — fetch로 받아 blob URL을 만들면 파일명이
  // 유실되고, Content-Disposition의 한글 파일명도 못 쓴다.
  $('#reportDocxBtn').addEventListener('click', () => {
    const name = $('#reportPicker').value;
    if (!name) return showBanner('보고서를 선택하세요.', true);
    window.location.href = '/api/report/docx/' + encodeURIComponent(name);
  });

  $('#reportLoadBtn').addEventListener('click', async () => {
    const name = $('#reportPicker').value;
    if (!name) return;
    try {
      renderReport(await api('/api/report/view/' + encodeURIComponent(name)));
    } catch (e) {
      showBanner(e.message, true);
    }
  });

  // ── 히트/로그 실시간 스트림 ──────────────────────────────────────────────
  function renderHit(hit) {
    const list = $('#hitList');
    if (list.className === 'empty') { list.className = ''; list.innerHTML = ''; }
    // 알림을 끈 그룹의 히트도 목록에는 남긴다(기록이므로). 다만 흐리게
    // 그려서 "알림이 간 것"과 구분되게 한다.
    const card = el('div', { class: 'hit' + (hit.notify === false ? ' muted' : '') });
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
      } else if (msg.type === 'report') {
        renderReportProgress(msg.payload);
      }
    };
    es.onerror = () => { /* 브라우저가 자동 재연결 시도함 */ };
  }

  // ── 초기화 ──────────────────────────────────────────────
  Promise.all([
    loadConfig(),
    loadKeywords(),
    loadReportFiles(),
    loadReportList(),
    loadMailStatus(),
    api('/api/monitor/status').then(applyStatus),
  ])
    // 키워드 그룹의 "적용 상임위" 체크박스는 세션 목록이 있어야 그릴 수 있는데
    // 두 로드가 동시에 돌아 순서가 보장되지 않는다. 둘 다 끝난 뒤 한 번 더 그린다.
    .then(() => renderGroups())
    .catch((e) => showBanner('초기 로드 실패: ' + e.message, true));
  connectEvents();
})();
</script>
</body>
</html>`;

module.exports = { PAGE_HTML };
