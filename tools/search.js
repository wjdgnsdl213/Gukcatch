#!/usr/bin/env node
/**
 * 아카이브 횡단 검색 CLI (P2-3). 사이트는 회의별로만 자막을 보여준다 —
 * "최근 3년간 우리 기관이 언급된 발언 전부" 같은 검색은 여기서만 가능하다.
 *
 * 사용법:
 *   node tools/search.js <검색어> [--session 이름] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dir archive]
 *
 * 예:
 *   node tools/search.js 국민건강보험공단
 *   node tools/search.js 장기요양 --session 보건복지위 --from 2026-01-01
 */

const path = require('path');
const { loadAllRecords } = require('../src/archive');

function parseArgs(argv) {
  const args = { query: null, session: null, from: null, to: null, dir: 'archive' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--session') args.session = argv[++i];
    else if (a === '--from') args.from = argv[++i];
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--dir') args.dir = argv[++i];
    else rest.push(a);
  }
  args.query = rest.join(' ');
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.query) {
  console.error('사용법: node tools/search.js <검색어> [--session 이름] [--from YYYY-MM-DD] [--to YYYY-MM-DD]');
  process.exit(1);
}

const archiveDir = path.isAbsolute(args.dir) ? args.dir : path.join(__dirname, '..', args.dir);
const records = loadAllRecords(archiveDir);

const normalize = (s) => String(s).replace(/\s+/g, '');
const needle = normalize(args.query);

const results = records.filter((r) => {
  if (!normalize(r.텍스트).includes(needle)) return false;
  if (args.session && r.상임위 !== args.session) return false;
  if (args.from && r.일자 < args.from) return false;
  if (args.to && r.일자 > args.to) return false;
  return true;
});

console.log(`아카이브 ${records.length}건 중 "${args.query}" 검색 결과: ${results.length}건\n`);
for (const r of results) {
  console.log(`[${r.일자} ${r.영상시점}] (${r.상임위}) ${r.텍스트}`);
}
