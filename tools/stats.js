#!/usr/bin/env node
/**
 * 통계 HTML 생성 (P2-4). 발표 슬라이드에 그대로 붙일 수 있는 시각 자료.
 * 기능이라기보다 발표 자산이므로 의존성 없는 단일 HTML — 인라인 SVG로
 * 직접 그린다 (Chart.js 등 외부 라이브러리 불필요).
 *
 * 데이터 소스:
 *   - hits.log (P1-2 콘솔 채널이 기록하는 JSONL) → 키워드/상임위/일자별 분포
 *   - reports/*.json (P2-2가 생성하는 보고 초안)   → 발언자별 등장 빈도
 * 이렌더링 시점에 없는 파일은 조용히 빈 배열로 취급한다 — 어느 하나가 없어도
 * 나머지 통계는 나온다.
 *
 * 사용법:
 *   node tools/stats.js [hits.log 경로] [reports 폴더 경로] [출력 HTML 경로]
 */

const fs = require('fs');
const path = require('path');

const hitsLogPath = process.argv[2] || path.join(__dirname, '..', 'hits.log');
const reportsDir = process.argv[3] || path.join(__dirname, '..', 'reports');
const outPath = process.argv[4] || path.join(__dirname, '..', 'stats.html');

function loadHits(p) {
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function loadReports(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const all = [];
  for (const file of files) {
    try {
      all.push(...JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
    } catch {
      // 손상된 보고서 파일은 건너뛴다
    }
  }
  return all;
}

function countBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (!k) continue;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 의존성 없이 인라인 SVG 수평 막대그래프를 그린다. */
function barChartSVG(entries, { width = 640, barHeight = 22, gap = 8, color = '#3498db', maxBars = 15 } = {}) {
  const data = entries.slice(0, maxBars);
  if (data.length === 0) {
    return `<div style="color:#8a93ab;padding:16px 0;">데이터가 없습니다.</div>`;
  }
  const max = Math.max(...data.map(([, v]) => v), 1);
  const labelWidth = 180;
  const chartWidth = width - labelWidth - 50;
  const height = data.length * (barHeight + gap) + gap;

  const bars = data
    .map(([label, value], i) => {
      const y = gap + i * (barHeight + gap);
      const barW = Math.max(2, (value / max) * chartWidth);
      return `
      <text x="${labelWidth - 8}" y="${y + barHeight / 2 + 4}" text-anchor="end" font-size="12" fill="#333">${escapeXml(label)}</text>
      <rect x="${labelWidth}" y="${y}" width="${barW}" height="${barHeight}" fill="${color}" rx="3" />
      <text x="${labelWidth + barW + 6}" y="${y + barHeight / 2 + 4}" font-size="12" fill="#333">${value}</text>`;
    })
    .join('');

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

const hits = loadHits(hitsLogPath);
const reports = loadReports(reportsDir);

const bySession = countBy(hits, (h) => h.session);
const byGroup = countBy(hits, (h) => h.group);
const byDate = countBy(hits, (h) => h.loggedAt?.slice(0, 10)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
const bySpeaker = countBy(reports, (r) => r.발언자);

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>국회 자막 모니터 — 통계</title>
<style>
  body { font-family: -apple-system, "Malgun Gothic", sans-serif; margin: 0; padding: 24px; background: #f5f6fa; color: #1a1a1a; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color: #666; font-size: 13px; margin-bottom: 24px; }
  .card { background: #fff; border-radius: 8px; padding: 20px 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .card h2 { font-size: 15px; margin: 0 0 12px 0; }
  .stat-row { display: flex; gap: 16px; margin-bottom: 20px; }
  .stat-box { flex: 1; background: #fff; border-radius: 8px; padding: 16px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); text-align: center; }
  .stat-box .num { font-size: 28px; font-weight: bold; color: #2c3e50; }
  .stat-box .label { font-size: 12px; color: #666; margin-top: 4px; }
</style>
</head>
<body>
<h1>국회 자막 모니터 — 통계</h1>
<div class="meta">생성 시각: ${new Date().toLocaleString('ko-KR')} · 히트 ${hits.length}건 · 보고서 ${reports.length}건</div>

<div class="stat-row">
  <div class="stat-box"><div class="num">${hits.length}</div><div class="label">전체 키워드 히트</div></div>
  <div class="stat-box"><div class="num">${bySession.length}</div><div class="label">감시 상임위 수</div></div>
  <div class="stat-box"><div class="num">${byGroup.length}</div><div class="label">감지된 키워드 그룹</div></div>
  <div class="stat-box"><div class="num">${reports.length}</div><div class="label">생성된 보고 초안</div></div>
</div>

<div class="card">
  <h2>상임위별 언급 횟수</h2>
  ${barChartSVG(bySession, { color: '#3498db' })}
</div>

<div class="card">
  <h2>키워드 그룹별 분포</h2>
  ${barChartSVG(byGroup, { color: '#9b59b6' })}
</div>

<div class="card">
  <h2>일자별 언급 추이</h2>
  ${barChartSVG(byDate, { color: '#27ae60', maxBars: 30 })}
</div>

<div class="card">
  <h2>의원별 언급 빈도 (Q&A 보고서 기준, 상위 15)</h2>
  ${barChartSVG(bySpeaker, { color: '#e67e22' })}
</div>

</body>
</html>`;

fs.writeFileSync(outPath, html, 'utf8');
console.log('저장:', outPath);
console.log(`(히트 ${hits.length}건, 보고서 ${reports.length}건 기준)`);
