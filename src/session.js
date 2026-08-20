/**
 * 세션 하나(= page 하나)를 실행한다. browser는 호출자가 만들어 전달한다
 * (P1-1에서 여러 세션이 browser 인스턴스 하나를 공유하기 위함 — context만
 * 세션별로 분리).
 *
 * P0-4 watchdog:
 *   자막이 오래 갱신되지 않으면 새로고침 + 재생/자막 버튼 재클릭을 시도한다.
 *   국회 회의는 정회(휴식) 시간이 수십 분 이어질 수 있어 임계값을 너무
 *   짧게 잡으면 정회 중에 불필요한 새로고침이 반복된다 — 기본 5분.
 */

const {
  CAPTION_SELECTOR,
  installCaptureObserver,
  startPlaybackAndCaptions,
} = require('./capture');
const { LineTracker } = require('./lines');
const { CaptionStore, defaultSessionFileNames, formatVideoTime } = require('./store');

const DEFAULT_WATCHDOG_IDLE_MS = 5 * 60 * 1000; // 5분
const WATCHDOG_CHECK_INTERVAL_MS = 60 * 1000; // 1분마다 체크

/** 재생/자막 버튼 클릭 실패를 v4처럼 콘솔에 안내한다 (조용히 삼키지 않음). */
async function logPlaybackStart(page, name, onLog) {
  const { playClicked, captionClicked } = await startPlaybackAndCaptions(page);
  if (!playClicked) onLog(`[${name}] 재생 버튼을 못 찾음 (이미 재생 중일 수 있음)`);
  if (!captionClicked) onLog(`[${name}] 자막 버튼을 못 찾음 (이미 켜져 있을 수 있음)`);
}

/**
 * @returns {Promise<{
 *   name: string, page: import('playwright').Page, context: import('playwright').BrowserContext,
 *   lineTracker: import('./lines').LineTracker, store: import('./store').CaptionStore,
 *   files: {raw: string, clean: string}, shutdown: () => Promise<void>
 * }>}
 */
async function runSession({
  name = 'default',
  url,
  browser,
  settleMs,
  rawFile,
  cleanFile,
  baseDir = '.',
  watchdogIdleMs = DEFAULT_WATCHDOG_IDLE_MS,
  onSettled,
  onLog = console.log,
  onError = console.error,
}) {
  if (!url) throw new Error(`[${name}] URL이 지정되지 않음`);

  const context = await browser.newContext({ locale: 'ko-KR' });
  const page = await context.newPage();

  // P1-1 에러 격리: page 크래시가 나도 이 세션 안에서만 로그로 남긴다.
  // 프로세스 전체를 죽이지 않으면(unhandledRejection으로 새지 않으면) 다른
  // 세션은 계속 동작하고, watchdog이 무갱신을 감지해 복구를 시도한다.
  page.on('crash', () => onError(`[${name}] page crash 감지 — watchdog이 복구를 시도함`));

  const lineTracker = new LineTracker({
    settleMs,
    // page를 함께 넘긴다 — P1-3 화면 캡처가 히트 시점의 실제 페이지에
    // 접근해야 하기 때문 (src/hits.js가 entry.page로 캡처를 트리거함)
    onSettled: (entry) => onSettled?.({ session: name, page, ...entry }),
  });

  const files =
    rawFile && cleanFile ? { raw: rawFile, clean: cleanFile } : defaultSessionFileNames(name, baseDir);

  const store = new CaptionStore({ rawFile: files.raw, cleanFile: files.clean, lineTracker });

  let lastActivityAt = Date.now();

  // CaptionStore 생성 시점에 raw 파일과 30초 flush 타이머가 이미 만들어진다.
  // 아래 초기화(goto/클릭/observer 설치)가 실패하면 그 store와 context가
  // 아무도 정리하지 않는 좀비로 남는다 — 특히 P1-1 다중 세션에서 한 세션의
  // URL이 죽어 있으면 실패한 세션마다 좀비 타이머가 쌓인다. 반드시 정리한다.
  try {
    await page.exposeFunction('__reportCaption', (id, text, videoTime) => {
      const { changed } = lineTracker.report(id, text, videoTime);
      if (!changed) return; // v4와 동일: 이전과 같은 텍스트 반복은 raw에도 기록하지 않는다
      const wallTime = Date.now();
      lastActivityAt = wallTime;
      store.writeRaw(text, videoTime, wallTime);
      onLog(`[${name}] ${formatVideoTime(videoTime)} ${text}`);
    });

    onLog(`[${name}] 페이지 접속 중: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await logPlaybackStart(page, name, onLog);
    await page.evaluate(installCaptureObserver, CAPTION_SELECTOR);
    onLog(`[${name}] 자막 수집 시작`);
  } catch (err) {
    await store.close().catch(() => {});
    await context.close().catch(() => {});
    throw err;
  }

  let watchdogBusy = false;
  const watchdogTimer = setInterval(async () => {
    if (watchdogBusy) return;
    if (Date.now() - lastActivityAt <= watchdogIdleMs) return;
    watchdogBusy = true;
    onLog(`[${name}] ${Math.round(watchdogIdleMs / 60000)}분간 자막 갱신 없음 — 새로고침 시도`);
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await logPlaybackStart(page, name, onLog);
      await page.evaluate(installCaptureObserver, CAPTION_SELECTOR);
      lastActivityAt = Date.now(); // 재시도 직후 리셋 — 연속 재시도 방지
      onLog(`[${name}] watchdog 복구 완료`);
    } catch (err) {
      onError(`[${name}] watchdog 복구 실패:`, err.message);
    } finally {
      watchdogBusy = false;
    }
  }, WATCHDOG_CHECK_INTERVAL_MS);
  watchdogTimer.unref?.();

  return {
    name,
    page,
    context,
    lineTracker,
    store,
    files,
    async shutdown() {
      clearInterval(watchdogTimer);
      lineTracker.finalizeAll('shutdown');
      await store.close();
      await context.close().catch(() => {});
    },
  };
}

module.exports = { runSession, DEFAULT_WATCHDOG_IDLE_MS };
