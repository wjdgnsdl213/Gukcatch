/**
 * 콘솔 출력 + 히트 로그 파일. 항상 동작하는 채널 — 다른 채널이 전부
 * 실패하거나 미설정이어도 이것만은 남는다. 시연에도 그대로 쓸 수 있다.
 */

const fs = require('fs');
const path = require('path');

function hitLogPath(baseDir = '.') {
  return path.join(baseDir, 'hits.log');
}

async function send(payload, opts = {}) {
  const header = `[${payload.session}] ${payload.videoTimeFormatted} 【${payload.group}】${payload.keyword}`;
  console.log(`\n🔔 ${header}\n   ${payload.text}`);
  if (payload.contextBefore?.length) console.log('   ↑ ' + payload.contextBefore.join(' / '));
  if (payload.contextAfter?.length) console.log('   ↓ ' + payload.contextAfter.join(' / '));

  const record = JSON.stringify({ ...payload, loggedAt: new Date().toISOString() });
  await fs.promises.appendFile(hitLogPath(opts.baseDir), record + '\n', 'utf8');
}

module.exports = { name: 'console', send, hitLogPath };
