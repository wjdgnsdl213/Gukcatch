/**
 * 누적 아카이브 (P2-3). 사이트는 회의별로만 자막을 보여준다 — "최근 3년간
 * 우리 기관이 언급된 발언 전부" 같은 횡단 검색은 사이트에서 불가능하다.
 * 이 모듈은 확정된 자막 줄(키워드 매칭 여부와 무관하게 전부)을 월별
 * JSONL 파일로 누적한다. 검색은 tools/search.js가 저장 시점이 아니라
 * 조회 시점에 수행한다 — 저장 로직과 매칭 로직을 분리해 단순하게 유지.
 */

const fs = require('fs');
const path = require('path');
const { formatVideoTime } = require('./store');

class Archive {
  constructor({ dir = 'archive' } = {}) {
    this.dir = dir;
    fs.mkdirSync(this.dir, { recursive: true });
    this.streams = new Map(); // "YYYY-MM" -> WriteStream

    // 세션(상임위)별로 이미 기록된 텍스트. 메모리만으로는 부족하다 —
    // 감시를 중지했다가 다시 시작하면 이 클래스 인스턴스 자체가 새로
    // 만들어지므로, 직전 실행에서 이미 저장한 텍스트를 몰라 중복을 못
    // 막는다. 그래서 기존 파일에서 미리 로드해 재시작에도 살아남게 한다.
    this.seenBySession = new Map();
    this._preloadSeen();
  }

  _preloadSeen() {
    for (const record of loadAllRecords(this.dir)) {
      this._markSeen(record.상임위, record.텍스트);
    }
  }

  _markSeen(session, text) {
    if (!this.seenBySession.has(session)) this.seenBySession.set(session, new Set());
    this.seenBySession.get(session).add(text);
  }

  _alreadySeen(session, text) {
    return this.seenBySession.get(session)?.has(text) ?? false;
  }

  _streamFor(date) {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!this.streams.has(key)) {
      const filePath = path.join(this.dir, `${key}.jsonl`);
      this.streams.set(key, fs.createWriteStream(filePath, { flags: 'a' }));
    }
    return this.streams.get(key);
  }

  /** @param {{session, text, videoTime, wallTime}} entry - LineTracker의 확정 이벤트 */
  record(entry) {
    // 완전히 동일한 텍스트가 같은 세션에서 이미 기록된 적 있으면 건너뛴다.
    // VOD처럼 항상 처음부터 재생되는 사이트에서 감시를 여러 번 재시작하면
    // 매번 같은 초반 구간이 새 세션으로 다시 캡처되는 문제가 실사용 중
    // 실제로 발생했다(같은 문장이 짧은 시간 안에 수십 번 중복 기록됨).
    // 트레이드오프: "감사합니다"처럼 정말 짧게 반복되는 상투어는 두 번째
    // 부터 걸러진다 — 완전 동일 문장의 우연한 재발화보다 재시작발 중복이
    // 훨씬 흔하고 피해가 커서 이쪽을 택했다.
    if (this._alreadySeen(entry.session, entry.text)) return;
    this._markSeen(entry.session, entry.text);

    const date = new Date(entry.wallTime || Date.now());
    const record = {
      상임위: entry.session,
      일자: date.toISOString().slice(0, 10),
      영상시점: formatVideoTime(entry.videoTime),
      텍스트: entry.text,
    };
    this._streamFor(date).write(JSON.stringify(record) + '\n');
  }

  async close() {
    await Promise.all([...this.streams.values()].map((s) => new Promise((resolve) => s.end(resolve))));
  }
}

/** tools/search.js·tools/stats.js가 공유하는 로더 — dir 안의 모든 *.jsonl을 읽는다. */
function loadAllRecords(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  const records = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // 손상된 줄은 건너뛴다 (프로세스 강제종료로 잘린 마지막 줄일 수 있음)
      }
    }
  }
  return records;
}

module.exports = { Archive, loadAllRecords };
