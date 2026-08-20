#!/usr/bin/env node
/**
 * 세션 종료 후 수동 실행하는 보고 초안 생성 CLI (P2-2 / P2-3).
 * 실시간 캡처 루프와 완전히 분리되어 있다 — API 지연이 캡처에 영향을 주지 않는다.
 *
 * 사용법:
 *   node tools/report.js <raw또는정리본파일> [세션명] [담당부서]
 *
 * 2패스로 동작한다:
 *   패스 1 (src/segment.js) — 전문을 한 번에 읽고 발언 구간과 질의-답변
 *     대응을 판정. 결과를 코드가 커버리지 검산해 빠진 구간을 "미분류"로 남긴다.
 *   패스 2 (src/report.js)  — 쌍마다 해당 줄 범위만 보고 요약.
 *
 * 모델은 환경변수로 바꿀 수 있다 (기본값 둘 다 claude-sonnet-5):
 *   SEGMENT_MODEL — 패스 1. 구간 판정이 보고서 품질 전체를 좌우하므로
 *                   정확도가 중요하면 claude-opus-5 권장.
 *   REPORT_MODEL  — 패스 2 요약.
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { loadTranscript } = require('../src/transcript');
const { segmentTranscript } = require('../src/segment');
const { generateReport, createClient } = require('../src/report');

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('사용법: node tools/report.js <raw또는정리본파일> [세션명] [담당부서]');
  process.exit(1);
}
if (!fs.existsSync(inputFile)) {
  console.error(`파일을 찾을 수 없음: ${inputFile}`);
  process.exit(1);
}

const sessionName = process.argv[3] || path.basename(inputFile).replace(/\.txt$/, '');
const dept = process.argv[4] || null;

/** 파일명의 타임스탬프(..._20260820-1146.txt)에서 회의 일시를 복원한다. */
function dateFromFilename(file) {
  const m = path.basename(file).match(/_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if (!m) return '';
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

(async () => {
  console.log(`입력: ${inputFile}`);

  const lines = loadTranscript(inputFile);
  console.log(`자막 ${lines.length}줄 로드됨`);
  if (lines.length === 0) {
    console.error('자막 줄이 없습니다.');
    process.exit(1);
  }

  const client = createClient();
  if (!client) {
    console.error(
      'ANTHROPIC_API_KEY가 없어 구간 판정을 할 수 없습니다.\n' +
        '.env에 키를 설정한 뒤 다시 실행하세요.',
    );
    process.exit(1);
  }

  // ── 패스 1: 구간 판정 ────────────────────────────────────────────────
  console.log('\n[패스 1] 발언 구간 판정 중... (전문을 한 번에 분석하므로 시간이 걸립니다)');
  const seg = await segmentTranscript(client, lines);

  const cov = seg.coverage;
  console.log(`  모델: ${seg.model}`);
  console.log(`  발언 구간 ${seg.발언구간.length}개, 질의-답변 ${seg.질의답변쌍.length}건`);
  console.log(
    `  커버리지: ${cov.coveredLines}/${cov.totalLines}줄 (${(cov.ratio * 100).toFixed(1)}%)`,
  );
  if (cov.gaps.length) {
    console.log(`  ⚠ 미분류 구간 ${cov.gaps.length}곳 — 보고서에 그대로 남깁니다:`);
    for (const g of cov.gaps) console.log(`      ${g.시작줄}~${g.끝줄}번 줄 (${g.줄수}줄)`);
  }
  if (cov.overlaps.length) console.log(`  ⚠ 겹치는 구간 ${cov.overlaps.length}곳`);
  if (cov.invalid.length) console.log(`  ⚠ 범위가 잘못된 구간 ${cov.invalid.length}개 (무시됨)`);

  // ── 패스 2: 쌍별 요약 ────────────────────────────────────────────────
  console.log(`\n[패스 2] 보고 초안 생성 중...`);
  const date = dateFromFilename(inputFile);
  const reports = [];
  for (const [i, pair] of seg.질의답변쌍.entries()) {
    process.stdout.write(`  [${i + 1}/${seg.질의답변쌍.length}] ${pair.주제 || ''}          \r`);
    reports.push(
      await generateReport(pair, lines, { session: sessionName, dept, date, client }),
    );
  }
  console.log(`  ${seg.질의답변쌍.length}/${seg.질의답변쌍.length} 완료                    `);

  // ── 저장 ────────────────────────────────────────────────────────────
  const outDir = path.join(__dirname, '..', 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const safeName = sessionName.replace(/[\\/:*?"<>|]/g, '_');
  const outPath = path.join(outDir, `report_${safeName}_${Date.now()}.json`);

  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        메타: {
          입력파일: inputFile,
          상임위: sessionName,
          담당부서: dept,
          일시: date,
          자막줄수: lines.length,
          생성시각: new Date().toISOString(),
          구간판정모델: seg.model,
        },
        검증: {
          커버리지: `${cov.coveredLines}/${cov.totalLines}`,
          커버리지비율: Number((cov.ratio * 100).toFixed(1)),
          미분류구간: cov.gaps,
          겹침: cov.overlaps,
          잘못된범위: cov.invalid.length,
        },
        발언구간: seg.발언구간,
        보고서: reports,
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log('\n저장:', outPath);

  const bySource = reports.reduce((acc, r) => {
    acc[r.source] = (acc[r.source] || 0) + 1;
    return acc;
  }, {});
  console.log('생성 방식:', JSON.stringify(bySource));
  if (bySource.template) {
    console.log('  ⚠ template = LLM 요약 실패로 원문 발췌만 들어간 항목입니다.');
  }
})().catch((err) => {
  console.error('\n보고서 생성 실패:', err.message);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
