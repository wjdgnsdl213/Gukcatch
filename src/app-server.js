/**
 * GUI 제어판 서버. 웹 브라우저(tools/gui-server.js)와 Electron
 * (electron/main.js) 양쪽에서 그대로 재사용한다 — 두 실행 방식이 같은
 * HTTP 서버를 각각 브라우저 탭 / BrowserWindow로 여는 것뿐이라 로직을
 * 두 번 만들지 않는다.
 *
 * config.json / keywords.json은 CLI(natv-caption-scraper.js)와 공유한다.
 * GUI에서 저장한 설정을 CLI로 그대로 실행할 수 있고, 반대로 손으로
 * 편집한 파일도 GUI가 그대로 읽는다.
 *
 * "대시보드" 역할은 notify/index.js의 buildChannels({dashboard})가
 * `.broadcast(hit)` 메서드만 있으면 되는 duck typing이라, 이 클래스를
 * 그대로 dashboard 인자로 넘긴다 — src/dashboard.js(P1-2, CLI 전용
 * 대시보드)는 건드리지 않고 별도로 공존한다.
 */

const http = require('http');
const path = require('path');
const { serveFromDir } = require('./static-file');
const { runAll } = require('./runner');
const {
  loadConfigFile,
  saveConfigFile,
  loadKeywordsFile,
  saveKeywordsFile,
} = require('./settings-store');
const { PAGE_HTML } = require('./control-panel-page');

const MAX_CACHED_EVENTS = 300;
const MAX_BODY_BYTES = 1024 * 1024; // 1MB — 설정 파일 하나 저장하는 데 이 이상은 필요 없다

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error('요청 본문이 너무 큽니다'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('잘못된 JSON: ' + e.message));
      }
    });
    req.on('error', reject);
  });
}

class AppServer {
  constructor({ port = 7878, baseDir = process.cwd() } = {}) {
    this.port = port;
    this.baseDir = baseDir;
    this.configPath = path.join(baseDir, 'config.json');
    this.keywordsPath = path.join(baseDir, 'keywords.json');
    this.shotsDir = path.join(baseDir, 'shots');
    this.archiveDir = path.join(baseDir, 'archive');

    this.clients = new Set(); // SSE 응답 객체들
    this.recentEvents = []; // 재접속 시 최근 이벤트 재전송용
    this.runtime = null; // runAll() 결과 — 실행 중일 때만 존재

    this.server = http.createServer((req, res) => {
      this._handle(req, res).catch((err) => {
        this._json(res, 400, { error: err.message });
      });
    });
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, () => resolve(this.server.address().port));
    });
  }

  async close() {
    await this.stopMonitoring().catch(() => {});
    for (const res of this.clients) res.end();
    this.clients.clear();
    await new Promise((resolve) => this.server.close(() => resolve()));
  }

  // ── notify 채널 duck typing: runAll()의 dashboard 인자는 .broadcast()만 필요 ──
  broadcast(hit) {
    this._emit({ type: 'hit', payload: hit });
  }

  broadcastLog(entry) {
    this._emit({ type: 'log', payload: { at: Date.now(), ...entry } });
  }

  _emit(event) {
    this.recentEvents.push(event);
    if (this.recentEvents.length > MAX_CACHED_EVENTS) this.recentEvents.shift();
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this.clients) res.write(data);
  }

  getStatus() {
    return {
      running: Boolean(this.runtime),
      sessions: this.runtime ? this.runtime.sessions.map((s) => ({ name: s.name })) : [],
    };
  }

  _broadcastStatus() {
    this._emit({ type: 'status', payload: this.getStatus() });
  }

  async startMonitoring() {
    if (this.runtime) throw new Error('이미 감시 중입니다. 먼저 중지하세요.');

    const config = loadConfigFile(this.configPath);
    if (config.sessions.length === 0) {
      throw new Error('설정된 세션이 없습니다. 먼저 세션(URL)을 추가하고 저장하세요.');
    }

    this.broadcastLog({ level: 'info', message: `감시 시작 — ${config.sessions.length}개 세션` });

    const onLog = (msg) => this.broadcastLog({ level: 'info', message: msg });
    const onError = (msg, extra) =>
      this.broadcastLog({ level: 'error', message: extra !== undefined ? `${msg} ${extra}` : msg });

    // runAll()이 실패하면(예: 모든 세션이 시작에 실패) throw하므로 여기서
    // this.runtime을 설정하지 않은 채 위로 전파된다 — 상태는 여전히 "중지됨".
    const runtime = await runAll({
      sessions: config.sessions,
      headless: config.headless,
      settleMs: config.settleMs,
      watchdogIdleMs: config.watchdogIdleMs,
      baseDir: this.baseDir, // 누락 시 raw/정리본 캡션 파일이 process.cwd()에 생김 (Electron은 특히 cwd가 예측 불가)
      keywordsPath: this.keywordsPath,
      cooldownMs: config.cooldownMs,
      dashboard: this,
      shotsDir: this.shotsDir,
      maxShotsPerSession: config.maxShotsPerSession,
      archiveDir: this.archiveDir,
      onLog,
      onError,
    });

    this.runtime = runtime;
    this._broadcastStatus();
    return this.getStatus();
  }

  async stopMonitoring() {
    if (!this.runtime) return this.getStatus();
    this.broadcastLog({ level: 'info', message: '감시 종료 처리 중... (정리본 flush)' });
    const runtime = this.runtime;
    this.runtime = null; // 먼저 비워서 중복 stop 호출을 막는다
    await runtime.shutdownAll();
    this.broadcastLog({ level: 'info', message: '감시 종료됨' });
    this._broadcastStatus();
    return this.getStatus();
  }

  _json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }

  async _handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGE_HTML);
    }

    if (p === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ type: 'init', events: this.recentEvents, status: this.getStatus() })}\n\n`);
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return;
    }

    if (p.startsWith('/shots/')) {
      return serveFromDir(this.shotsDir, req.url, '/shots/', res);
    }

    if (p === '/api/config') {
      if (req.method === 'GET') return this._json(res, 200, loadConfigFile(this.configPath));
      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        saveConfigFile(this.configPath, body);
        return this._json(res, 200, { ok: true });
      }
    }

    if (p === '/api/keywords') {
      if (req.method === 'GET') return this._json(res, 200, loadKeywordsFile(this.keywordsPath));
      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        saveKeywordsFile(this.keywordsPath, body);
        // 감시 중이면 중지·재시작 없이 실행 중인 매처에 바로 반영한다 (핫 리로드).
        let reloaded = false;
        let groupCount = null;
        if (this.runtime) {
          groupCount = this.runtime.reloadKeywords();
          reloaded = true;
          this.broadcastLog({ level: 'info', message: `키워드 핫 리로드 — ${groupCount}개 그룹 적용됨` });
        }
        return this._json(res, 200, { ok: true, reloaded, groupCount });
      }
    }

    if (p === '/api/monitor/status' && req.method === 'GET') {
      return this._json(res, 200, this.getStatus());
    }

    if (p === '/api/monitor/start' && req.method === 'POST') {
      const status = await this.startMonitoring();
      return this._json(res, 200, status);
    }

    if (p === '/api/monitor/stop' && req.method === 'POST') {
      const status = await this.stopMonitoring();
      return this._json(res, 200, status);
    }

    res.writeHead(404);
    res.end('Not Found');
  }
}

module.exports = { AppServer };
