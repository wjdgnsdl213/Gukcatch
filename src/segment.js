/**
 * 패스 1 — 회의록 전문에서 발언 구간과 질의-답변 대응을 판정한다 (P2-3).
 *
 * 왜 규칙(src/qa.js)에서 Claude로 옮겼는가:
 *   2026-08-20 국방위 실데이터로 검증한 결과, 규칙 기반 분리는 이 회의를
 *   6블록으로 나누고 질의 3건 중 2건을 "답변 못 찾음"으로 떨어뜨렸다.
 *   진행 방식이 [민홍철 → 천하람 → 한기호 위원이 연달아 질의] → [답변자가
 *   한 번에 통합 답변]이었기 때문인데, pairQABlocks()는 "바로 다음 블록이
 *   answer인가"만 보므로 마지막 질의만 답변과 이어졌다.
 *
 *   정확한 처리는 "17,875자짜리 통합 답변을 주제별로 쪼개 세 위원에게 각각
 *   배분"하는 것이고, 이건 내용을 이해해야만 가능하다 — 정규식으로는 시도할
 *   방법 자체가 없다. 그래서 [어디서 끊고 / 누가 말했고 / 어느 답변이 어느
 *   질의 것인가]를 Claude가 정한다.
 *
 * 대신 코드가 검산한다:
 *   Claude가 모든 판정에 줄 번호를 달아 돌려주므로, 원문 1~N줄이 빠짐없이
 *   덮였는지 verifyCoverage()가 산술로 확인한다. 덮이지 않은 구간은 보고서에
 *   "미분류"로 강제 표기된다 — 기존 방식에서 other 블록이 조용히 사라지던
 *   문제(국방위 기준 5.7%)가 구조적으로 불가능해진다.
 *
 * 회의 전문을 통째로 넣는다. 정리본 실측이 11분에 7,644자였으므로 2시간
 * 회의도 8만자 남짓이고, 1M 컨텍스트에 여유롭게 들어간다.
 */

const { buildNumberedTranscript } = require('./transcript');
const { detectSignal } = require('./qa');

const DEFAULT_SEGMENT_MODEL = process.env.SEGMENT_MODEL || 'claude-sonnet-5';

const RANGE_SCHEMA = {
  type: 'object',
  properties: {
    시작줄: { type: 'integer', description: '구간 시작 줄 번호 (1부터, 포함)' },
    끝줄: { type: 'integer', description: '구간 끝 줄 번호 (포함)' },
  },
  required: ['시작줄', '끝줄'],
  additionalProperties: false,
};

