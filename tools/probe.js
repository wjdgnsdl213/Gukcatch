/**
 * Phase 0 관측 스크립트 — 코드를 고치기 전에 "사실"을 확보한다.
 *
 * 사용법:
 *   node tools/probe.js "<플레이어URL>" [관측초수=60]
 *
 * 왜 필요한가:
 *   ROADMAP P0-1(영상 시점 저장)과 P0-3(자막 id 재사용)은 자막 DOM이 실제로
 *   어떻게 생겼는지 모르면 잘못 구현된다. 추측으로 짜면 정리본이 조용히
 *   유실되거나(P0-3), 알림에 엉뚱한 시점이 박힌다(P0-1).
 *
 * 무엇을 확인하는가 (probe-report.json으로 출력):
 *   ① 자막 <p> 요소의 outerHTML / data-* 속성 / click 이벤트 핸들러 소스
 *      → 사이트가 "자막 클릭 → 영상 점프"를 구현하는 방식에 시점 정보가 반드시 있다
 *   ② 시점 소스 4종 (currentTime / getStartDate / buffered / duration + HLS 태그)
 *   ③ 고유 id 개수 — 3~10개면 순환 재사용 확정, 수백 개면 현재 로직 안전
 *   ④ 같은 id의 텍스트 변화 시퀀스 — "접두사 성장" 가정이 실제로 맞는지
 *   ⑤ (보너스) 화면 캡처 3종 시도 — video 영역이 검게 찍히는지 미리 확인
 *
 * 이 스크립트는 읽기 전용이다. natv-caption-scraper.js를 건드리지 않는다.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { CAPTION_SELECTOR, startPlaybackAndCaptions } = require('../src/capture');

const TARGET_URL = process.argv[2];
const DURATION_SEC = Number(process.argv[3] || 60);

if (!TARGET_URL) {
  console.error('사용법: node tools/probe.js "<플레이어URL>" [관측초수=60]');
  process.exit(1);
}

const OUT_DIR = path.resolve(__dirname, '..');
const REPORT_FILE = path.join(OUT_DIR, 'probe-report.json');
const SHOT_DIR = path.join(OUT_DIR, 'probe-shots');

// capture.js와 동일한 셀렉터/클릭 로직을 그대로 가져다 쓴다 — 이전에는 이
// 스크립트가 재생/자막 버튼 클릭을 자체적으로 하드코딩하고 있었는데,
// capture.js 쪽만 고치고 여기를 안 고쳐서 실제 라이브 검증 때 서로 다른
// 셀렉터를 쓰는 불일치가 있었다 (라이브의 진짜 트리거는 "영상재생하기"
// 버튼과 "AI 자막보기" 링크였는데, 이 파일은 여전히 .vjs-big-play-button과
// "AI 자막보기 켜기"만 시도하고 있었다).
const SELECTOR = CAPTION_SELECTOR;

// 수집 버퍼 — 페이지가 죽어도 Node 쪽에 남아 있도록 exposeFunction으로 즉시 넘겨받는다
const captionEvents = []; // { t, id, text, videoTime }
const timeSamples = []; // { t, currentTime, ... }
const m3u8Findings = []; // { url, programDateTime, targetDuration }

const startedAt = Date.now();
const since = () => Date.now() - startedAt;

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  // channel: 'chrome' — Playwright 번들 Chromium 대신 시스템에 설치된 Chrome을 그대로 자동화.
  // 브라우저 400MB 재다운로드가 불필요하고, 실제 사용자 환경과 동일한 코덱/DRM 스택을 쓴다.
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext({ locale: 'ko-KR' });
  const page = await context.newPage();

  // ── HLS 플레이리스트 가로채기 (시점 소스 후보 ③) ────────────────────────
  page.on('response', async (res) => {
    const url = res.url();
    if (!/\.m3u8(\?|$)/i.test(url)) return;
    try {
      const body = await res.text();
      const pdt = body.match(/#EXT-X-PROGRAM-DATE-TIME:(.+)/);
      const target = body.match(/#EXT-X-TARGETDURATION:(.+)/);
      m3u8Findings.push({
        url,
        hasProgramDateTime: Boolean(pdt),
        programDateTime: pdt ? pdt[1].trim() : null,
        targetDuration: target ? target[1].trim() : null,
        isLive: !/#EXT-X-ENDLIST/.test(body),
        head: body.slice(0, 400),
      });
    } catch {
      /* 본문을 못 읽는 응답은 무시 */
    }
  });

  await page.exposeFunction('__probeCaption', (id, text, videoTime) => {
    captionEvents.push({ t: since(), id, text, videoTime });
  });
  await page.exposeFunction('__probeTime', (sample) => {
    timeSamples.push({ t: since(), ...sample });
  });

  console.log('페이지 접속 중:', TARGET_URL);
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

  const { playClicked, captionClicked } = await startPlaybackAndCaptions(page);
  if (!playClicked) console.log('  재생 버튼을 못 찾음 (이미 재생 중일 수 있음)');
  if (!captionClicked) console.log('  자막 버튼을 못 찾음 (이미 켜져 있을 수 있음)');

  // ── 관측 시작 ──────────────────────────────────────────────────────────
  await page.evaluate(
    ({ selector }) => {
      const idOf = (el) =>
        [...el.classList].find((c) => c.startsWith('ftxt')) || el.className;

      function scan() {
        const video = document.querySelector('video');
        const t = video ? video.currentTime : null;
        document.querySelectorAll(selector).forEach((el) => {
          const text = el.textContent.trim();
          if (text) window.__probeCaption(idOf(el), text, t);
        });
      }

      scan();
      const observer = new MutationObserver(scan);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      window.__probeObserver = observer;

      // 시점 소스 샘플러 — 0.5초마다 4종을 동시에 찍어 비교 가능하게 한다
      window.__probeTimer = setInterval(() => {
        const v = document.querySelector('video');
        if (!v) return window.__probeTime({ videoPresent: false });
        let startDate = null;
        try {
          const d = v.getStartDate && v.getStartDate();
          startDate = d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
        } catch {
          startDate = null;
        }
        const buffered = [];
        for (let i = 0; i < v.buffered.length; i++) {
          buffered.push([v.buffered.start(i), v.buffered.end(i)]);
        }
        window.__probeTime({
          videoPresent: true,
          currentTime: v.currentTime,
          duration: Number.isFinite(v.duration) ? v.duration : String(v.duration),
          seekableEnd: v.seekable.length ? v.seekable.end(v.seekable.length - 1) : null,
          buffered,
          getStartDate: startDate,
          paused: v.paused,
          currentSrc: v.currentSrc,
        });
      }, 500);
    },
    { selector: SELECTOR },
  );

  console.log(`관측 시작 — ${DURATION_SEC}초. 자막이 흐르는 구간인지 화면으로 확인하세요.`);

  // 자막이 하나라도 잡히면 그 시점에 DOM 구조를 덤프한다 (시작 시점엔 비어 있을 수 있음)
  let domDump = null;
  let listenerDump = null;
  const dumpDeadline = Date.now() + DURATION_SEC * 1000;
  while (Date.now() < dumpDeadline) {
    await page.waitForTimeout(1000);
    const elapsed = Math.round(since() / 1000);
    if (elapsed % 10 === 0) {
      console.log(
        `  ${elapsed}s — 자막 이벤트 ${captionEvents.length}건, 고유 id ${new Set(captionEvents.map((e) => e.id)).size}개`,
      );
    }
    if (!domDump && captionEvents.length > 0) {
      domDump = await dumpCaptionDom(page);
      listenerDump = await dumpClickListeners(page).catch((err) => ({
        error: String(err),
      }));
      console.log('  자막 DOM 덤프 완료');
    }
  }

  // 관측 종료 전에 화면 캡처 3종 시도 (P1-3 검은화면 위험 사전 확인)
  const shots = await tryScreenshots(page);

  await page
    .evaluate(() => {
      window.__probeObserver?.disconnect();
      clearInterval(window.__probeTimer);
    })
    .catch(() => {});

  if (!domDump) {
    domDump = await dumpCaptionDom(page).catch(() => null);
  }

  const report = buildReport({ domDump, listenerDump, shots });
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');

  printSummary(report);
  console.log('\n리포트 저장:', REPORT_FILE);
  console.log('캡처 저장:  ', SHOT_DIR);

  await browser.close();
  process.exit(0);
})().catch(async (err) => {
  console.error('probe 실패:', err);
  // 실패해도 지금까지 모은 것은 남긴다
  try {
    fs.writeFileSync(
      REPORT_FILE,
      JSON.stringify(buildReport({ error: String(err) }), null, 2),
      'utf8',
    );
    console.error('부분 리포트 저장:', REPORT_FILE);
  } catch {
    /* 여기서 더 할 수 있는 게 없다 */
  }
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────────
// ① 자막 DOM 덤프
// ─────────────────────────────────────────────────────────────────────────
async function dumpCaptionDom(page) {
  return page.evaluate(({ selector }) => {
    const els = [...document.querySelectorAll(selector)];
    const describe = (el) => ({
      tagName: el.tagName,
      className: el.className,
      id: el.id || null,
      dataset: { ...el.dataset }, // data-* 속성 전부
      attributes: [...el.attributes].map((a) => ({ name: a.name, value: a.value })),
      onclickAttr: el.getAttribute('onclick'),
      onclickProp: el.onclick ? el.onclick.toString() : null,
      text: el.textContent.trim().slice(0, 200),
      outerHTML: el.outerHTML.slice(0, 2000),
    });

    const parent = els[0]?.parentElement || null;
    return {
      count: els.length,
      elements: els.slice(0, 10).map(describe),
      parent: parent
        ? {
            tagName: parent.tagName,
            className: parent.className,
            id: parent.id || null,
            childCount: parent.children.length,
            dataset: { ...parent.dataset },
            outerHTMLHead: parent.outerHTML.slice(0, 3000),
          }
        : null,
      // 자막 클릭 점프를 구현할 만한 전역 함수 후보.
      // 브라우저 내장 심볼(HTMLxxx, on-이벤트)과 probe 자신은 제외해야 신호가 보인다.
      globalSeekCandidates: Object.getOwnPropertyNames(window).filter(
        (k) =>
          /seek|jump|goto|movetime|playat|subtitle|caption|ftxt/i.test(k) &&
          !/^(HTML|SVG|__probe|on[a-z])/.test(k),
      ),
    };
  }, { selector: SELECTOR });
}

// ─────────────────────────────────────────────────────────────────────────
// ① -b  click 이벤트 핸들러 소스 (CDP DOMDebugger.getEventListeners)
//      addEventListener로 붙은 핸들러는 DOM 속성으로는 안 보인다.
// ─────────────────────────────────────────────────────────────────────────
async function dumpClickListeners(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('Runtime.enable');

  const { result } = await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(SELECTOR)})`,
  });
  if (!result?.objectId) {
    await cdp.detach();
    return { note: '자막 요소를 찾지 못해 리스너를 조회하지 못함' };
  }

  const out = { self: [], ancestors: [] };

  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', {
    objectId: result.objectId,
    depth: -1, // 조상까지 훑는다 (이벤트 위임 구조일 수 있음)
    pierce: true,
  });

  for (const l of listeners || []) {
    const entry = {
      type: l.type,
      useCapture: l.useCapture,
      scriptId: l.scriptId,
      lineNumber: l.lineNumber,
      columnNumber: l.columnNumber,
      handlerSource: null,
    };
    if (l.handler?.objectId) {
      try {
        const src = await cdp.send('Runtime.callFunctionOn', {
          objectId: l.handler.objectId,
          functionDeclaration: 'function(){ return this.toString(); }',
          returnByValue: true,
        });
        entry.handlerSource = src?.result?.value ?? null;
      } catch {
        /* 핸들러 소스를 못 얻어도 위치 정보는 남는다 */
      }
    }
    (l.type === 'click' ? out.self : out.ancestors).push(entry);
  }

  await cdp.detach();
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// ⑤ 화면 캡처 3종 (P1-3 검은화면 위험 사전 확인)
// ─────────────────────────────────────────────────────────────────────────
async function tryScreenshots(page) {
  const out = {};

  // 방법 1: Playwright video 엘리먼트 캡처
  try {
    const p = path.join(SHOT_DIR, '1-element.png');
    await page.locator('video').first().screenshot({ path: p, timeout: 10000 });
    out.elementShot = { path: p, bytes: fs.statSync(p).size };
  } catch (e) {
    out.elementShot = { error: String(e).slice(0, 200) };
  }

  // 방법 2: CDP 전체 화면 캡처
  try {
    const cdp = await page.context().newCDPSession(page);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(SHOT_DIR, '2-cdp.png');
    fs.writeFileSync(p, Buffer.from(data, 'base64'));
    out.cdpShot = { path: p, bytes: fs.statSync(p).size };
    await cdp.detach();
  } catch (e) {
    out.cdpShot = { error: String(e).slice(0, 200) };
  }

  // 방법 3: canvas.drawImage(video) — 여기서 평균 밝기까지 바로 잰다.
  // meanLuma가 0에 가까우면 프레임 자체를 못 읽는 것(DRM/HW 가속)이라
  // 방법 1·2도 검게 나올 가능성이 높다.
  try {
    const res = await page.evaluate(() => {
      const v = document.querySelector('video');
      if (!v) return { error: 'video 없음' };
      if (!v.videoWidth) return { error: 'videoWidth=0 (프레임 미로드)' };
      const c = document.createElement('canvas');
      c.width = Math.min(v.videoWidth, 640);
      c.height = Math.round((c.width / v.videoWidth) * v.videoHeight);
      const ctx = c.getContext('2d');
      try {
        ctx.drawImage(v, 0, 0, c.width, c.height);
      } catch (e) {
        return { error: 'drawImage 실패: ' + e.message };
      }
      let px;
      try {
        px = ctx.getImageData(0, 0, c.width, c.height).data;
      } catch (e) {
        return { error: 'getImageData 차단(tainted canvas): ' + e.message };
      }
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) {
        sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      }
      const meanLuma = sum / (px.length / 4);
      let dataUrl = null;
      try {
        dataUrl = c.toDataURL('image/png');
      } catch (e) {
        dataUrl = null;
      }
      return { meanLuma, width: c.width, height: c.height, dataUrl };
    });

    if (res.dataUrl) {
      const p = path.join(SHOT_DIR, '3-canvas.png');
      fs.writeFileSync(p, Buffer.from(res.dataUrl.split(',')[1], 'base64'));
      out.canvasShot = {
        path: p,
        bytes: fs.statSync(p).size,
        meanLuma: res.meanLuma,
        size: `${res.width}x${res.height}`,
      };
    } else {
      out.canvasShot = res;
    }
  } catch (e) {
    out.canvasShot = { error: String(e).slice(0, 200) };
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// 리포트 조립 — ③ id 개수 / ④ 텍스트 성장 패턴 분석
// ─────────────────────────────────────────────────────────────────────────
function buildReport(extra = {}) {
  const uniqueIds = [...new Set(captionEvents.map((e) => e.id))];

  // 같은 id의 연속 변화만 추려 시퀀스로 만든다 (동일 텍스트 반복은 제거)
  const sequences = {};
  for (const id of uniqueIds) {
    const seq = [];
    for (const e of captionEvents) {
      if (e.id !== id) continue;
      if (seq.length && seq[seq.length - 1].text === e.text) continue;
      seq.push({ t: e.t, text: e.text, videoTime: e.videoTime });
    }
    sequences[id] = seq;
  }

  // "접두사 성장" 가정 검증: 연속한 두 텍스트가 접두사 관계인가?
  let growthTransitions = 0;
  let breakTransitions = 0;
  const breakExamples = [];
  for (const id of uniqueIds) {
    const seq = sequences[id];
    for (let i = 1; i < seq.length; i++) {
      const prev = seq[i - 1].text;
      const cur = seq[i].text;
      const isGrowth = cur.startsWith(prev.slice(0, Math.min(10, prev.length)));
      if (isGrowth) growthTransitions++;
      else {
        breakTransitions++;
        if (breakExamples.length < 15) {
          breakExamples.push({ id, prev, cur, shrank: cur.length < prev.length });
        }
      }
    }
  }

  const ct = timeSamples.filter((s) => typeof s.currentTime === 'number');
  let monotonic = true;
  for (let i = 1; i < ct.length; i++) {
    if (ct[i].currentTime < ct[i - 1].currentTime - 0.01) monotonic = false;
  }

  return {
    meta: {
      url: TARGET_URL,
      durationSec: DURATION_SEC,
      observedMs: since(),
      recordedAt: new Date().toISOString(),
      ...(extra.error ? { error: extra.error } : {}),
    },

    // ③ id 재사용 판정 — 여기가 P0-3의 범위를 결정한다
    idAnalysis: {
      totalEvents: captionEvents.length,
      uniqueIdCount: uniqueIds.length,
      uniqueIds: uniqueIds.slice(0, 50),
      verdict:
        uniqueIds.length === 0
          ? '자막 이벤트 0건 — 자막이 흐르는 구간에서 다시 실행할 것'
          : uniqueIds.length <= 12
            ? '순환 재사용 확정 → P0-3 전면 수정 필요 (현재 정리본은 대부분 유실 중)'
            : '줄마다 새 엘리먼트 → 현재 로직 안전, P0-3은 경미한 수정만',
    },

    // ④ 접두사 성장 가정 검증 — lines.js 판정 로직의 근거
    growthAnalysis: {
      growthTransitions,
      breakTransitions,
      growthRatio:
        growthTransitions + breakTransitions > 0
          ? growthTransitions / (growthTransitions + breakTransitions)
          : null,
      breakExamples,
      note: 'break가 곧 "새 줄 시작"이어야 한다. shrank=true 인 사례를 눈으로 확인할 것.',
    },

    // ② 시점 소스 비교 — P0-1이 무엇을 쓸지 결정한다
    timeAnalysis: {
      sampleCount: timeSamples.length,
      currentTimeMonotonic: monotonic,
      first: ct[0] || null,
      last: ct[ct.length - 1] || null,
      isLiveGuess:
        ct.length === 0
          ? '샘플 없음 — video 엘리먼트를 못 찾았거나 재생 전'
          : typeof ct[0].duration === 'string'
            ? 'duration=' + ct[0].duration + ' → 라이브로 보임'
            : `duration=${ct[0].duration}초 유한 → VOD로 보임`,
      m3u8: m3u8Findings.slice(0, 5),
      samples: timeSamples.filter((_, i) => i % 10 === 0).slice(0, 30),
    },

    // ① DOM 구조 + 클릭 핸들러 — 딥링크/시점 정보의 출처
    domAnalysis: extra.domDump || null,
    clickListeners: extra.listenerDump || null,

    // ⑤ 캡처 가능성
    screenshots: extra.shots || null,

    // 원본 (재분석용)
    rawSequencesSample: Object.fromEntries(
      Object.entries(sequences)
        .slice(0, 8)
        .map(([id, seq]) => [id, seq.slice(0, 40)]),
    ),
  };
}

function printSummary(r) {
  const line = '─'.repeat(60);
  console.log('\n' + line);
  console.log('PROBE 요약');
  console.log(line);
  console.log(`자막 이벤트     : ${r.idAnalysis.totalEvents}건`);
  console.log(`고유 id 개수    : ${r.idAnalysis.uniqueIdCount}개`);
  console.log(`  판정          : ${r.idAnalysis.verdict}`);
  console.log(`  id 목록       : ${r.idAnalysis.uniqueIds.slice(0, 12).join(', ')}`);
  console.log(
    `접두사 성장비율 : ${
      r.growthAnalysis.growthRatio === null
        ? 'n/a'
        : (r.growthAnalysis.growthRatio * 100).toFixed(1) + '%'
    } (성장 ${r.growthAnalysis.growthTransitions} / 단절 ${r.growthAnalysis.breakTransitions})`,
  );
  console.log(`currentTime 단조증가: ${r.timeAnalysis.currentTimeMonotonic}`);
  console.log(`  ${r.timeAnalysis.isLiveGuess}`);
  console.log(
    `  첫 샘플 currentTime: ${r.timeAnalysis.first?.currentTime}, 마지막: ${r.timeAnalysis.last?.currentTime}`,
  );
  console.log(`HLS 플레이리스트 : ${r.timeAnalysis.m3u8.length}건 관측`);
  for (const m of r.timeAnalysis.m3u8) {
    console.log(
      `  - PROGRAM-DATE-TIME=${m.programDateTime || '없음'} live=${m.isLive}`,
    );
  }
  const dl = r.domAnalysis;
  if (dl) {
    console.log(`자막 요소 수     : ${dl.count}`);
    const first = dl.elements?.[0];
    if (first) {
      console.log(`  data-* 속성    : ${JSON.stringify(first.dataset)}`);
      console.log(`  onclick 속성   : ${first.onclickAttr || '없음'}`);
    }
    console.log(
      `  전역 seek 후보 : ${(dl.globalSeekCandidates || []).slice(0, 10).join(', ') || '없음'}`,
    );
  }
  const cl = r.clickListeners;
  if (cl?.self?.length) {
    console.log(`click 리스너     : ${cl.self.length}개 (핸들러 소스는 리포트 참조)`);
  } else {
    console.log(`click 리스너     : 없음 또는 조회 실패`);
  }
  const s = r.screenshots || {};
  console.log(
    `캡처 element     : ${s.elementShot?.bytes ? s.elementShot.bytes + ' bytes' : s.elementShot?.error}`,
  );
  console.log(
    `캡처 CDP         : ${s.cdpShot?.bytes ? s.cdpShot.bytes + ' bytes' : s.cdpShot?.error}`,
  );
  console.log(
    `캡처 canvas      : ${
      s.canvasShot?.meanLuma !== undefined
        ? `평균밝기 ${s.canvasShot.meanLuma.toFixed(1)} (0에 가까우면 검은화면)`
        : s.canvasShot?.error
    }`,
  );
  console.log(line);
  console.log('probe-shots/ 의 PNG 3장을 눈으로 확인하세요. 영상이 보이면 P1-3 안전.');
  console.log(line);
}
