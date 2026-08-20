/**
 * 패스 2 — 질의-답변 쌍 하나를 보고 초안으로 요약한다 (P2-2 / P2-3).
 *
 * 입력은 src/segment.js(패스 1)가 판정한 쌍이다. 전체 자막을 통째로 넣지
 * 않는다 — 패스 1이 이미 전문을 읽고 구간을 확정했으므로, 여기서는 해당
 * 줄 범위만 보고 요약에 집중한다(긴 출력에서 생기는 누락 회피).
 *
 * 설계 원칙: **코드가 이미 아는 값은 LLM에게 다시 묻지 않는다.**
 *   의원명·답변자는 패스 1의 판정 결과이고, 일시는 캡처 시점이며, 영상
 *   시점과 근거 줄 번호는 원문에서 계산된다. 이걸 LLM 스키마에 넣으면
 *   확정된 사실을 다시 추론하게 만들어 모순과 환각의 여지만 생긴다.
 *   그래서 LLM은 요약문 3개(질의요지/답변내용/시사점)만 생성한다.
 *
 * ANTHROPIC_API_KEY가 없으면 템플릿 채우기로 폴백한다 — LLM 요약은 못
 * 하지만 보고서 골격은 생성된다.
 *
 * 실시간 캡처 루프에는 절대 연결하지 않는다. API 지연이 캡처에 영향을
 * 주면 안 되므로, 세션 종료 후 tools/report.js로 수동 실행한다.
 */

const { sliceRanges, earliestVideoTime, formatVideoTime } = require('./transcript');

let Anthropic = null;
try {
  // eslint-disable-next-line global-require
  Anthropic = require('@anthropic-ai/sdk');
} catch {
  Anthropic = null;
}

const DEFAULT_REPORT_MODEL = process.env.REPORT_MODEL || 'claude-sonnet-5';

// LLM이 생성하는 것은 요약문 3개뿐이다. 나머지 필드는 코드가 조립한다.
const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    질의요지: { type: 'string', description: '질의 내용을 2~3문장으로 요약' },
    답변내용: {
      type: 'string',
      description: '답변 내용을 2~3문장으로 요약. 답변 원문이 없으면 빈 문자열',
    },
    시사점: { type: 'string', description: '우리 기관 입장에서의 시사점/후속조치 1~2문장' },
  },
  required: ['질의요지', '답변내용', '시사점'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `국회 상임위 회의의 질의-답변을 보고 초안으로 요약합니다.
입력은 AI 자동 자막이라 오탈자와 중복이 있습니다. 문맥으로 읽되 원문에 없는
내용을 지어내지 마세요. 답변 원문이 비어 있으면 답변내용을 빈 문자열로 두고,
있지도 않은 답변을 추측해 쓰지 마세요.`;

function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function createClient() {
  if (!Anthropic || !hasApiKey()) return null;
  return new Anthropic();
}

/**
 * 쌍 하나를 보고서 한 건으로 만든다.
 *
 * @param {object} pair - segment.js가 만든 질의답변쌍 원소
 * @param {Array} lines - transcript.js parseTranscript() 결과 (전문)
 * @param {object} meta - { session, dept, date, client, model }
 */
async function generateReport(pair, lines, { session, dept, date, client, model } = {}) {
  const 질의원문 = sliceRanges(lines, pair.질의구간);
  const 답변원문 = sliceRanges(lines, pair.답변구간);
  const startTime = earliestVideoTime(lines, [...(pair.질의구간 || []), ...(pair.답변구간 || [])]);

  // 코드가 확정할 수 있는 값들 — LLM에 묻지 않는다.
  const base = {
    상임위: session || null,
    담당부서: dept || null,
    일시: date || '',
    주제: pair.주제 || '',
    의원명: pair.질의자 || '미상',
    답변자: pair.답변자 || '미상',
    영상시점: formatVideoTime(startTime),
    영상링크: null, // TODO: 라이브 딥링크 URL 파라미터 규격 확인 후 채울 것 (ROADMAP P0-1-a)
    근거줄: { 질의: pair.질의구간 || [], 답변: pair.답변구간 || [] },
  };

  // 미분류 구간은 요약하지 않는다. 분류에 실패한 구간에 LLM 요약을 붙이면
  // "정리된 것처럼" 보여서 사람이 원문 확인을 건너뛰게 된다 — 이 항목의
  // 존재 이유가 "여기는 사람이 봐야 한다"는 신호이므로 원문을 그대로 남긴다.
  if (pair.미분류) {
    return {
      ...base,
      미분류: true,
      질의요지: `(자동 분류 실패 — 원문 확인 필요) ${질의원문.slice(0, 300)}`,
      답변내용: '',
      시사점: '(미분류 구간 — 사람이 원문을 확인해야 합니다)',
      source: 'unclassified',
    };
  }

  if (!client) {
    return { ...base, ...templateFallback(질의원문, 답변원문), source: 'template' };
  }

  try {
    const generated = await summarize(client, { 질의원문, 답변원문, pair, model });
    return { ...base, ...generated, source: 'claude' };
  } catch (err) {
    // API 실패 시 조용히 폴백 — 보고서 생성 자체가 막히면 안 된다
    return {
      ...base,
      ...templateFallback(질의원문, 답변원문),
      source: 'template',
      fallbackReason: err.message,
    };
  }
}

async function summarize(client, { 질의원문, 답변원문, pair, model = DEFAULT_REPORT_MODEL }) {
  const prompt =
    `주제: ${pair.주제 || '(미상)'}\n` +
    `질의자: ${pair.질의자 || '미상'} / 답변자: ${pair.답변자 || '미상'}\n\n` +
    `[질의 원문]\n${질의원문 || '(없음)'}\n\n` +
    `[답변 원문]\n${답변원문 || '(답변 구간 없음)'}`;

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: REPORT_SCHEMA },
    },
    messages: [{ role: 'user', content: prompt }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(`Claude가 요청을 거부함 (${response.stop_details?.category || '사유 미상'})`);
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('요약 응답에 text 블록이 없음');

  return { ...JSON.parse(textBlock.text), usage: response.usage };
}

/** LLM 요약은 없지만 보고서 골격은 자동 생성된다. */
function templateFallback(질의원문, 답변원문) {
  return {
    질의요지: 질의원문.slice(0, 200) || '(질의 텍스트 없음)',
    답변내용: 답변원문.slice(0, 200) || '(답변 텍스트 없음)',
    시사점: '(LLM 미설정 — ANTHROPIC_API_KEY 설정 시 자동 요약됨)',
  };
}

module.exports = {
  generateReport,
  createClient,
  hasApiKey,
  REPORT_SCHEMA,
  DEFAULT_REPORT_MODEL,
};
