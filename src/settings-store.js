/**
 * config.json / keywords.json 로드·저장 + 최소 검증.
 *
 * GUI(제어판)와 CLI가 같은 파일을 공유한다 — GUI에서 저장하면 CLI(
 * `node natv-caption-scraper.js`)로도 그대로 실행할 수 있고, 반대로
 * 손으로 편집한 파일도 GUI에서 바로 읽힌다. 파일이 없으면 에러 대신
 * 빈 스켈레톤을 반환한다 — GUI가 "아직 아무것도 없는" 상태를 자연스럽게
 * 보여줄 수 있어야 하기 때문이다.
 */

const fs = require('fs');

const DEFAULT_CONFIG = {
  sessions: [],
  headless: false,
  settleMs: 1800,
  watchdogIdleMs: 300000,
  maxShotsPerSession: 200,
  cooldownMs: 60000,
};

const DEFAULT_KEYWORDS = { groups: [] };

function loadJsonOrDefault(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) return structuredClone(defaultValue);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return raw;
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function loadConfigFile(filePath) {
  const raw = loadJsonOrDefault(filePath, DEFAULT_CONFIG);
  return { ...structuredClone(DEFAULT_CONFIG), ...raw };
}

/** @throws {Error} 검증 실패 시 사람이 읽을 수 있는 메시지와 함께 던진다. */
function validateConfig(data) {
  if (!data || typeof data !== 'object') throw new Error('config는 객체여야 합니다');
  if (!Array.isArray(data.sessions)) throw new Error('sessions는 배열이어야 합니다');
  data.sessions.forEach((s, i) => {
    if (!s || typeof s !== 'object') throw new Error(`sessions[${i}]는 객체여야 합니다`);
    if (!s.name || typeof s.name !== 'string' || !s.name.trim()) {
      throw new Error(`sessions[${i}].name이 비어 있습니다`);
    }
    if (!s.url || typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)) {
      throw new Error(`sessions[${i}].url("${s.url}")이 http(s):// URL이 아닙니다`);
    }
  });
  const names = data.sessions.map((s) => s.name.trim());
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`세션 이름이 중복됩니다: "${dup}"`);
}

function saveConfigFile(filePath, data) {
  validateConfig(data);
  saveJson(filePath, data);
}

function loadKeywordsFile(filePath) {
  const raw = loadJsonOrDefault(filePath, DEFAULT_KEYWORDS);
  return { groups: Array.isArray(raw.groups) ? raw.groups : [] };
}

function validateKeywords(data) {
  if (!data || typeof data !== 'object') throw new Error('keywords는 객체여야 합니다');
  if (!Array.isArray(data.groups)) throw new Error('groups는 배열이어야 합니다');
  data.groups.forEach((g, i) => {
    if (!g || typeof g !== 'object') throw new Error(`groups[${i}]는 객체여야 합니다`);
    if (!g.label || typeof g.label !== 'string' || !g.label.trim()) {
      throw new Error(`groups[${i}].label이 비어 있습니다`);
    }
    if (!Array.isArray(g.patterns) || g.patterns.length === 0) {
      throw new Error(`groups[${i}](${g.label})의 patterns가 비어 있습니다`);
    }
    if (g.patterns.some((p) => typeof p !== 'string' || !p.trim())) {
      throw new Error(`groups[${i}](${g.label})의 patterns에 빈 값이 있습니다`);
    }
    if (g.priority && !['high', 'normal'].includes(g.priority)) {
      throw new Error(`groups[${i}](${g.label}).priority는 "high" 또는 "normal"이어야 합니다`);
    }
    // sessions는 선택 항목이다. 없거나 빈 배열이면 전체 상임위에 적용된다.
    if (g.sessions !== undefined) {
      if (!Array.isArray(g.sessions)) {
        throw new Error(`groups[${i}](${g.label}).sessions는 배열이어야 합니다`);
      }
      if (g.sessions.some((s) => typeof s !== 'string' || !s.trim())) {
        throw new Error(`groups[${i}](${g.label}).sessions에 빈 값이 있습니다`);
      }
    }
  });
}

function saveKeywordsFile(filePath, data) {
  validateKeywords(data);
  saveJson(filePath, data);
}

module.exports = {
  loadConfigFile,
  saveConfigFile,
  validateConfig,
  loadKeywordsFile,
  saveKeywordsFile,
  validateKeywords,
  DEFAULT_CONFIG,
  DEFAULT_KEYWORDS,
};
