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

const FONT = '맑은 고딕';
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const TABLE_BORDERS = {
  top: BORDER, bottom: BORDER, left: BORDER, right: BORDER,
  insideHorizontal: BORDER, insideVertical: BORDER,
};
const HEADER_FILL = 'E8ECF4';
const LABEL_FILL = 'F4F6FA';

function text(str, { bold = false, size = 20, color, italics = false } = {}) {
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
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
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
  const head = new TableRow({
    tableHeader: true,
    children: [
      cell(para('연번', { bold: true, align: AlignmentType.CENTER }), { fill: HEADER_FILL, width: 7 }),
      cell(para('의원명', { bold: true, align: AlignmentType.CENTER }), { fill: HEADER_FILL, width: 15 }),
      cell(para('주제', { bold: true, align: AlignmentType.CENTER }), { fill: HEADER_FILL, width: 20 }),
      cell(para('답변자', { bold: true, align: AlignmentType.CENTER }), { fill: HEADER_FILL, width: 18 }),
      cell(para('키워드', { bold: true, align: AlignmentType.CENTER }), { fill: HEADER_FILL, width: 25 }),
      cell(para('영상시점', { bold: true, align: AlignmentType.CENTER }), { fill: HEADER_FILL, width: 15 }),
    ],
  });

  const rows = items.map((r, i) =>
    new TableRow({
      children: [
        cell(para(i + 1, { align: AlignmentType.CENTER })),
        cell(para(r.의원명 || '미상')),
        cell(para(r.주제 || '-')),
        cell(para(r.답변자 || '미상')),
        cell(para((r.매칭키워드 || []).map((k) => k.그룹).join(', ') || '-')),
        cell(para(r.영상시점 || '--:--:--', { align: AlignmentType.CENTER })),
      ],
    }),
  );

  return fullWidthTable([head, ...rows]);
}

/** ③ 질의 한 건의 상세 표 */
function buildDetailTable(r, index) {
  const row = (label, body, opts = {}) =>
    new TableRow({
      children: [
        cell(para(label, { bold: true }), { fill: LABEL_FILL, width: 15 }),
        cell(Array.isArray(body) ? body : [body], { width: 85 }),
      ],
      ...opts,
    });

  const header = new TableRow({
    tableHeader: true,
    children: [
      cell(
        para(`${index + 1}. ${r.주제 || '(주제 미상)'}`, { bold: true, size: 22 }),
        { fill: HEADER_FILL, span: 2 },
      ),
    ],
  });

  const rows = [
    header,
    row('일시', para(r.일시 || '-')),
    row('상임위', para(r.상임위 || '-')),
    row('의원명', para(r.의원명 || '미상', { bold: true })),
    row('답변자', para(r.답변자 || '미상')),
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
        { size: 18, color: '666666' },
      ),
    ),
  );

  // 사람이 반드시 확인해야 하는 항목은 표 안에 경고를 남긴다.
  if (r.source === 'template') {
    rows.push(row('⚠ 주의', para('LLM 요약에 실패해 원문 발췌만 들어갔습니다. 직접 확인이 필요합니다.', { color: 'C00000' })));
  }
  if (r.미분류) {
    rows.push(row('⚠ 주의', para('자동 분류에 실패한 구간입니다. 원문 확인이 필요합니다.', { color: 'C00000' })));
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
      spacing: { before: 300, after: 120 },
      children: [text('생성 검증 정보', { bold: true, size: 24 })],
    }),
    para(`자막 원문 ${result.메타?.자막줄수 ?? '?'}줄 중 ${v.커버리지 || '?'}줄이 발언 구간으로 분류되었습니다 (${v.커버리지비율 ?? '?'}%).`),
  ];

  const gaps = v.미분류구간 || [];
  if (gaps.length) {
    out.push(para(`⚠ 미분류 구간 ${gaps.length}곳 — 아래 줄 범위는 자동 분류에 실패했습니다. 원문 확인이 필요합니다.`, { color: 'C00000' }));
    out.push(para(gaps.map((g) => `${g.시작줄}~${g.끝줄}번 줄(${g.줄수}줄)`).join(', '), { size: 18 }));
  }

  if (f.적용) {
    out.push(para(`키워드 필터 적용 — 등록된 ${f.그룹수}개 그룹과 관련된 ${f.대상}건만 수록했습니다. 미매칭 ${f.제외}건은 제외되었습니다.`));
    if ((f.제외목록 || []).length) {
      out.push(para('제외된 질의: ' + f.제외목록.map((e) => e.주제 || '(주제 미상)').join(', '), { size: 18, color: '666666' }));
    }
  } else {
    out.push(para('키워드가 등록되지 않아 필터 없이 전체를 수록했습니다.'));
  }

  out.push(
    para(
      `구간 판정 모델: ${result.메타?.구간판정모델 || '-'} · 생성 시각: ${result.메타?.생성시각 || '-'}`,
      { size: 18, color: '666666' },
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
      children: [text(`${meta.상임위 || '상임위'} 질의답변 보고`, { bold: true, size: 32 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
      children: [
        text(
          [meta.일시, meta.담당부서].filter(Boolean).join(' · ') || '',
          { size: 20, color: '666666' },
        ),
      ],
    }),
    para('※ 이 문서는 AI 자막을 자동 요약한 초안입니다. 결재 전 원문 대조가 필요합니다.', {
      size: 18, color: 'C00000', italics: true,
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
        spacing: { before: 300, after: 120 },
        children: [text(`요약 (${items.length}건)`, { bold: true, size: 24 })],
      }),
      buildSummaryTable(items),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 120 },
        children: [text('질의별 상세', { bold: true, size: 24 })],
      }),
    );

    items.forEach((r, i) => {
      children.push(buildDetailTable(r, i));
      children.push(new Paragraph({ spacing: { after: 240 }, children: [text('')] }));
    });
  }

  children.push(...buildVerificationSection(result));

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{ properties: {}, children }],
  });

  return Packer.toBuffer(doc);
}

/** 저장할 .docx 파일명 (확장자 포함) */
function docxFilename(result) {
  const meta = result.메타 || {};
  const safe = String(meta.상임위 || 'report').replace(/[\\/:*?"<>|]/g, '_');
  const date = String(meta.일시 || '').replace(/[^\d]/g, '').slice(0, 8) || 'nodate';
  return `보고서_${safe}_${date}.docx`;
}

module.exports = { buildDocx, docxFilename };
