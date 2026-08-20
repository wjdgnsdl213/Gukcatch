/**
 * 자막 줄 생명주기 상태머신 — P0-2(확정 이벤트) + P0-3(id 재사용 대응).
 *
 * 배경 (ROADMAP P0-3):
 *   자막 DOM이 소수의 <p> 엘리먼트를 순환 재사용하는 구조일 가능성이 있다
 *   (ftxt1, ftxt2, ftxt3 반복). 그렇다면 새 줄이 시작될 때 같은 id에 짧은
 *   새 텍스트가 들어오는데, "이전 텍스트를 덮어쓰기만" 하면 이전 줄의
 *   완성본이 조용히 유실된다.
 *
 *   반대로 id가 줄마다 고유하다면(재사용 없음) 이 문제 자체가 발생하지
 *   않는다 — 실제로 어느 쪽인지는 라이브 방송에서만 확인 가능하다
 *   (2026-08-18 기준 probe 결과: VOD 자막은 고유 id였다. 라이브 AI 자막은
 *   미검증).
 *
 *   이 모듈은 **어느 쪽이든 안전하게 동작**하도록 설계한다:
 *     - growing   : 텍스트가 이전 텍스트의 접두사 확장 → 계속 갱신
 *     - superseded: 같은 id에 접두사 관계가 깨진 새 텍스트 도착
 *                   → 직전 버전을 즉시 확정하고 새 텍스트로 교체
 *     - settled   : SETTLE_MS 동안 변화 없음 → 확정
 *   id 재사용이 없는 경우 superseded 분기는 그냥 한 번도 발동하지 않을
 *   뿐이고, settled 분기만으로 정상 동작한다.
 *
 * raw 기록과의 관계:
 *   raw 스트림(v4 설계 그대로 유지)은 report()의 변화 감지(changed)를
 *   그대로 재사용한다 — "이전과 동일한 텍스트면 스킵"은 v4와 동일한 동작이고,
 *   확정(finalize) 여부와는 무관하게 변화가 있을 때마다 기록된다.
 */

const DEFAULT_SETTLE_MS = 1800;

/** 두 텍스트가 "성장" 관계인가 — 뒤 텍스트가 앞 텍스트의 접두사를 포함하는가 */
function isGrowthOf(prevText, curText) {
  if (!prevText) return true;
  const prefixLen = Math.min(10, prevText.length);
  return curText.startsWith(prevText.slice(0, prefixLen));
}

class LineTracker {
  /**
   * @param {number} settleMs - 이 시간 동안 변화가 없으면 확정 처리
   * @param {(entry: {id, text, videoTime, wallTime, reason}) => void} onSettled
   */
  constructor({ settleMs = DEFAULT_SETTLE_MS, onSettled } = {}) {
    this.settleMs = settleMs;
    this.onSettled = onSettled || (() => {});
    /** @type {Map<string, {text:string, videoTime:number|null, wallTime:number, confirmed:boolean}>} */
    this.lines = new Map();
    this.settleTimers = new Map();
    this.finalized = [];
    /** id -> finalized 배열에서 그 id의 마지막 확정본 위치 (성장 재확정 시 교체용) */
    this.lastFinalizedIndexById = new Map();
  }

  /**
   * 브라우저 쪽에서 넘어온 (id, text, videoTime) 한 건을 반영한다.
   * @returns {{changed: boolean}} changed=false면 이전과 동일한 텍스트(스킵)
   */
  report(id, text, videoTime) {
    const wallTime = Date.now();
    const line = this.lines.get(id);

    if (line && line.text === text) return { changed: false };

    if (line && !isGrowthOf(line.text, text)) {
      // 접두사 관계가 깨짐 = 새 줄이 시작됨. 직전 버전을 즉시 확정한다.
      this._finalize(id, line, 'superseded');
    }

    this.lines.set(id, { text, videoTime, wallTime, confirmed: false });
    this._scheduleSettle(id);
    return { changed: true };
  }

