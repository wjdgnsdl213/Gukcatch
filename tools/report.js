#!/usr/bin/env node
/**
 * 세션 종료 후 수동 실행하는 보고 초안 생성 CLI (P2-2 / P2-3).
 * 실시간 캡처 루프와 완전히 분리되어 있다 — API 지연이 캡처에 영향을 주지 않는다.
 *
 * 사용법:
 *   node tools/report.js <raw또는정리본파일> [세션명] [담당부서]
 *   npm run report -- captions_final_국방위_20260820-1146.txt "국방위원회"
 *
 * 실제 파이프라인은 src/report-run.js에 있다 (GUI 제어판과 공유).
 * 등록된 키워드(keywords.json)와 무관한 질의는 제외된다. 키워드가 하나도
 * 없으면 필터를 걸지 않고 전부 생성한다.
 *
 * 모델은 환경변수로 바꿀 수 있다 (기본값 둘 다 claude-sonnet-5):
 *   SEGMENT_MODEL — 패스 1. 구간 판정이 보고서 품질 전체를 좌우하므로
 *                   정확도가 중요하면 claude-opus-5 권장.
 *   REPORT_MODEL  — 패스 2 요약.
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { runReportPipeline } = require('../src/report-run');

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('사용법: node tools/report.js <raw또는정리본파일> [세션명] [담당부서]');
  process.exit(1);
}
if (!fs.existsSync(inputFile)) {
  console.error(`파일을 찾을 수 없음: ${inputFile}`);
  process.exit(1);
}

const baseDir = path.join(__dirname, '..');

/** 진행 상황을 콘솔에 사람이 읽기 좋게 출력한다. */
function printProgress(p) {
  switch (p.phase) {
    case 'loaded':
      console.log(`자막 ${p.줄수}줄 로드됨`);
      break;
    case 'segment-start':
      console.log('\n[패스 1] 발언 구간 판정 중... (전문을 한 번에 분석하므로 시간이 걸립니다)');
      break;
    case 'segment-done':
      console.log(`  모델: ${p.모델}`);
      console.log(`  발언 구간 ${p.구간수}개, 질의-답변 ${p.쌍수}건`);
      console.log(`  커버리지: ${p.커버리지}줄`);
      if (p.미분류) console.log(`  ⚠ 미분류 구간 ${p.미분류}곳 — 보고서에 그대로 남깁니다`);
      break;
    case 'filter-done':
      if (!p.필터적용) {
        console.log('\n[키워드 필터] 등록된 키워드가 없어 전체를 생성합니다.');
      } else {
        console.log(`\n[키워드 필터] 그룹 ${p.그룹수}개 — 대상 ${p.대상}건, 제외 ${p.제외}건`);
      }
      break;
    case 'summarize':
      process.stdout.write(`  [${p.현재}/${p.전체}] ${p.주제}                    \r`);
      break;
    case 'docx-error':
      console.log(`  ⚠ 워드 파일 생성 실패: ${p.message} (JSON은 정상 저장됨)`);
      break;
    case 'done':
      console.log(`  ${p.건수}/${p.건수} 완료                              `);
      break;
    default:
      break;
  }
}

(async () => {
  console.log(`입력: ${inputFile}`);

  const result = await runReportPipeline({
    inputFile,
    session: process.argv[3],
    dept: process.argv[4] || null,
    keywordsPath: path.join(baseDir, 'keywords.json'),
    outDir: path.join(baseDir, 'reports'),
    onProgress: printProgress,
  });

  console.log('\n저장(JSON):', result.메타.저장경로);
  if (result.메타.워드파일) {
    console.log('저장(워드):', path.join(path.dirname(result.메타.저장경로), result.메타.워드파일));
  }

  const bySource = result.보고서.reduce((acc, r) => {
    acc[r.source] = (acc[r.source] || 0) + 1;
    return acc;
  }, {});
  console.log('생성 방식:', JSON.stringify(bySource));
  if (bySource.template) {
    console.log('  ⚠ template = LLM 요약 실패로 원문 발췌만 들어간 항목입니다.');
  }

  const f = result.키워드필터;
  if (f.적용 && f.제외 > 0) {
    console.log(`\n키워드 미매칭으로 제외된 ${f.제외}건:`);
    for (const e of f.제외목록) {
      console.log(`  - ${e.주제}${e.질의자 ? ` (${e.질의자})` : ''}${e.미분류 ? ' [미분류]' : ''}`);
    }
  }
})().catch((err) => {
  console.error('\n보고서 생성 실패:', err.message);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
