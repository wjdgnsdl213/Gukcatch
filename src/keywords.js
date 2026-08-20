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
    patterns: (g.patterns || []).map((p) => ({ raw: p, normalized: normalize(p) })),
  }));
}

class KeywordMatcher {
  constructor(groups, { cooldownMs = DEFAULT_COOLDOWN_MS } = {}) {
    this.groups = groups;
    this.cooldownMs = cooldownMs;
    this.lastHitAt = new Map(); // group.label -> timestamp(ms)
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
    this.groups = groups;
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

module.exports = { loadKeywords, normalize, KeywordMatcher, DEFAULT_COOLDOWN_MS };
