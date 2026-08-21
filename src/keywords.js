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
    priority: g.priority || 'normal',
    // 적용 상임위. 비어 있으면 전체 적용 — 기존 keywords.json에는 이 필드가
    // 없으므로 "없음 = 전체"여야 하위 호환이 유지된다.
    // 기관 하나가 여러 상임위를 감시할 때 관심 키워드는 대체로 공통이라
    // 세션별로 목록을 통째로 나누면 같은 키워드를 반복 입력하게 된다.
    // 그래서 목록은 하나로 두고 그룹 단위로만 범위를 좁힌다.
    sessions: Array.isArray(g.sessions) ? g.sessions.filter(Boolean) : [],
    patterns: (g.patterns || []).map((p) => ({ raw: p, normalized: normalize(p) })),
  }));
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

  /** 텍스트 한 줄에서 매칭되는 그룹을 전부 찾는다 (쿨다운 적용 전). */
  findMatches(text) {
    const normalized = normalize(text);
    if (!normalized) return [];
    const hits = [];
    for (const group of this.groups) {
      const matched = group.patterns.find((p) => normalized.includes(p.normalized));
      if (matched) {
        hits.push({
          group: group.label,
          dept: group.dept,
          priority: group.priority,
          pattern: matched.raw,
        });
      }
    }
    return hits;
  }

  /** 쿨다운 중인 그룹은 걸러내고, 통과한 히트는 쿨다운 타이머를 갱신한다. */
  filterByCooldown(hits) {
    const now = Date.now();
    const allowed = [];
    for (const hit of hits) {
      const last = this.lastHitAt.get(hit.group);
      if (last && now - last < this.cooldownMs) continue;
      this.lastHitAt.set(hit.group, now);
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
