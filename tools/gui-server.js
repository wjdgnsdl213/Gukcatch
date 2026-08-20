#!/usr/bin/env node
/**
 * GUI 제어판을 웹 브라우저로 여는 실행 스크립트.
 *
 * 사용법:
 *   node tools/gui-server.js [포트=7878]
 *
 * Electron 없이 일반 브라우저에서 쓰고 싶을 때 이 방법을 쓴다. 같은
 * 제어판을 데스크톱 앱으로 띄우려면 electron/main.js를 실행한다 —
 * 둘 다 src/app-server.js를 그대로 재사용하므로 동작은 동일하다.
 */

const path = require('path');
const { execFile } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { AppServer } = require('../src/app-server');

const port = Number(process.argv[2]) || 7878;
const server = new AppServer({ port, baseDir: path.join(__dirname, '..') });

let shuttingDown = false;

/** 브라우저 자동 오픈 실패는 치명적이지 않다 — 서버는 계속 뜬 채로 URL만 안내하면 된다. */
function openBrowser(url) {
  const onError = () => {};
  if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '""', url], onError);
  else if (process.platform === 'darwin') execFile('open', [url], onError);
  else execFile('xdg-open', [url], onError);
}

(async () => {
  const actualPort = await server.start();
  const url = `http://localhost:${actualPort}`;
  console.log(`제어판: ${url}`);
  console.log('Ctrl+C로 종료.');
  openBrowser(url);

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} 수신 — 종료 처리 중...`);
    await server.close().catch((err) => console.error('종료 처리 중 오류:', err));
    console.log('종료.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    console.error('처리되지 않은 예외:', err);
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    console.error('처리되지 않은 프로미스 거부:', reason);
    shutdown('unhandledRejection');
  });
})().catch((err) => {
  console.error('제어판 시작 실패:', err);
  process.exit(1);
});
