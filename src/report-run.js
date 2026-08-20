/**
 * 보고서 생성 파이프라인 전체 실행 (P2-3).
 *
 * CLI(tools/report.js)와 GUI 제어판(src/app-server.js)이 이 모듈을 공유한다 —
 * 두 진입점이 같은 로직을 각각 구현하면 한쪽만 고치는 불일치가 생긴다
 * (tools/probe.js가 capture.js와 셀렉터를 따로 들고 있다가 라이브에서
 * 어긋났던 전례가 있다).
 *
 * 흐름:
 *   ① 자막 로드 (src/transcript.js)
 *   ② 패스 1 — 구간 판정 + 커버리지 검산 (src/segment.js)
 *   ③ 키워드 필터 — 등록된 키워드와 무관한 질의는 제외
 *   ④ 패스 2 — 남은 것만 요약 (src/report.js)
 *
 * ③을 ②와 ④ 사이에 두는 이유:
 *   구간 판정은 전문을 봐야 정확하므로 필터보다 먼저 와야 하고, 요약은
 *   호출당 비용이 드니 필터보다 뒤에 와야 한다. 관련 없는 질의 10건을
 *   요약하지 않으면 그만큼 API 호출이 줄어든다.
 */

const fs = require('fs');
const path = require('path');

const { loadTranscript, sliceRanges } = require('./transcript');
const { segmentTranscript } = require('./segment');
const { generateReport, createClient } = require('./report');
const { loadKeywords, KeywordMatcher } = require('./keywords');

/** baseDir에서 보고서 입력으로 쓸 수 있는 자막 파일 목록 (최신순) */
function listCaptionFiles(baseDir) {
  const entries = [];
  for (const name of fs.readdirSync(baseDir)) {
    if (!/^captions_(final|raw)_.*\.txt$/.test(name)) continue;
    const full = path.join(baseDir, name);
    const stat = fs.statSync(full);
    if (!stat.isFile() || stat.size === 0) continue;
    entries.push({
      name,
      kind: name.startsWith('captions_final_') ? '정리본' : 'raw',
      bytes: stat.size,
      mtime: stat.mtimeMs,
    });
  }
  // 정리본을 우선 노출한다 — raw는 중복이 있어 보고서 입력으로는 차선이다.
  return entries.sort((a, b) => b.mtime - a.mtime || a.kind.localeCompare(b.kind));
}