const SEGMENT_SCHEMA = {
  type: 'object',
  properties: {
    발언구간: {
      type: 'array',
      description: '회의 전체를 빈틈없이 덮는 발언 구간 목록. 1번 줄부터 마지막 줄까지 모두 포함되어야 한다.',
      items: {
        type: 'object',
        properties: {
          시작줄: { type: 'integer' },
          끝줄: { type: 'integer' },
          역할: {
            type: 'string',
            enum: ['위원장', '질의', '답변', '기타'],
            description: '위원장=의사진행 발언, 질의=위원의 질의, 답변=정부측 답변, 기타=개회사/정회 안내 등',
          },
          화자: { type: 'string', description: '예: "민홍철 위원", "국방부장관", "공군참모총장". 모르면 "미상"' },
          확신도: { type: 'string', enum: ['높음', '보통', '낮음'] },
        },
        required: ['시작줄', '끝줄', '역할', '화자', '확신도'],
        additionalProperties: false,
      },
    },
    질의답변쌍: {
      type: 'array',
      description: '질의와 그에 대응하는 답변의 짝. 한 질의에 답변이 여러 곳에 나뉘어 있으면 구간을 여러 개 넣는다.',
      items: {
        type: 'object',
        properties: {
          주제: { type: 'string', description: '이 질의응답의 핵심 주제 (10자 내외)' },
          질의자: { type: 'string' },
          답변자: { type: 'string', description: '답변한 사람의 직책. 없거나 모르면 "미상"' },
          질의구간: { type: 'array', items: RANGE_SCHEMA },
          답변구간: { type: 'array', items: RANGE_SCHEMA, description: '답변이 없으면 빈 배열' },
        },
        required: ['주제', '질의자', '답변자', '질의구간', '답변구간'],
        additionalProperties: false,
      },
    },
  },
  required: ['발언구간', '질의답변쌍'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `당신은 국회 상임위원회 회의록을 분석하는 보좌 인력입니다.
입력은 국회 인터넷의사중계시스템의 **AI 자동 자막**이라 다음 특성이 있습니다.

- 오탈자와 오인식이 있습니다. 문맥으로 판단하되, 원문에 없는 내용을 지어내지 마세요.
- 같은 문장의 앞부분만 담긴 줄이 뒤 줄과 중복될 수 있습니다. 중복은 무시하세요.
- 화자 이름이 발언마다 반복되지 않습니다. 위원장이 "○○○위원님 질의해 주시기
  바랍니다"라고 호명한 뒤부터 다음 화자 전환 전까지는 그 위원의 발언입니다.
- 답변자는 "국방부장관입니다", "공군참모총장입니다"처럼 자기소개로 등장하는
  경우가 많습니다. 그 직책을 답변자로 쓰세요.

가장 중요한 두 가지:

1. **모든 줄을 빠짐없이 덮으세요.** 발언구간의 범위를 전부 합치면 1번 줄부터
   마지막 줄까지 빈틈이 없어야 하고, 구간끼리 겹쳐서도 안 됩니다. 화자를
   모르는 구간은 버리지 말고 화자를 "미상", 확신도를 "낮음"으로 두세요.

2. **연속 질의 후 일괄 답변을 정확히 배분하세요.** 국회 상임위에서는 여러
   위원이 연달아 질의한 뒤 정부측이 한 번에 답변하는 진행이 흔합니다. 이때
   답변 구간을 주제별로 쪼개 각 질의자에게 배분하세요. 마지막 질의자에게
   답변 전체를 몰아주면 안 됩니다. 답변에서 다뤄지지 않은 질의는 답변구간을
   빈 배열로 두세요.`;

/**
 * 규칙 기반 화자 감지 결과를 힌트로 만든다.
 * 판정 권한은 Claude에 있지만, 정규식이 확실히 잡아낸 호명은 정확도를 올린다.
 * 틀릴 수 있다는 점을 프롬프트에 명시해 Claude가 무비판적으로 따르지 않게 한다.
 */
function buildSpeakerHints(lines) {
  const hints = [];
  for (const line of lines) {
    const signal = detectSignal(line.text);
    if (signal.speaker) hints.push(`${line.no}번 줄: ${signal.speaker} 호명/언급`);
  }
  return hints;
}

/**
 * Claude가 돌려준 발언구간이 원문을 빠짐없이 덮는지 산술로 검산한다.
 * 이 함수가 이 파이프라인의 안전장치다 — LLM 출력을 신뢰하지 않고 대조한다.
 *
 * @returns {{ok, totalLines, coveredLines, ratio, gaps, overlaps, invalid}}
 */
function verifyCoverage(발언구간, totalLines) {
  const invalid = [];
  const valid = [];
  for (const seg of 발언구간 || []) {
    const { 시작줄: s, 끝줄: e } = seg;
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 1 || e > totalLines || s > e) {
      invalid.push(seg);
      continue;
    }
    valid.push(seg);
  }

  const sorted = [...valid].sort((a, b) => a.시작줄 - b.시작줄 || a.끝줄 - b.끝줄);

  const gaps = [];
  const overlaps = [];
  let cursor = 1; // 아직 덮이지 않은 첫 줄

  for (const seg of sorted) {
    if (seg.시작줄 > cursor) {
      gaps.push({ 시작줄: cursor, 끝줄: seg.시작줄 - 1, 줄수: seg.시작줄 - cursor });
    } else if (seg.시작줄 < cursor) {
      overlaps.push({ 시작줄: seg.시작줄, 끝줄: Math.min(seg.끝줄, cursor - 1) });
    }
    cursor = Math.max(cursor, seg.끝줄 + 1);
  }
  if (cursor <= totalLines) {
    gaps.push({ 시작줄: cursor, 끝줄: totalLines, 줄수: totalLines - cursor + 1 });
  }

  const gapLines = gaps.reduce((sum, g) => sum + g.줄수, 0);
  const coveredLines = totalLines - gapLines;

  return {
    ok: gaps.length === 0 && overlaps.length === 0 && invalid.length === 0,
    totalLines,
    coveredLines,
    ratio: totalLines > 0 ? coveredLines / totalLines : 1,
    gaps,
    overlaps,
    invalid,
  };
}

/**
 * 커버리지 검산에서 빠진 구간을 "미분류" 쌍으로 만들어 돌려준다.
 * 버리지 않고 보고서에 남기기 위한 것 — 사람이 원문을 확인할 수 있어야 한다.
 */
function gapsToUnclassifiedPairs(gaps) {
  return (gaps || []).map((g) => ({
    주제: '미분류 구간',
    질의자: '미상',
    답변자: '미상',
    질의구간: [{ 시작줄: g.시작줄, 끝줄: g.끝줄 }],
    답변구간: [],
    미분류: true,
  }));
}

/**
 * 패스 1 실행.
 * @param {Anthropic} client
 * @param {Array} lines - transcript.js의 parseTranscript() 결과
 * @returns {Promise<{발언구간, 질의답변쌍, coverage, usage, model}>}
 */
async function segmentTranscript(client, lines, { model = DEFAULT_SEGMENT_MODEL, effort = 'high' } = {}) {
  if (lines.length === 0) throw new Error('자막 줄이 비어 있습니다');

  const hints = buildSpeakerHints(lines);
  const hintText = hints.length
    ? `\n\n[참고] 규칙 기반 사전 탐지 결과입니다. 틀릴 수 있으니 참고만 하고, 최종 판단은 전문을 읽고 직접 하세요.\n${hints.join('\n')}`
    : '';

  const prompt =
    `아래는 국회 상임위 회의의 AI 자막 전문입니다. 총 ${lines.length}줄이며 ` +
    `각 줄은 "줄번호| [영상시점] 텍스트" 형식입니다.\n\n` +
    `이 회의의 발언 구간을 나누고, 질의와 답변을 대응시켜 주세요. ` +
    `1번 줄부터 ${lines.length}번 줄까지 빠짐없이 덮어야 합니다.${hintText}\n\n` +
    `--- 회의록 전문 ---\n${buildNumberedTranscript(lines)}`;

  // 긴 입력 + 구조화된 긴 출력이라 스트리밍으로 받는다 (HTTP 타임아웃 회피).
  const stream = client.messages.stream({
    model,
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    thinking: { type: 'adaptive' },
    output_config: {
      effort,
      format: { type: 'json_schema', schema: SEGMENT_SCHEMA },
    },
    messages: [{ role: 'user', content: prompt }],
  });

  const response = await stream.finalMessage();

  if (response.stop_reason === 'refusal') {
    throw new Error(`Claude가 요청을 거부함 (${response.stop_details?.category || '사유 미상'})`);
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('구간 판정 응답에 text 블록이 없음');

  const parsed = JSON.parse(textBlock.text);
  const coverage = verifyCoverage(parsed.발언구간, lines.length);

  return {
    발언구간: parsed.발언구간,
    질의답변쌍: [...parsed.질의답변쌍, ...gapsToUnclassifiedPairs(coverage.gaps)],
    coverage,
    usage: response.usage,
    model: response.model,
  };
}

module.exports = {
  segmentTranscript,
  verifyCoverage,
  gapsToUnclassifiedPairs,
  buildSpeakerHints,
  SEGMENT_SCHEMA,
  DEFAULT_SEGMENT_MODEL,
};
