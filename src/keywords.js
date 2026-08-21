/**
 * 키워드 사전 로드 + 정규화 매칭 + 쿨다운 (P1-2).
 *
 * AI 자막은 고유명사를 자주 틀린다 — 단순 문자열 매칭은 대부분 놓친다.
 * keywords.json에 동의어/약칭/띄어쓰기 변형을 최대한 넣어두는 것이 탐지율의
 * 핵심이고, 이 모듈은 그 사전을 "공백 제거 후 부분 문자열 포함"으로 비교한다.
 *
 * 쿨다운은 그룹(라벨) 단위다 — 같은 안건을 몇 분간 논의하는 동안 매 문장마다
 * 알림이 폭주하는 것을 막는다.
 */

const fs = require('fs');

const DEFAULT_COOLDOWN_MS = 60_000;

/** 공백을 제거해 정규화한다. AI 자막이 "국민 건강 보험 공단"처럼 띄어 쓰는 경우가 많다. */
function normalize(text) {
  return String(text).replace(/\s+/g, '');
}

/**
 * keywords.json을 읽어 매칭에 쓰기 좋은 형태로 반환한다.
 * 파일이 없으면 빈 배열(키워드 기능 비활성) — 필수 의존성이 아니다.
 */
function loadKeywords(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return (raw.groups || []).map((g) => ({
    label: g.label,
    dept: g.dept || null,
    // 묶음 기본 알림 여부. 개별 키워드가 지정하지 않았을 때만 쓰인다.
    // 구 priority(high/normal)에서 넘어오는 파일은 둘 다 true로 본다 —
    // normal 그룹도 토스트·대시보드 알림을 받고 있었으므로 false로 매핑하면
    // 쓰던 알림이 말없이 꺼진다.
    notify: g.notify === undefined ? true : Boolean(g.notify),
    // 이 묶음 전용 수신자. 비면 config.json의 기본 수신자를 쓴다.
    emails: Array.isArray(g.emails) ? g.emails.filter(Boolean) : [],
    // 적용 상임위. 비어 있으면 전체 적용 — 기존 keywords.json에는 이 필드가
    // 없으므로 "없음 = 전체"여야 하위 호환이 유지된다.
    // 묶음을 나누는 기준이 바로 이것이다: 상임위마다 다른 키워드를 볼 때
    // 묶음을 따로 만들고, 공통 키워드는 상임위를 비운 묶음에 모아 둔다.
    sessions: Array.isArray(g.sessions) ? g.sessions.filter(Boolean) : [],
    patterns: parsePatterns(g),
  }));
}

/**
 * 키워드 목록을 매칭용 형태로 만든다.
 *
 * 두 형식을 모두 받는다:
 *   "소상공인"                        (구 형식 — 묶음의 notify를 따른다)
 *   { text: "소상공인", notify: false } (신 형식 — 키워드마다 알림 지정)
 *
 * 알림 여부를 키워드 단위로 둔 이유: 한 묶음 안에서도 어떤 말은 알림을
 * 받고 어떤 말은 기록만 남기고 싶은 경우가 실제로 있다. 묶음은 "어느
 * 상임위에 적용할지"를 나누는 단위이지 알림을 나누는 단위가 아니다.
 */
function parsePatterns(group) {
  const groupNotify = group.notify === undefined ? true : Boolean(group.notify);
  return (group.patterns || [])
    .map((p) => {
      const text = typeof p === 'string' ? p : String(p?.text ?? '');
      const notify =
        typeof p === 'string' || p?.notify === undefined ? groupNotify : Boolean(p.notify);
      return { raw: text, normalized: normalize(text), notify };
    })
    .filter((p) => p.raw.trim());
}

/** 이 그룹이 해당 상임위에 적용되는가. sessions가 비면 전체 적용. */
function appliesToSession(group, sessionName) {
  if (!group.sessions || group.sessions.length === 0) return true;
  if (!sessionName) return true; // 세션을 모르면 거르지 않는다 (보수적)
  return group.sessions.includes(sessionName);
}

class KeywordMatcher {
  /**
   * @param {string} [sessionName] - 지정하면 그 상임위에 적용되는 그룹만 본다.
   *   runner.js가 세션마다 매처를 따로 만들므로 여기서 한 번만 걸러두면 된다.
   */
  constructor(groups, { cooldownMs = DEFAULT_COOLDOWN_MS, sessionName = null } = {}) {
    this.sessionName = sessionName;
    this.groups = this._scope(groups);
    this.allGroups = groups; // 핫 리로드 시 원본 유지 (setGroups가 다시 거른다)
    this.cooldownMs = cooldownMs;
    this.lastHitAt = new Map(); // group.label -> timestamp(ms)
  }

  _scope(groups) {
    return (groups || []).filter((g) => appliesToSession(g, this.sessionName));
  }

  get enabled() {
    return this.groups.length > 0;
  }

  /**
   * 실행 중에 키워드를 갈아끼운다 (핫 리로드). lastHitAt(쿨다운 상태)은
   * 그대로 둔다 — 그룹 라벨이 그대로면 쿨다운도 유지되는 게 자연스럽고,
   * 사라진 그룹의 잔여 기록은 그냥 안 쓰일 뿐 해가 없다.
   */
  setGroups(groups) {
    this.allGroups = groups;
    this.groups = this._scope(groups);
  }

  /**
   * 텍스트 한 줄에서 매칭되는 키워드를 전부 찾는다 (쿨다운 적용 전).
   *
   * 묶음당 하나가 아니라 키워드마다 하나씩 돌려준다 — 알림 여부가 키워드
   * 단위라, 한 문장에 알림 켠 말과 끈 말이 같이 있으면 둘을 구분해서
   * 처리해야 한다. 묶음당 첫 매칭만 보던 예전 방식으로는 뒤엣것이 조용히
   * 사라졌다.
   */
  findMatches(text) {
    const normalized = normalize(text);
    if (!normalized) return [];
    const hits = [];
    for (const group of this.groups) {
      for (const p of group.patterns) {
        if (!normalized.includes(p.normalized)) continue;
        hits.push({
          group: group.label,
          dept: group.dept,
          notify: p.notify,
          emails: group.emails,
          pattern: p.raw,
        });
      }
    }
    return hits;
  }

  /**
   * 쿨다운 중인 키워드는 걸러내고, 통과한 히트는 타이머를 갱신한다.
   *
   * 키(묶음+키워드) 단위로 잰다. 묶음 단위로 재면 알림을 끈 키워드가 먼저
   * 걸렸을 때 그 쿨다운이 같은 묶음의 알림 켠 키워드까지 막아버린다.
   */
  filterByCooldown(hits) {
    const now = Date.now();
    const allowed = [];
    for (const hit of hits) {
      const key = `${hit.group}|${hit.pattern}`;
      const last = this.lastHitAt.get(key);
      if (last && now - last < this.cooldownMs) continue;
      this.lastHitAt.set(key, now);
      allowed.push(hit);
    }
    return allowed;
  }

  /** findMatches + filterByCooldown 합성 — 흔한 사용 경로 */
  match(text) {
    return this.filterByCooldown(this.findMatches(text));
  }
}

module.exports = { loadKeywords, normalize, KeywordMatcher, appliesToSession, DEFAULT_COOLDOWN_MS };
