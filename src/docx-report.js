/**
 * 보고 초안을 워드(.docx) 표 형식으로 출력한다 (P2-4).
 *
 * JSON은 기계가 읽기엔 좋지만 실무에서 그대로 결재에 올릴 수 없다.
 * 실제로 쓰이는 형태는 "질의 한 건 = 표 하나"라서 그 구조를 그대로 만든다.
 *
 * 문서 구성:
 *   ① 제목 + 개요 (상임위/일시/생성시각)
 *   ② 요약 표 — 한 장에서 전체를 훑을 수 있게 질의별 한 줄
 *   ③ 질의별 상세 표 — 의원명/질의요지/답변내용/시사점을 세로로
 *   ④ 검증 정보 — 커버리지와 제외 내역. 이 문서가 원문 전체를 대표하지
 *      않는다는 사실을 문서 자체에 남긴다(빠진 게 있으면 보이게 한다).
 *
 * 자동 생성물이라는 표시를 각 표에 남긴다 — 사람이 검토 없이 그대로
 * 올리는 것을 막기 위해서다. 근거 줄 번호와 영상 시점도 함께 넣어
 * 원문 대조가 가능하게 한다.
 */

const path = require('path');
const fs = require('fs');
const {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  AlignmentType,
  WidthType,
  BorderStyle,
  ShadingType,
} = require('docx');
const { embedFonts } = require('./docx-font-embed');

// ── 제어판 UI와 같은 팔레트 (애플 계열) ────────────────────────────────
// 폰트는 Pretendard를 문서에 실제로 심는다(embedFonts, 아래) — 이름만
// 적으면 받는 사람 PC에 그 폰트가 없을 때 Word가 임의로 대체해서, 결재
// 문서인데 사람마다 다르게 보인다. TrueType 임베딩으로 그 문제를 없앤다.
const FONT = 'Pretendard';
const TEXT = '1D1D1F';       // 애플 --text — 본문 기본색(중간 회색이 아니라 거의 검정)
const TEXT_2 = '6E6E73';     // --text-2 — 보조 텍스트
const TEXT_3 = '86868B';     // --text-3 — 근거·타임스탬프 같은 3차 텍스트
const HAIRLINE = 'D2D2D7';   // --sep
const FILL = 'F5F5F7';       // --fill — 라벨 칸, 표 zebra
const ON_ACCENT = 'FFFFFF';
const BLUE = '0071E3';       // --blue — 애플의 액션 색. 표 머리를 여기로 통일한다.
const RED = 'D70015';        // --red
const ORANGE = 'B25000';     // --orange
const ORANGE_SOFT = 'FFF4E5';

// 호환용 별칭 — 아래 함수들이 기존 이름을 그대로 참조한다.
const BODY = TEXT;
const INK = TEXT;
const MUTED = TEXT_2;
const MUTED_SOFT = TEXT_3;
const ERROR = RED;
const WARNING_INK = ORANGE;
const WARNING_FILL = ORANGE_SOFT;
const SURFACE_SOFT = FILL;
const ON_PRIMARY = ON_ACCENT;

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: HAIRLINE };
const TABLE_BORDERS = {
  top: BORDER, bottom: BORDER, left: BORDER, right: BORDER,
  insideHorizontal: BORDER, insideVertical: BORDER,
};

// 표 머리는 파란 면 + 흰 글자 — 제어판의 주 버튼·강조와 같은 색이다.
// (Cal.com 시절엔 검정이었다. 애플은 액션 색이 파랑이라 여기도 맞췄다.)
const HEADER_FILL = BLUE;
const LABEL_FILL = FILL;

function text(str, { bold = false, size = 20, color = BODY, italics = false } = {}) {
  return new TextRun({ text: String(str ?? ''), bold, size, color, italics, font: FONT });
}

function para(str, opts = {}) {
  const { align, spacing, ...runOpts } = opts;
  return new Paragraph({
    alignment: align,
    spacing: spacing || { before: 40, after: 40 },
    children: [text(str, runOpts)],
  });
}

/** 줄바꿈이 들어간 본문을 문단 여러 개로 (docx는 \n을 렌더링하지 않는다) */
function multilinePara(str, opts = {}) {
  const lines = String(str ?? '').split('\n');
  return lines.map((l) => para(l, opts));
}

function cell(children, { fill, width, span } = {}) {
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    shading: fill ? { type: ShadingType.CLEAR, color: 'auto', fill } : undefined,
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    columnSpan: span,
    // 스펙의 카드 내부 여백(24px)에 맞춘 셀 패딩. twip 단위(1/20pt)라
    // 140 ≈ 7pt ≈ 9px. 표가 빽빽해 보이지 않게 기존보다 넉넉히 준다.
    margins: { top: 140, bottom: 140, left: 180, right: 180 },
  });
}

function fullWidthTable(rows) {
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
  });
}

