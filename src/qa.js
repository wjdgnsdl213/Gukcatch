/**
 * 질의-답변(Q&A) 블록 자동 분리 (P2-1) — 규칙 기반, LLM 없이 100% 동작.
 *
 * 실무자가 필요한 단위는 문장이 아니라 "○○○ 위원 질의 ↔ 이사장 답변" 한
 * 쌍이다. 완벽한 요약은 아니지만 "찾아 읽는 시간"은 없앨 수 있다.
 *
 * 화자 전환 신호로 블록을 자른다. 같은 타입(질의/답변)이 연속되면 한
 * 블록으로 이어 붙이고, 화자가 바뀌면(다른 위원 이름이 다시 감지되면)
 * 새 블록으로 나눈다.
 */

// "...위원님"은 로드맵 원안에 있던 신호지만, 실제 회의 자막으로 검증하니
// "참석해 주신 위원님", "위원님 여러분들께" 같은 사회적 인사치레에 계속
// 등장해 화자 없이 블록을 열어버리는 문제가 있었다(뒤에 나온 첫 실제
// 이름이 개회사 전체에 소급 적용됨). 실제로 신뢰할 수 있는 신호는 "○○○
// 위원"처럼 이름이 명시된 경우뿐이라 그쪽으로 통합했다 — extractSpeakerName()
// 이 이름을 잡으면 그 자체로 질의 신호로 취급한다(아래 detectSignal 참조).
const QUESTION_PATTERNS = [/질의하겠습니다/, /질의해\s*주시기\s*바랍니다/];
// "위원" 뒤에 "장"(위원장) 또는 "회"("전문위원회", "조정위원회" 등 조직명)가
// 오면 사람이 아니다 — 실제 회의 자막에서 "조정위원회 거치고", "첨단전략
// 산업위원회 심의"처럼 조직명이 매칭되는 사례를 확인해 추가했다.
const SPEAKER_PATTERN = /([가-힣]{2,4})\s*위원(?!장|회)/;

// SPEAKER_PATTERN은 "참석해 주신 위원", "우리 위원회 위원", "여야 위원"처럼
// 일반 명사구도 매칭한다 — 실제 회의 자막(2026-08-18, 산자위 3,625줄)으로
// 검증하다가 발견: 이 필터 없이는 화자가 계속 바뀐 것으로 오판되어 87개
// 블록으로 과도하게 쪼개졌다(실제 답변 신호는 4건뿐인 구간에서). 흔한
// 한국 성씨로 시작하고 흔한 오탐 단어가 아닐 때만 실제 인명으로 인정한다.
// 완벽한 개체명 인식은 아니지만("우리" 같은 예외는 여전히 통과할 수 있음),
// 명백한 오탐 대부분을 걸러낸다.
const KOREAN_SURNAMES = new Set([
  '김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황',
  '안', '송', '전', '홍', '유', '고', '문', '양', '손', '배', '백', '허', '남', '심', '노', '하',
  '곽', '성', '차', '주', '우', '구', '민', '류', '나', '진', '지', '엄', '채', '원', '천', '방',
  '공', '현', '함', '변', '염', '여', '추', '도', '소', '석', '선', '설', '마', '길', '연', '위',
  '표', '명', '기', '반', '왕', '금', '옥', '육', '인',
]);
const NON_NAME_WORDS = new Set([
  '우리', '여러', '참석', '해당', '전체', '각각', '여야', '모든', '이런', '저런',
  '주신', '하신', '선배', '여당', '야당', '다른', '같은', '이번', '조언에', '현재', '지금',
  '정보', '정부', '전문', '기노위', '원회에서', // 직책·조직명이거나 "위원회"가 4글자 제한으로 잘려 캡처된 경우
]);
// "-신"/"-한"/"-된" 등 동사·형용사 활용형 어미로 끝나면 이름이 아닐 가능성이
// 높다("주신", "하신"처럼). 위 목록에 없는 새 활용형이 나와도 여기서 걸러진다.
const VERB_ENDING_PATTERN = /(신|한|할|했|된|되신|하는|받은)$/;

