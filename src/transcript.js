/**
 * 자막 파일 로드 + 줄 번호 부여 (P2-3 공용).
 *
 * 보고서 생성 경로(구간 판정 → 요약)가 모두 "몇 번째 줄"을 기준으로
 * 동작한다. Claude가 돌려준 구간이 실제 원문을 빠짐없이 덮는지 코드가
 * 검산할 수 있어야 하고(src/segment.js), 사람이 보고서를 원문과 대조할
 * 수 있어야 하기 때문이다. 줄 번호는 1부터 시작한다 — LLM에게 0-based를
 * 시키면 off-by-one이 잦다.
 *
 * 지원 형식 3종:
 *   ① raw        `[00:01:14] [2026-08-20 11:46:12] 텍스트`
 *   ② 정리본(신)  `[00:01:14] 텍스트`
 *   ③ 정리본(구)  `텍스트`            ← videoTime 기록 전에 만들어진 파일
 *
 * ③은 이미 만들어진 파일을 계속 읽기 위한 하위 호환이다. 새로 캡처한
 * 회의는 항상 ②가 된다 (src/store.js flushClean).
 */

const fs = require('fs');

const RAW_LINE_RE = /^\[(\d{2}:\d{2}:\d{2}|--:--:--)\]\s*\[[\d-]+\s[\d:]+\]\s*(.*)$/;
const CLEAN_LINE_RE = /^\[(\d{2}:\d{2}:\d{2}|--:--:--)\]\s*(.*)$/;

/** "00:01:14" → 74. 자리표시자(--:--:--)나 형식 불일치는 null. */
function parseVideoTime(hhmmss) {
  if (!hhmmss || hhmmss === '--:--:--') return null;
  const m = hhmmss.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** 초 → "00:01:14". null이면 자리표시자. */
function formatVideoTime(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '--:--:--';
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/**
 * 자막 텍스트를 줄 배열로 파싱한다.
 * @returns {Array<{no: number, text: string, videoTime: number|null, videoTimeText: string}>}
 */
function parseTranscript(text) {
  const out = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // raw를 먼저 시도한다 — raw도 CLEAN_LINE_RE에 매칭되기 때문에(뒤의
    // 벽시계 부분이 통째로 text로 들어감) 순서를 바꾸면 조용히 망가진다.
    const m = line.match(RAW_LINE_RE) || line.match(CLEAN_LINE_RE);
    const time = m ? m[1] : null;
    const body = m ? m[2].trim() : line;
    if (!body) continue;

    out.push({
      no: out.length + 1,
      text: body,
      videoTime: parseVideoTime(time),
      videoTimeText: time || '--:--:--',
    });
  }
  return out;
}

function loadTranscript(filePath) {
  return parseTranscript(fs.readFileSync(filePath, 'utf8'));
}

/**
 * LLM 입력용 줄 번호가 붙은 전문.
 * `12| [00:01:14] 텍스트` — 시점을 함께 노출해야 Claude가 발언 간격을
 * 근거로 화자 전환을 판단할 수 있다.
 */
function buildNumberedTranscript(lines) {
  return lines.map((l) => `${l.no}| [${l.videoTimeText}] ${l.text}`).join('\n');
}

/** 줄 범위들의 텍스트를 이어붙인다. 범위는 1-based, 양끝 포함. */
function sliceRanges(lines, ranges) {
  const parts = [];
  for (const r of ranges || []) {
    for (const l of lines) {
      if (l.no >= r.시작줄 && l.no <= r.끝줄) parts.push(l.text);
    }
  }
  return parts.join(' ');
}

/** 범위들 중 가장 이른 시점 (보고서의 영상 딥링크용) */
function earliestVideoTime(lines, ranges) {
  let best = null;
  for (const r of ranges || []) {
    for (const l of lines) {
      if (l.no < r.시작줄 || l.no > r.끝줄) continue;
      if (l.videoTime === null) continue;
      if (best === null || l.videoTime < best) best = l.videoTime;
    }
  }
  return best;
}

module.exports = {
  parseTranscript,
  loadTranscript,
  buildNumberedTranscript,
  sliceRanges,
  earliestVideoTime,
  parseVideoTime,
  formatVideoTime,
};
