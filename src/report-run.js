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
const { buildDocx, docxFilename } = require('./docx-report');
const { RAW_SUBDIR } = require('./store');

/**
 * 보고서 입력으로 쓸 수 있는 자막 파일 목록 (최신순).
 * 정리본은 baseDir 바로 아래, raw는 baseDir/raw/ 아래에 있다.
 *
 * relPath를 함께 돌려준다 — 호출자(app-server)가 파일명만으로 경로를
 * 조립하면 하위 폴더에 있는 raw를 못 찾는다. 목록에 있는 relPath와
 * 정확히 일치하는 값만 받도록 해서 경로 조작도 함께 막는다.
 */
function listCaptionFiles(baseDir) {
  const entries = [];

  const scan = (dir, relPrefix) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (!/^captions_(final|raw)_.*\.txt$/.test(name)) continue;
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (!stat.isFile() || stat.size === 0) continue;
      entries.push({
        name,
        relPath: relPrefix ? `${relPrefix}/${name}` : name,
        kind: name.startsWith('captions_final_') ? '정리본' : 'raw',
        bytes: stat.size,
        mtime: stat.mtimeMs,
      });
    }
  };

  scan(baseDir, '');
  scan(path.join(baseDir, RAW_SUBDIR), RAW_SUBDIR);

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
  // 알림과 같은 규칙으로 거른다 — 그룹에 "적용 상임위"가 지정돼 있으면
  // 이 회의의 상임위에 해당하는 그룹만 본다.
  const groups = keywordsPath ? loadKeywords(keywordsPath) : [];
  const matcher = new KeywordMatcher(groups, { sessionName });
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
      매칭키워드: hits.map((h) => ({ 그룹: h.group, 패턴: h.pattern, 알림: h.notify !== false })),
    });
  }

  // 회의 진행 순서(영상 시점)대로 정렬한다. 예전에는 키워드 중요도가 높은
  // 것을 위로 올렸는데, 회의록 성격의 문서에서는 시간순이 읽기 쉽고
  // "알림 여부"는 보고서의 중요도와 무관한 축이다.
  reports.sort((a, b) => String(a.영상시점).localeCompare(String(b.영상시점)));

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
  let docxPath = null;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    const safe = String(sessionName).replace(/[\\/:*?"<>|]/g, '_');
    outPath = path.join(outDir, `report_${safe}_${Date.now()}.json`);

    // 워드 파일명은 JSON과 짝을 이루게 한다 — GUI에서 JSON을 골라
    // 워드를 내려받을 때 이름으로 찾을 수 있어야 한다.
    docxPath = outPath.replace(/\.json$/, '.docx');
    result.메타.워드파일 = path.basename(docxPath);

    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
    result.메타.저장경로 = outPath;

    // 워드 생성 실패가 JSON까지 날리면 안 된다 — JSON을 먼저 쓰고 감싼다.
    try {
      fs.writeFileSync(docxPath, await buildDocx(result));
    } catch (err) {
      docxPath = null;
      onProgress({ phase: 'docx-error', message: err.message });
    }
  }

  onProgress({ phase: 'done', 건수: reports.length, 저장경로: outPath, 워드: docxPath });
  return result;
}

module.exports = {
  runReportPipeline,
  listCaptionFiles,
  dateFromFilename,
  sessionFromFilename,
  docxFilename,
};
