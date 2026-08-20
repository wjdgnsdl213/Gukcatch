/**
 * raw 스트림 기록 + 정리본 주기적 flush.
 *
 * P0-4 (비정상 종료 시 정리본 유실 방지):
 *   - flushClean()을 setInterval로 30초마다 호출해 정리본을 계속 덮어쓴다.
 *     프로세스가 강제 종료돼도 최근 30초 시점까지는 파일에 남아 있다.
 *   - raw 파일명에 세션명+타임스탬프를 넣어 회의별로 분리한다. 기존 v4는
 *     `flags:'a'`(append) 고정 파일명이라 여러 회의가 한 파일에 섞였다.
 *     이 store는 파일명이 이미 회의별로 유니크하다는 전제 하에 append를
 *     유지한다 — append 자체는 "같은 세션이 재시도로 재접속했을 때 이어
 *     쓰기 위해" 필요하다.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_FLUSH_INTERVAL_MS = 30_000;

// raw는 회의당 수 MB씩 쌓이고 정리본보다 8배 가까이 커서, 프로젝트 루트에
// 두면 파일 목록이 금세 지저분해진다. 하위 폴더로 분리한다.
// 지우지는 않는다 — 정리본은 flushClean()이 30초마다 통째로 덮어쓰는 구조라
// LineTracker 상태에 버그가 생기면 원본이 어디에도 안 남는다. 실제로
// ROADMAP P0-3(정리본 대량 유실)과 lines.js 재확정 버그를 잡을 때 raw와
// 정리본을 대조한 것이 유일한 근거였다. 벽시계 시각도 raw에만 있다.
const RAW_SUBDIR = 'raw';

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 파일명에 안전한 타임스탬프: 20260818-1403 */
function timestampForFilename(date = new Date()) {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `-${pad2(date.getHours())}${pad2(date.getMinutes())}`
  );
}

/** 세션명을 파일명에 쓸 수 있게 정리 */
function sanitizeForFilename(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').trim() || 'session';
}

/** 세션명 기반 기본 파일명 쌍을 만든다 (인자로 명시적 파일명을 안 준 경우에만 사용) */
function defaultSessionFileNames(sessionName, baseDir = '.', date = new Date()) {
  const safe = sanitizeForFilename(sessionName);
  const ts = timestampForFilename(date);
  return {
    raw: path.join(baseDir, RAW_SUBDIR, `captions_raw_${safe}_${ts}.txt`),
    clean: path.join(baseDir, `captions_final_${safe}_${ts}.txt`),
  };
}

/** 영상 재생 시점을 HH:MM:SS로. null/NaN이면 자리표시자. */
function formatVideoTime(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
    return '--:--:--';
  }
  const s = Math.max(0, Math.floor(seconds));
  const hh = pad2(Math.floor(s / 3600));
  const mm = pad2(Math.floor((s % 3600) / 60));
  const ss = pad2(s % 60);
  return `${hh}:${mm}:${ss}`;
}

/** 벽시계 시각을 보조 정보로 표기 (예: 2026-08-18 14:03:11) */
function formatWallTime(ms) {
  const d = new Date(ms);
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return `${date} ${time}`;
}

class CaptionStore {
  /**
   * @param {string} rawFile
   * @param {string} cleanFile
   * @param {import('./lines').LineTracker} lineTracker
   * @param {number} flushIntervalMs
   */
  constructor({ rawFile, cleanFile, lineTracker, flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS }) {
    this.rawFile = rawFile;
    this.cleanFile = cleanFile;
    this.lineTracker = lineTracker;
    // raw/ 하위 폴더는 물론, 호출자가 명시한 경로의 상위 폴더도 없을 수 있다.
    // 여기서 만들지 않으면 createWriteStream이 ENOENT로 던지고 세션 전체가 죽는다.
    fs.mkdirSync(path.dirname(rawFile), { recursive: true });
    this.rawStream = fs.createWriteStream(rawFile, { flags: 'a' });
    this.flushTimer = setInterval(() => this.flushClean(), flushIntervalMs);
    this.flushTimer.unref?.();
  }

  /** 원본(raw) 한 줄 기록 — v4와 동일하게 "변화가 있을 때마다" 호출하는 걸 전제로 한다. */
  writeRaw(text, videoTime, wallTimeMs) {
    const vt = formatVideoTime(videoTime);
    const wt = formatWallTime(wallTimeMs);
    this.rawStream.write(`[${vt}] [${wt}] ${text}\n`);
  }

  /**
   * 정리본을 지금 상태로 다시 써낸다. 프로세스가 죽어도 최근 flush 시점까지 남는다.
   *
   * 각 줄 앞에 영상 시점을 붙인다 — LineTracker가 이미 videoTime을 들고
   * 있는데 여기서 버리고 있었다. 시점이 없으면 보고서에서 "영상 어디를
   * 봐야 하는지"를 알 수 없고(ROADMAP P0-1-a 딥링크), 보고 초안 생성 때
   * raw(중복 포함)를 쓸 수밖에 없었다. 형식은 raw의 앞부분과 같게 맞춘다.
   */
  flushClean() {
    const snapshot = this.lineTracker.getSnapshot();
    const lines = snapshot.map((e) => `[${formatVideoTime(e.videoTime)}] ${e.text}`);
    const body = lines.length ? lines.join('\n') + '\n' : '';
    fs.writeFileSync(this.cleanFile, body, 'utf8');
    return snapshot.length;
  }

  async close() {
    clearInterval(this.flushTimer);
    this.flushClean(); // 종료 직전 최종 반영
    await new Promise((resolve) => this.rawStream.end(resolve));
  }
}

module.exports = {
  CaptionStore,
  defaultSessionFileNames,
  formatVideoTime,
  formatWallTime,
  timestampForFilename,
  sanitizeForFilename,
  DEFAULT_FLUSH_INTERVAL_MS,
  RAW_SUBDIR,
};