  _scheduleSettle(id) {
    clearTimeout(this.settleTimers.get(id));
    const timer = setTimeout(() => {
      this.settleTimers.delete(id);
      const line = this.lines.get(id);
      // superseded로 이미 확정되어 없어졌거나(재사용 케이스) 이미 confirmed면 스킵
      if (!line || line.confirmed) return;
      this._finalize(id, line, 'settled');
    }, this.settleMs);
    // 타이머가 프로세스 종료를 막지 않도록 (긴 회의 동안 계속 재설정되는 타이머라 unref 필수)
    timer.unref?.();
    this.settleTimers.set(id, timer);
  }

  _finalize(id, line, reason) {
    line.confirmed = true;
    const entry = {
      id,
      text: line.text,
      videoTime: line.videoTime,
      wallTime: line.wallTime,
      reason,
    };

    // 같은 id가 settle 후에도 계속 자라는 경우(발화가 SETTLE_MS보다 길게
    // 끊겼다가 이어질 때) _finalize가 여러 번 호출된다. 그대로 push하면
    // "지난 기간 동안에" / "지난 기간 동안에 충분히 검토를 했다고..." 처럼
    // 성장 도중의 토막이 정리본에 그대로 남는다 (실측: 국방위 195줄 중
    // 34줄 17.4%가 뒤 줄의 접두사였음). 설계 의도는 "가장 긴 것만 남기기"
    // 이므로, 직전 확정본을 덮어쓴다.
    //
    // 판정은 엄격한 접두사(startsWith)로만 한다 — isGrowthOf()의 앞 10자
    // 휴리스틱은 AI 자막의 재인식본("계시는"→"계신")까지 같은 줄로 묶어
    // 원문을 잃을 수 있는데, 교체는 되돌릴 수 없는 연산이라 보수적으로 간다.
    const prevIndex = this.lastFinalizedIndexById.get(id);
    const prev = prevIndex === undefined ? null : this.finalized[prevIndex];
    if (prev && entry.text.length > prev.text.length && entry.text.startsWith(prev.text)) {
      this.finalized[prevIndex] = {
        ...entry,
        // 시점은 발화가 "시작된" 때가 맞다 — 마지막 성장 시점으로 밀지 않는다.
        videoTime: prev.videoTime ?? entry.videoTime,
        wallTime: prev.wallTime,
      };
      // onSettled는 그대로 호출한다. 키워드 알림(src/hits.js)은 늘어난
      // 뒷부분에서 처음 매칭될 수 있어 확정마다 통지받아야 한다.
      this.onSettled(entry);
      return;
    }

    this.lastFinalizedIndexById.set(id, this.finalized.length);
    this.finalized.push(entry);
    this.onSettled(entry);
  }

  /**
   * 정리본 저장용 스냅샷 — 상태를 변경하지 않고 "지금 시점의 최선의 정답"을
   * 돌려준다: 이미 확정된 줄 + 아직 확정 안 됐지만 현재까지 자란 텍스트.
   * videoTime 기준으로 정렬한다 (id가 재사용되는 경우 등장 순서 ≠ 발화 순서).
   */
  getSnapshot() {
    const pending = [];
    for (const [id, line] of this.lines) {
      if (!line.confirmed) {
        pending.push({
          id,
          text: line.text,
          videoTime: line.videoTime,
          wallTime: line.wallTime,
          reason: 'pending',
        });
      }
    }
    const list = [...this.finalized, ...pending];
    list.sort((a, b) => {
      const av = a.videoTime ?? Number.POSITIVE_INFINITY;
      const bv = b.videoTime ?? Number.POSITIVE_INFINITY;
      if (av !== bv) return av - bv;
      return a.wallTime - b.wallTime;
    });
    return list;
  }

  /**
   * 프로세스 종료 시에만 호출한다. 아직 확정되지 않은 모든 줄을 강제로
   * 확정 처리한다. (주기적 flush에서는 절대 호출하면 안 됨 — 계속 자라는
   * 중인 줄이 30초마다 조기 확정되어 버린다.)
   */
  finalizeAll(reason = 'shutdown') {
    for (const timer of this.settleTimers.values()) clearTimeout(timer);
    this.settleTimers.clear();
    for (const [id, line] of this.lines) {
      if (!line.confirmed) this._finalize(id, line, reason);
    }
  }
}

module.exports = { LineTracker, isGrowthOf, DEFAULT_SETTLE_MS };