/** 파일명의 타임스탬프(..._20260820-1146.txt)에서 회의 일시를 복원한다. */
function dateFromFilename(file) {
  const m = path.basename(file).match(/_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : '';
}

/** 파일명에서 세션(상임위)명을 복원한다. captions_final_국방위_20260820-1146.txt -> 국방위 */
function sessionFromFilename(file) {
  const m = path.basename(file).match(/^captions_(?:final|raw)_(.+?)_\d{8}-\d{4}\.txt$/);
  return m ? m[1] : path.basename(file).replace(/\.txt$/, '');
}

/**
 * 질의-답변 쌍에 등록 키워드가 걸리는지 본다.
 *
 * 쿨다운이 있는 match()가 아니라 findMatches()를 쓴다 — 쿨다운은 실시간
 * 알림 폭주를 막기 위한 것이라, 회의 끝난 뒤 일괄 분류에 적용하면 같은
 * 그룹의 두 번째 질의부터 조용히 누락된다.
 */
function matchPair(matcher, lines, pair) {
  const text =
    sliceRanges(lines, pair.질의구간) + ' ' + sliceRanges(lines, pair.답변구간);
  return matcher.findMatches(text);
}

/**
 * @param {object} opts
 * @param {string} opts.inputFile     자막 파일 경로
 * @param {string} [opts.session]     상임위명 (없으면 파일명에서 복원)
 * @param {string} [opts.dept]        담당부서 (없으면 매칭된 키워드 그룹의 dept 사용)
 * @param {string} [opts.keywordsPath] keywords.json 경로. 없거나 비면 필터 안 함
 * @param {string} [opts.outDir]      결과 저장 디렉터리
 * @param {(p: object) => void} [opts.onProgress] 진행 상황 콜백
 */
async function runReportPipeline({
  inputFile,
  session,
  dept = null,
  keywordsPath,
  outDir,
  onProgress = () => {},
}) {
  if (!fs.existsSync(inputFile)) throw new Error(`파일을 찾을 수 없음: ${inputFile}`);

  const client = createClient();
  if (!client) {
    throw new Error('ANTHROPIC_API_KEY가 없습니다. .env에 키를 설정한 뒤 다시 실행하세요.');
  }

  const sessionName = session || sessionFromFilename(inputFile);
  const date = dateFromFilename(inputFile);

  const lines = loadTranscript(inputFile);
  if (lines.length === 0) throw new Error('자막 줄이 없습니다.');
  onProgress({ phase: 'loaded', 줄수: lines.length });

  // ── 패스 1 ──────────────────────────────────────────────────────────
  onProgress({ phase: 'segment-start', 줄수: lines.length });
  const seg = await segmentTranscript(client, lines);
  const cov = seg.coverage;
  onProgress({
    phase: 'segment-done',
    구간수: seg.발언구간.length,
    쌍수: seg.질의답변쌍.length,
    커버리지: `${cov.coveredLines}/${cov.totalLines}`,
    미분류: cov.gaps.length,
    모델: seg.model,
  });

  // ── 키워드 필터 ──────────────────────────────────────────────────────
  const groups = keywordsPath ? loadKeywords(keywordsPath) : [];
  const matcher = new KeywordMatcher(groups);
  const 대상 = [];
  const 제외 = [];

  for (const pair of seg.질의답변쌍) {
    // 키워드가 등록되어 있지 않으면 필터를 걸지 않는다 (설정 안 함 = 전부 보기).
    if (!matcher.enabled) {
      대상.push({ pair, hits: [] });
      continue;
    }
    const hits = matchPair(matcher, lines, pair);
    if (hits.length > 0) 대상.push({ pair, hits });
    else 제외.push({ 주제: pair.주제, 질의자: pair.질의자, 미분류: Boolean(pair.미분류) });
  }

  onProgress({
    phase: 'filter-done',
    필터적용: matcher.enabled,
    대상: 대상.length,
    제외: 제외.length,
    그룹수: groups.length,
  });

  // ── 패스 2 ──────────────────────────────────────────────────────────
  const reports = [];
  for (const [i, { pair, hits }] of 대상.entries()) {
    onProgress({ phase: 'summarize', 현재: i + 1, 전체: 대상.length, 주제: pair.주제 || '' });
    // 담당부서를 지정하지 않았으면 매칭된 키워드 그룹의 dept를 쓴다 —
    // keywords.json이 이미 "이 키워드는 어느 부서 소관인가"를 담고 있다.
    const 부서 = dept || hits.find((h) => h.dept)?.dept || null;
    const report = await generateReport(pair, lines, {
      session: sessionName,
      dept: 부서,
      date,
      client,
    });
    reports.push({
      ...report,
      매칭키워드: hits.map((h) => ({ 그룹: h.group, 패턴: h.pattern, 중요도: h.priority })),
    });
  }

  // 중요도 높은 것부터, 그 다음 영상 시점 순
  reports.sort((a, b) => {
    const pri = (r) => (r.매칭키워드?.some((k) => k.중요도 === 'high') ? 0 : 1);
    return pri(a) - pri(b) || String(a.영상시점).localeCompare(String(b.영상시점));
  });

  const result = {
    메타: {
      입력파일: path.basename(inputFile),
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
    키워드필터: {
      적용: matcher.enabled,
      그룹수: groups.length,
      대상: 대상.length,
      제외: 제외.length,
      제외목록: 제외,
    },
    발언구간: seg.발언구간,
    보고서: reports,
  };

  let outPath = null;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    const safe = String(sessionName).replace(/[\\/:*?"<>|]/g, '_');
    outPath = path.join(outDir, `report_${safe}_${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
    result.메타.저장경로 = outPath;
  }

  onProgress({ phase: 'done', 건수: reports.length, 저장경로: outPath });
  return result;
}

module.exports = {
  runReportPipeline,
  listCaptionFiles,
  dateFromFilename,
  sessionFromFilename,
};
