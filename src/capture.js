/**
 * 브라우저 컨텍스트에 주입되는 자막 캡처 로직.
 *
 * v3 -> v4 변경 이유:
 *   v2, v3는 "정확히 언제 한 줄이 완성되는지"를 mutation 종류(characterData vs
 *   childList)를 해석해서 판단하려 했는데, 자막 시스템이 textContent를 통째로
 *   교체하는지 텍스트 노드를 직접 수정하는지 등 내부 구현을 정확히 모르는 상태라
 *   케이스를 하나씩 놓치는 패턴이 반복됨.
 *
 *   v4는 완성 시점을 실시간으로 판단하는 걸 포기하고, 대신:
 *     - 어떤 mutation이든 감지되면 그 즉시 "지금 화면에 보이는 자막 줄 전체"를
 *       다시 읽어서 보냄 (mutation의 종류/대상을 해석하지 않음)
 *     - 같은 id(줄)라도 텍스트가 바뀌면 Node 측(reportCaption)으로 그대로 보냄
 *       → 한 줄이 여러 번(자라는 과정 그대로) 기록될 수 있음
 *     - 실시간 중엔 "최종본" 여부를 안 가리고, 확정 판정(성장/정착/교체)은
 *       Node 측 src/lines.js가 담당한다 (v5 — P0-2/P0-3)
 *
 * v4 -> v5 변경 (P0-1):
 *   reportCaption에 videoTime(초)을 함께 넘긴다. 영상 재생 위치가 없으면
 *   알림을 받아도 "영상 어디를 봐야 하는지"를 알 수 없기 때문.
 *
 * v5 -> v6 변경 (2026-08-20, 실제 라이브 방송으로 검증):
 *   재생/자막 버튼 트리거가 VOD와 라이브에서 서로 다르다는 걸 확인했다.
 *     - VOD(w3.assembly.go.kr): .vjs-big-play-button 클릭으로 재생
 *     - 라이브(assembly.webcast.go.kr): "영상재생하기" 버튼을 눌러야 재생 시작
 *       (.vjs-big-play-button은 존재하지만 클릭해도 재생 안 됨 — 이 사이트는
 *       자동재생 정책 우회용 게이트 버튼을 별도로 둔 것으로 보인다)
 *     - AI 자막 버튼 문구는 "AI 자막보기 켜기"가 아니라 "AI 자막보기"
 *       (class="btn btn_subtit btn_subtit_ai") — "켜기"가 붙은 적이 없었다.
 *       이전 코드는 정확히 이 이유로 라이브에서도 자막 버튼을 못 찾고 있었다.
 *   CAPTION_SELECTOR(`p[class*="video_subtitle_full"]`)와 ftxt 클래스 규칙은
 *   라이브에서 그대로 확인됨(예: class="video_subtitle_full ftxt455") —
 *   원래 v4의 가정이 맞았다.
 */

const CAPTION_SELECTOR = 'p[class*="video_subtitle_full"]';

/**
 * page.evaluate에 그대로 전달되는 함수. Node 쪽 모듈 스코프와 완전히 분리된
 * 브라우저 실행 컨텍스트이므로 외부 변수를 클로저로 참조할 수 없다 —
 * 필요한 값(selector)은 인자로 받는다.
 */
function installCaptureObserver(selector) {
  function idOf(el) {
    return [...el.classList].find((c) => c.startsWith('ftxt')) || el.className;
  }

  // mutation이 뭐가 어떻게 바뀌었는지 해석하지 않고, 현재 상태 전체를 그냥 다시 읽음
  function scanAndReport() {
    const video = document.querySelector('video');
    const videoTime = video ? video.currentTime : null;
    document.querySelectorAll(selector).forEach((el) => {
      const text = el.textContent.trim();
      if (text) window.__reportCaption(idOf(el), text, videoTime);
    });
  }

  scanAndReport(); // 시작 시점 스냅샷

  const observer = new MutationObserver(() => {
    scanAndReport(); // 뭐가 바뀌었든, 일단 전체를 다시 훑음
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  window.__captionObserver = observer;
  return true;
}

function uninstallCaptureObserver() {
  window.__captionObserver?.disconnect();
  window.__captionObserver = null;
}

// 재생 트리거 후보 — 순서대로 시도한다. 라이브는 "영상재생하기" 버튼이 먼저
// 필요하고, VOD는 그 버튼이 없으니 .vjs-big-play-button으로 넘어간다.
const PLAY_TRIGGER_SELECTORS = ['button:has-text("영상재생하기")', '.vjs-big-play-button'];

// AI 자막 켜기 트리거 후보. class 셀렉터(a.btn_subtit_ai)가 가장 정확하지만,
// 사이트 개편으로 클래스명이 바뀌는 경우를 대비해 텍스트 기반 폴백도 둔다.
const CAPTION_TRIGGER_SELECTORS = [
  'a.btn_subtit_ai',
  'a:has-text("AI 자막보기 켜기")', // 과거 가정 — 실제로 관측된 적은 없지만 폴백으로 유지
  'a:has-text("AI 자막보기")',
];

/** 후보 셀렉터를 순서대로 시도해 처음 클릭에 성공하는 것을 쓴다. */
async function clickFirstMatch(page, selectors, timeout = 3000) {
  for (const selector of selectors) {
    const ok = await page
      .locator(selector)
      .first() // 여러 개 매칭되면 Playwright가 strict mode violation을 던지므로 필수
      .click({ timeout })
      .then(() => true)
      .catch(() => false);
    if (ok) return true;
  }
  return false;
}

/**
 * 자막 버튼/재생 버튼 클릭 등 페이지 진입 시퀀스. session.js와 watchdog(재시도)가 공유한다.
 * 두 클릭 모두 실패해도(이미 재생 중/이미 켜져 있음 등) 진행은 계속하되,
 * 호출자가 원인을 알 수 있도록 결과를 반환한다 (v4는 이 실패를 콘솔에
 * 안내했었다 — 조용히 삼키면 회귀).
 */
async function startPlaybackAndCaptions(page) {
  const playClicked = await clickFirstMatch(page, PLAY_TRIGGER_SELECTORS);
  await page.waitForTimeout(1500);
  const captionClicked = await clickFirstMatch(page, CAPTION_TRIGGER_SELECTORS);
  await page.waitForTimeout(1000);
  return { playClicked, captionClicked };
}

module.exports = {
  CAPTION_SELECTOR,
  installCaptureObserver,
  uninstallCaptureObserver,
  startPlaybackAndCaptions,
};