function rangesToText(ranges) {
  const s = (ranges || []).map((r) => `${r.시작줄}-${r.끝줄}`).join(', ');
  return s || '없음';
}

/** ② 요약 표 — 전체를 한눈에 */
function buildSummaryTable(items) {
  const th = (label, width) =>
    cell(para(label, { bold: true, color: ON_PRIMARY, align: AlignmentType.CENTER }), {
      fill: HEADER_FILL,
      width,
    });

  const head = new TableRow({
    tableHeader: true,
    children: [
      th('연번', 7), th('의원명', 15), th('주제', 20),
      th('답변자', 18), th('키워드', 25), th('영상시점', 15),
    ],
  });

  // 짝수 행에 아주 옅은 면을 깔아 행 추적을 돕는다 (zebra).
  const rows = items.map((r, i) => {
    const fill = i % 2 === 1 ? SURFACE_SOFT : undefined;
    return new TableRow({
      children: [
        cell(para(i + 1, { align: AlignmentType.CENTER, color: MUTED }), { fill }),
        cell(para(r.의원명 || '미상', { color: INK, bold: true }), { fill }),
        cell(para(r.주제 || '-', { color: INK }), { fill }),
        cell(para(r.답변자 || '미상'), { fill }),
        cell(para((r.매칭키워드 || []).map((k) => k.그룹).join(', ') || '-', { color: MUTED }), { fill }),
        cell(para(r.영상시점 || '--:--:--', { align: AlignmentType.CENTER, color: MUTED }), { fill }),
      ],
    });
  });

  return fullWidthTable([head, ...rows]);
}

/** ③ 질의 한 건의 상세 표 */
function buildDetailTable(r, index) {
  const row = (label, body, opts = {}) =>
    new TableRow({
      children: [
        cell(para(label, { bold: true, color: INK }), { fill: LABEL_FILL, width: 16 }),
        cell(Array.isArray(body) ? body : [body], { width: 84 }),
      ],
      ...opts,
    });

  const header = new TableRow({
    tableHeader: true,
    children: [
      cell(
        para(`${index + 1}. ${r.주제 || '(주제 미상)'}`, {
          bold: true,
          size: 24,
          color: ON_PRIMARY,
        }),
        { fill: HEADER_FILL, span: 2 },
      ),
    ],
  });

  const rows = [
    header,
    // 상임위는 문서 제목에 이미 들어가고 한 문서 = 한 상임위이므로 행마다
    // 반복하지 않는다. 일시는 남긴다 — 표 하나만 떼어 다른 문서에 붙이는
    // 경우가 있어 그때 날짜가 없으면 곤란하다.
    row('일시', para(r.일시 || '-', { color: MUTED })),
    row('의원명', para(r.의원명 || '미상', { bold: true, color: INK })),
    row('답변자', para(r.답변자 || '미상', { color: INK })),
    row('질의요지', multilinePara(r.질의요지 || '-')),
    row('답변내용', multilinePara(r.답변내용 || '(답변 구간 없음)')),
    row('시사점', multilinePara(r.시사점 || '-')),
  ];

  if (r.담당부서) rows.push(row('담당부서', para(r.담당부서)));

  const kw = (r.매칭키워드 || []).map((k) => `${k.그룹}(${k.패턴})`).join(', ');
  if (kw) rows.push(row('매칭 키워드', para(kw)));

  // 근거를 문서에 남긴다 — 요약이 원문과 다를 때 바로 찾아갈 수 있어야 한다.
  rows.push(
    row(
      '근거',
      para(
        `영상 ${r.영상시점 || '--:--:--'} · 자막 줄 [질의 ${rangesToText(r.근거줄?.질의)} / 답변 ${rangesToText(r.근거줄?.답변)}]`,
        { size: 18, color: MUTED_SOFT },
      ),
    ),
  );

  // 사람이 반드시 확인해야 하는 항목은 표 안에 경고를 남긴다.
  const warn = (msg) =>
    new TableRow({
      children: [
        cell(para('확인 필요', { bold: true, color: WARNING_INK }), { fill: WARNING_FILL, width: 16 }),
        cell(para(msg, { color: WARNING_INK }), { fill: WARNING_FILL, width: 84 }),
      ],
    });
  if (r.source === 'template') {
    rows.push(warn('LLM 요약에 실패해 원문 발췌만 들어갔습니다. 직접 확인이 필요합니다.'));
  }
  if (r.미분류) {
    rows.push(warn('자동 분류에 실패한 구간입니다. 원문 확인이 필요합니다.'));
  }

  return fullWidthTable(rows);
}

