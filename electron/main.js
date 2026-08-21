/**
 * GUI 제어판을 데스크톱 앱으로 띄우는 Electron 진입점.
 * src/app-server.js(같은 서버)를 그대로 재사용한다 — 로직은 웹 모드
 * (tools/gui-server.js)와 완전히 동일하고, 여기서는 그걸 BrowserWindow로
 * 감싸기만 한다.
 *
 * 실행: npx electron electron/main.js  (또는 npm run electron)
 */

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const { AppServer } = require('../src/app-server');

let appServer = null;
let mainWindow = null;

async function createWindow() {
  // port: 0 → OS가 빈 포트를 골라준다. 데스크톱 앱은 다른 프로세스와
  // 포트 충돌을 신경 쓸 필요가 없다(사용자가 URL을 직접 입력하지 않으므로).
  appServer = new AppServer({ port: 0, baseDir: path.join(__dirname, '..') });
  const port = await appServer.start();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: '국캐치',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  // 창 안에서 새 창을 여는 링크는 시스템 브라우저로 보낸다 (앱 안에 새 창이 뜨지 않게)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);

// 이 앱은 macOS 메뉴바에 상주하는 성격의 도구가 아니다 — 창을 닫으면
// 감시 세션(브라우저·타이머)까지 정리하고 완전히 종료하는 게 자연스럽다.
app.on('window-all-closed', async () => {
  await appServer?.close().catch(() => {});
  app.quit();
});