function extractSpeakerName(text) {
  const m = text.match(SPEAKER_PATTERN);
  if (!m) return null;
  const candidate = m[1];
  // "위원회 위원", "~위원회에서 위원" 같은 문맥에서 "위원회"/"원회에서"가
  // 후보로 캡처되는 경우가 있다 — 후보 자체에 "위원"이 들어 있으면 사람
  // 이름일 수 없으므로 일괄 무효화한다 (개별 블랙리스트보다 일반적인 규칙).
  if (candidate.includes('위원')) return null;
  if (NON_NAME_WORDS.has(candidate)) return null;
  if (VERB_ENDING_PATTERN.test(candidate)) return null;
  if (!KOREAN_SURNAMES.has(candidate[0])) return null;
  return `${candidate} 위원`;
}

const ANSWER_PATTERNS = [
  /답변\s*드리겠습니다/,
  /예,?\s*위원님/,
  /이사장입니다/,
  /말씀\s*드리(?:겠습니다|면)/,
];

const AGENDA_PATTERNS = [/의사일정\s*제\s*\d+\s*항/, /다음\s*질의/];

function detectSignal(text) {
  for (const p of AGENDA_PATTERNS) {
    if (p.test(text)) return { type: 'agenda' };
  }
  // 이름이 명시적으로 언급되면 그 자체가 가장 신뢰도 높은 화자 전환 신호다.
  const speaker = extractSpeakerName(text);
  if (speaker) return { type: 'question', speaker };
  for (const p of QUESTION_PATTERNS) {
    if (p.test(text)) return { type: 'question', speaker: null };
  }
  for (const p of ANSWER_PATTERNS) {
    if (p.test(text)) return { type: 'answer' };
  }
  return { type: null };
}

/**
 * @param {Array<{text: string, videoTime?: number|string|null}>} lines - 확정된 자막 줄들 (순서대로)
 * @returns {Array<{type: 'question'|'answer'|'agenda'|'other', speaker: string|null, lines: Array, startTime, endTime}>}
 */
function splitIntoQABlocks(lines) {
  const blocks = [];
  let current = null;

  const closeCurrent = () => {
    if (current) blocks.push(current);
    current = null;
  };

  for (const line of lines) {
    const signal = detectSignal(line.text);

    if (signal.type === 'agenda') {
      closeCurrent();
      blocks.push({ type: 'agenda', speaker: null, lines: [line], startTime: line.videoTime, endTime: line.videoTime });
      continue;
    }

    if (signal.type === 'question' || signal.type === 'answer') {
      const speakerChanged = current?.speaker && signal.speaker && current.speaker !== signal.speaker;
      // current.type이 이미 확정된 타입(question/answer)일 때만 불일치를
      // "전환"으로 본다 — 신호 없는 줄이 중간에 껴도(그 줄은 current를 그대로
      // 유지한 채 append됨, 아래 참조) 화자가 안 바뀌면 한 블록으로 유지된다.
      // 'other'는 별개로 처리한다 — 회의 시작부터 첫 신호 전까지의 진행/개회사
      // 발언(위원장 등, 화자 다름)이라 첫 위원 발언에 합쳐지면 안 되기 때문에
      // 승격시키지 않고 그대로 블록을 닫는다.
      const typeChanged = current && current.type !== 'other' && current.type !== signal.type;
      if (current && (typeChanged || speakerChanged || current.type === 'other')) {
        closeCurrent();
      }
      if (!current) {
        current = {
          type: signal.type,
          speaker: signal.speaker || null,
          lines: [],
          startTime: line.videoTime,
          endTime: line.videoTime,
        };
      } else if (signal.speaker && !current.speaker) {
        current.speaker = signal.speaker;
      }
    }

    if (!current) {
      current = { type: 'other', speaker: null, lines: [], startTime: line.videoTime, endTime: line.videoTime };
    }

    current.lines.push(line);
    current.endTime = line.videoTime;
  }

  closeCurrent();
  return blocks;
}

/** 인접한 question → answer 블록을 하나의 쌍으로 묶는다. */
function pairQABlocks(blocks) {
  const pairs = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type !== 'question') continue;
    const next = blocks[i + 1];
    if (next && next.type === 'answer') {
      pairs.push({ question: blocks[i], answer: next });
      i++; // answer는 이미 소비
    } else {
      pairs.push({ question: blocks[i], answer: null });
    }
  }
  return pairs;
}

module.exports = { splitIntoQABlocks, pairQABlocks, detectSignal };
