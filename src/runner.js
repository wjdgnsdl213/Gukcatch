/**
 * 여러 세션(상임위)을 브라우저 인스턴스 하나로 동시 실행한다 (P1-1).
 *
 * 에러 격리: 한 세션의 시작 실패가 다른 세션까지 막으면 안 된다 — 국회는
 * 상임위가 동시에 여러 개 열리고, 그중 하나의 페이지 구조가 바뀌었다고
 * 나머지 감시까지 멈추는 건 이 도구의 존재 이유(1인 1채널 → 1PC N채널)를
 * 훼손한다. 그래서 Promise.allSettled로 기동하고, 실패한 세션만 로그로
 * 남긴 뒤 나머지로 계속 진행한다.
 */

const path = require('path');
const { chromium } = require('playwright');
const { runSession } = require('./session');
const { loadKeywords, KeywordMatcher } = require('./keywords');
const { HitDetector } = require('./hits');
const { buildChannels } = require('./notify');
const { ShotService } = require('./shot');
const { Archive } = require('./archive');

/**
 * @param {Array<{name:string, url:string, settleMs?:number, rawFile?:string, cleanFile?:string}>} sessions
 * @param {boolean} headless - 기본 false. 시연 시 화면이 보여야 하므로 명시적으로 켜야만 headless.
 * @param {string} [keywordsPath] - 없거나 파일이 없으면 키워드 알림 기능이 조용히 비활성화된다.
 * @param {import('./dashboard').Dashboard} [dashboard] - 있으면 알림 채널에 자동 포함
 * @param {string|false} [archiveDir] - false를 넘기면 아카이브 비활성 (기본은 baseDir/archive)
 * @param {(entry) => void} [onSettled] - 확정 이벤트를 추가로 받고 싶을 때
 */
async function runAll({
  sessions,
  headless = false,
  settleMs,
  watchdogIdleMs,
  baseDir = '.',
  keywordsPath,
  cooldownMs,
  dashboard,
  shotsDir,
  maxShotsPerSession,
  archiveDir,
  onSettled: externalOnSettled,
  onLog = console.log,
  onError = console.error,
}) {
  if (!sessions || sessions.length === 0) {
    throw new Error('실행할 세션이 없습니다 (config.sessions가 비어있음)');
  }

  // channel: 'chrome' — 시스템에 이미 설치된 Chrome을 그대로 자동화 (natv-caption-scraper.js 상단 주석 참조)
  const browser = await chromium.launch({ headless, channel: 'chrome' });

  const keywordGroups = loadKeywords(keywordsPath);
  const channels = buildChannels({ dashboard });
  if (keywordGroups.length === 0) {
    onLog('키워드 사전 없음 — 알림 기능 비활성 (keywords.json을 만들면 활성화됨)');
  }

  // 확정된 줄은 키워드 매칭 여부와 무관하게 전부 아카이브에 쌓는다 —
  // "회의별로만 보여주는" 사이트가 못 하는 횡단 검색(P2-3)을 위해서다.
  const archive = archiveDir === false ? null : new Archive({ dir: archiveDir || path.join(baseDir, 'archive') });

  // 세션마다 독립된 매칭기(쿨다운 상태)를 만들되, 핫 리로드(키워드 저장 시
  // 재시작 없이 즉시 반영)를 위해 나중에 다시 접근할 수 있도록 세션 설정과
  // 짝지어 둔다 — Promise.allSettled 결과가 나온 뒤에야 어느 세션이 실제로
  //떴는지 알 수 있으므로, 성공한 세션의 matcher만 추려서 보관한다.
  // sessionName을 넘겨 그룹의 "적용 상임위" 지정을 매처가 직접 거르게 한다.
  const matcherEntries = sessions.map((s) => ({
    sessionConfig: s,
    matcher: new KeywordMatcher(keywordGroups, {
      cooldownMs,
      sessionName: s.name || s.url,
    }),
  }));

  const results = await Promise.allSettled(
    matcherEntries.map(({ sessionConfig: s, matcher }) => {
      const sessionName = s.name || s.url;
      // 문맥 히스토리·캡처 상한도 세션별 독립 — 한 상임위 것이 다른 상임위를 막으면 안 되기 때문.
      const shotService = new ShotService({
        dir: shotsDir || path.join(baseDir, 'shots'),
        maxPerSession: maxShotsPerSession,
      });
      const hitDetector = new HitDetector({ matcher, sessionName, channels, baseDir, shotService, onError });

      return runSession({
        name: sessionName,
        url: s.url,
        browser,
        settleMs: s.settleMs ?? settleMs,
        watchdogIdleMs: s.watchdogIdleMs ?? watchdogIdleMs,
        rawFile: s.rawFile,
        cleanFile: s.cleanFile,
        baseDir,
        onSettled: (entry) => {
          hitDetector.onSettled(entry);
          archive?.record(entry);
          externalOnSettled?.(entry);
        },
        onLog,
        onError,
      });
    }),
  );

  const active = [];
  const activeMatchers = [];
  results.forEach((r, i) => {
    const name = sessions[i].name || sessions[i].url;
    if (r.status === 'fulfilled') {
      active.push(r.value);
      activeMatchers.push(matcherEntries[i].matcher);
    } else {
      onError(`[${name}] 세션 시작 실패 — 다른 세션은 계속 진행:`, r.reason?.message || r.reason);
    }
  });

  if (active.length === 0) {
    await browser.close().catch(() => {});
    await archive?.close().catch(() => {});
    throw new Error('모든 세션이 시작에 실패했습니다');
  }

  return {
    browser,
    sessions: active,
    async shutdownAll() {
      // 한 세션의 종료 처리 실패가 다른 세션 flush를 막지 않도록 allSettled
      await Promise.allSettled(active.map((s) => s.shutdown()));
      await archive?.close().catch(() => {});
      await browser.close().catch(() => {});
    },
    /**
     * keywords.json을 다시 읽어 실행 중인 모든 세션의 매처에 즉시 반영한다
     * (감시를 중지·재시작하지 않아도 됨). 파일이 잘못돼 있으면 loadKeywords가
     * 던지는 예외가 그대로 위로 전파되므로, 호출자가 실패를 알 수 있다.
     * @returns {number} 반영된 키워드 그룹 수
     */
    reloadKeywords() {
      const freshGroups = loadKeywords(keywordsPath);
      for (const matcher of activeMatchers) matcher.setGroups(freshGroups);
      return freshGroups.length;
    },
  };
}

module.exports = { runAll };