/** ④ 검증 정보 — 이 문서가 원문 전체를 대표하지 않을 수 있음을 명시 */
function buildVerificationSection(result) {
  const v = result.검증 || {};
  const f = result.키워드필터 || {};
  const out = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 140 },
      children: [text('생성 검증 정보', { bold: true, size: 24, color: INK })],
    }),
    para(`자막 원문 ${result.메타?.자막줄수 ?? '?'}줄 중 ${v.커버리지 || '?'}줄이 발언 구간으로 분류되었습니다 (${v.커버리지비율 ?? '?'}%).`),
  ];

  const gaps = v.미분류구간 || [];
  if (gaps.length) {
    out.push(para(`⚠ 미분류 구간 ${gaps.length}곳 — 아래 줄 범위는 자동 분류에 실패했습니다. 원문 확인이 필요합니다.`, { color: WARNING_INK, bold: true }));
    out.push(para(gaps.map((g) => `${g.시작줄}~${g.끝줄}번 줄(${g.줄수}줄)`).join(', '), { size: 18, color: MUTED }));
  }

  if (f.적용) {
    out.push(para(`키워드 필터 적용 — 등록된 ${f.그룹수}개 그룹과 관련된 ${f.대상}건만 수록했습니다. 미매칭 ${f.제외}건은 제외되었습니다.`));
    if ((f.제외목록 || []).length) {
      out.push(para('제외된 질의: ' + f.제외목록.map((e) => e.주제 || '(주제 미상)').join(', '), { size: 18, color: MUTED_SOFT }));
    }
  } else {
    out.push(para('키워드가 등록되지 않아 필터 없이 전체를 수록했습니다.'));
  }

  out.push(
    para(
      `구간 판정 모델: ${result.메타?.구간판정모델 || '-'} · 생성 시각: ${result.메타?.생성시각 || '-'}`,
      { size: 18, color: MUTED_SOFT },
    ),
  );
  return out;
}

/**
 * 보고서 결과(runReportPipeline 반환값)를 .docx 버퍼로 만든다.
 * @returns {Promise<Buffer>}
 */
async function buildDocx(result) {
  const items = result.보고서 || [];
  const meta = result.메타 || {};

  const children = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [text(`${meta.상임위 || '상임위'} 질의답변 보고`, { bold: true, size: 36, color: INK })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [
        text(
          [meta.일시, meta.담당부서].filter(Boolean).join('  ·  ') || '',
          { size: 20, color: MUTED },
        ),
      ],
    }),
    para('※ 이 문서는 AI 자막을 자동 요약한 초안입니다. 결재 전 원문 대조가 필요합니다.', {
      size: 18, color: ERROR,
    }),
  ];

  if (items.length === 0) {
    children.push(
      new Paragraph({
        spacing: { before: 300, after: 300 },
        children: [text(
          (result.키워드필터?.적용)
            ? '등록한 키워드와 관련된 질의가 없습니다.'
            : '생성된 질의답변이 없습니다.',
          { size: 22 },
        )],
      }),
    );
  } else {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 140 },
        children: [text(`요약 (${items.length}건)`, { bold: true, size: 24, color: INK })],
      }),
      buildSummaryTable(items),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 480, after: 140 },
        children: [text('질의별 상세', { bold: true, size: 24, color: INK })],
      }),
    );

    items.forEach((r, i) => {
      children.push(buildDetailTable(r, i));
      children.push(new Paragraph({ spacing: { after: 320 }, children: [text('')] }));
    });
  }

  children.push(...buildVerificationSection(result));

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 20, color: BODY } } } },
    sections: [{ properties: {}, children }],
  });

  const rawBuffer = await Packer.toBuffer(doc);
  return embedPretendard(rawBuffer);
}

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');

/**
 * Pretendard TrueType을 문서에 실제로 심는다. 폰트 파일을 못 읽으면
 * (배포 환경에 assets/fonts가 빠졌거나 하는 경우) 임베딩 없이 원본을
 * 그대로 돌려준다 — 이름만 "Pretendard"로 찍힌 문서가 나가는 것이지,
 * 보고서 생성 자체가 막히면 안 된다.
 */
async function embedPretendard(docxBuffer) {
  try {
    const regular = fs.readFileSync(path.join(FONT_DIR, 'Pretendard-Regular.ttf'));
    const bold = fs.readFileSync(path.join(FONT_DIR, 'Pretendard-Bold.ttf'));
    return await embedFonts(docxBuffer, FONT, { regular, bold });
  } catch (err) {
    console.error('[docx-report] Pretendard 임베딩 실패 — 폰트 이름만 적힌 문서로 대체:', err.message);
    return docxBuffer;
  }
}

/** 저장할 .docx 파일명 (확장자 포함) */
function docxFilename(result) {
  const meta = result.메타 || {};
  const safe = String(meta.상임위 || 'report').replace(/[\\/:*?"<>|]/g, '_');
  const date = String(meta.일시 || '').replace(/[^\d]/g, '').slice(0, 8) || 'nodate';
  return `보고서_${safe}_${date}.docx`;
}

module.exports = { buildDocx, docxFilename };
