#!/usr/bin/env node
/**
 * 국회 인터넷의사중계시스템 - AI 자막 실시간 캡처 스크립트 (v5)
 *
 * 사용법:
 *   npm install
 *   node natv-caption-scraper.js "https://assembly.webcast.go.kr/main/player.asp?xcode=58&xcgcd=DCM000058224380201&" [raw파일] [정리본파일]
 *   node natv-caption-scraper.js --config config.json     ← 다중 상임위 동시 감시 (P1-1)
 *   node natv-caption-scraper.js                          ← 인자 없으면 같은 폴더의 config.json을 찾아 다중 세션 모드로
 *
 * v3 -> v4 변경 이유는 src/capture.js 상단에 그대로 보존했다 — 자막 수집
 * 전략(mutation 종류 해석을 포기하고 전체 재스캔으로 단순화)의 판단 근거라
 * 발표 자료로도 쓸 수 있기 때문이다.
 *
 * v4 -> v5 변경 이유:
 *   단일 파일 스크립트를 기능 단위 모듈(src/)로 분리했다. 동작은 v4와
 *   동일하되(무회귀), ROADMAP P0/P1-1 항목을 추가했다:
 *     - 영상 재생 시점(videoTime) 저장 (P0-1, src/capture.js·src/store.js)
 *     - 자막 id 재사용에도 안전한 확정 판정 (P0-3, src/lines.js)
 *     - 알림/분석용 확정 이벤트 분리 (P0-2, src/lines.js)
 *     - 30초 주기 정리본 flush + 다중 종료 핸들러 + watchdog (P0-4, src/store.js·src/session.js)
 *     - 다중 상임위 동시 감시 + 세션별 에러 격리 (P1-1, src/runner.js)
 *     - 키워드 감지 + 알림(콘솔/토스트/Dooray/메일/대시보드) (P1-2, src/keywords.js·src/hits.js·src/notify/·src/dashboard.js)
 *     - 히트 시점 화면 캡처 3단 폴백 (P1-3, src/shot.js)
 *     - 누적 아카이브 (P2-3, src/archive.js) — 횡단 검색은 tools/search.js, 통계는 tools/stats.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs = require('fs');
const path = require('path');
const { runAll } = require('./src/runner');
const { Dashboard } = require('./src/dashboard');

const DEFAULT_URL =
  'https://assembly.webcast.go.kr/main/player.asp?xcode=58&xcgcd=DCM000058224380201&';

const args = process.argv.slice(2);
let shuttingDown = false;

/** config.json 경로를 찾는다. --config 인자 > 인자 없음(또는 URL 아님) 시 기본 config.json 탐색 */
function resolveConfigPath() {
  if (args[0] === '--config') return args[1] || path.join(__dirname, 'config.json');
  if (!args[0] || !/^https?:\/\//i.test(args[0])) {
    const candidate = path.join(__dirname, 'config.json');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function loadConfig() {
  const configPath = resolveConfigPath();
  if (!configPath) return null;
  if (!fs.existsSync(configPath)) {
    throw new Error(`config 파일을 찾을 수 없음: ${configPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!Array.isArray(raw.sessions) || raw.sessions.length === 0) {
    throw new Error(`${configPath}: "sessions" 배열이 비어있거나 없습니다`);
  }
  return { ...raw, path: configPath };
}

(async () => {
  const config = loadConfig();

  const sessions = config
    ? config.sessions
    : [
        {
          name: 'default',
          url: args[0] || DEFAULT_URL,
          rawFile: args[1],
          cleanFile: args[2],
        },
      ];

  if (config) {
    console.log(`다중 세션 모드 — ${sessions.length}개 세션 (config: ${config.path})`);
  }

  const shotsDir = path.join(__dirname, config?.shotsDir || 'shots');

  // 대시보드는 필수 채널이 아니다 — 포트 충돌 등으로 못 뜨면 경고만 남기고 계속 진행
  let dashboard = null;
  const dashboardPort = config?.dashboardPort ?? 7878;
  try {
    dashboard = new Dashboard({ port: dashboardPort, shotsDir });
    await dashboard.start();
    console.log(`대시보드: http://localhost:${dashboardPort}`);
  } catch (err) {
    console.warn('대시보드 시작 실패 (건너뜀):', err.message);
    dashboard = null;
  }

  const keywordsPath = path.join(__dirname, config?.keywordsFile || 'keywords.json');

  const runtime = await runAll({
    sessions,
    headless: config?.headless ?? false, // 기본 false — 시연 시 화면이 보여야 함
    settleMs: config?.settleMs,
    watchdogIdleMs: config?.watchdogIdleMs,
    keywordsPath,
    cooldownMs: config?.cooldownMs,
    dashboard,
    shotsDir,
    maxShotsPerSession: config?.maxShotsPerSession,
    archiveDir: config?.archiveDir ? path.join(__dirname, config.archiveDir) : undefined,
  });

  console.log('자막 수집 시작. Ctrl+C로 종료.');

  const shutdown = async (signal) => {
    if (shuttingDown) return; // P0-4: 중복 실행 방지
    shuttingDown = true;
    console.log(`\n${signal} 수신 — 종료 처리 중...`);
    try {
      await runtime.shutdownAll();
      await dashboard?.close();
    } catch (err) {
      console.error('종료 처리 중 오류:', err);
    }
    console.log('종료.');
    for (const s of runtime.sessions) {
      console.log(`[${s.name}] 원본:   ${s.files.raw}`);
      console.log(`[${s.name}] 정리본: ${s.files.clean}`);
    }
    process.exit(0);
  };

  // P0-4: SIGINT뿐 아니라 SIGTERM/uncaughtException/unhandledRejection까지 전부 연결
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    console.error('처리되지 않은 예외:', err);
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    console.error('처리되지 않은 프로미스 거부:', reason);
    shutdown('unhandledRejection');
  });
})().catch((err) => {
  console.error('초기화 실패:', err);
  process.exit(1);
});
