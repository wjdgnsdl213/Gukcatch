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
const fs = require('fs');
const { serveFromDir } = require('./static-file');
const { runAll } = require('./runner');
const {
  loadConfigFile,
  saveConfigFile,
  loadKeywordsFile,
  saveKeywordsFile,
} = require('./settings-store');
const { PAGE_HTML } = require('./control-panel-page');
const { runReportPipeline, listCaptionFiles } = require('./report-run');
const { buildDocx, docxFilename } = require('./docx-report');

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

    this.reportsDir = path.join(baseDir, 'reports');

    this.clients = new Set(); // SSE 응답 객체들
    this.recentEvents = []; // 재접속 시 최근 이벤트 재전송용
    this.runtime = null; // runAll() 결과 — 실행 중일 때만 존재
    this.reportJob = null; // 진행 중인 보고서 생성 작업 (동시 실행 방지)

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
    this._send(event);
  }

  /**
   * 재접속 재전송 캐시에 남기지 않고 지금 붙어 있는 클라이언트에만 보낸다.
   * 보고서 진행/결과 이벤트용 — 결과 JSON은 수백 KB까지 커질 수 있어
   * 캐시에 넣으면 새로 접속하는 브라우저마다 통째로 다시 받게 되고,
   * 진행 이벤트는 건수가 많아 히트/로그 캐시를 밀어낸다. 결과물은 어차피
   * reports/에 저장되므로 목록에서 다시 불러올 수 있다.
   */
  _sendEphemeral(event) {
    this._send(event);
  }

  _send(event) {
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

  // ── 보고서 생성 ──────────────────────────────────────────────────────
  /**
   * 보고서 생성을 백그라운드로 시작한다. 회의 하나에 Claude 호출이 여러 번
   * 일어나 수 분이 걸리므로 HTTP 응답을 붙잡아두지 않고, 진행 상황은 기존
   * SSE 채널로 흘려보낸다 (감시 로그와 같은 경로).
   */
  startReport({ file, dept } = {}) {
    if (this.reportJob) throw new Error('이미 보고서를 생성 중입니다.');

    // 경로 조작 방지 — 목록에 실제로 있는 relPath와 정확히 일치할 때만 받는다.
    // raw는 raw/ 하위에 있어 basename만으로는 경로를 조립할 수 없다.
    const rel = String(file || '');
    const entry = listCaptionFiles(this.baseDir).find((f) => f.relPath === rel);
    if (!entry) throw new Error(`자막 파일을 찾을 수 없음: ${rel}`);

    const name = entry.name;
    const inputFile = path.join(this.baseDir, ...entry.relPath.split('/'));
    const emit = (payload) => this._sendEphemeral({ type: 'report', payload });

    this.reportJob = { file: name, startedAt: Date.now() };
    emit({ phase: 'start', 파일: name });
    this.broadcastLog({ level: 'info', message: `보고서 생성 시작 — ${name}` });

    // 의도적으로 await하지 않는다. 실패는 SSE로 통지되고 reportJob이 풀린다.
    runReportPipeline({
      inputFile,
      dept: dept || null,
      keywordsPath: this.keywordsPath,
      outDir: this.reportsDir,
      onProgress: emit,
    })
      .then((result) => {
        this.broadcastLog({
          level: 'info',
          message: `보고서 생성 완료 — ${result.보고서.length}건 (${path.basename(result.메타.저장경로 || '')})`,
        });
        emit({ phase: 'result', result });
      })
      .catch((err) => {
        this.broadcastLog({ level: 'error', message: `보고서 생성 실패: ${err.message}` });
        emit({ phase: 'error', message: err.message });
      })
      .finally(() => {
        this.reportJob = null;
      });

    return { started: true, file: name };
  }

  /** 생성된 보고서 파일 목록 (최신순) */
  listReports() {
    if (!fs.existsSync(this.reportsDir)) return [];
    return fs
      .readdirSync(this.reportsDir)
      .filter((n) => n.endsWith('.json'))
      .map((n) => ({ name: n, mtime: fs.statSync(path.join(this.reportsDir, n)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  }

  readReport(name) {
    const safe = path.basename(String(name || ''));
    const full = path.join(this.reportsDir, safe);
    if (!safe.endsWith('.json') || !fs.existsSync(full)) {
      throw new Error(`보고서를 찾을 수 없음: ${safe}`);
    }
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  }

  /**
   * 보고서의 워드 파일을 돌려준다. 생성 당시 함께 저장되지만, 예전 보고서나
   * 워드 생성만 실패한 경우를 위해 없으면 그 자리에서 만들어 캐시한다.
   * @returns {Promise<{buffer: Buffer, filename: string}>}
   */
  async getReportDocx(name) {
    const safe = path.basename(String(name || ''));
    if (!safe.endsWith('.json')) throw new Error(`잘못된 보고서 이름: ${safe}`);
    const jsonPath = path.join(this.reportsDir, safe);
    if (!fs.existsSync(jsonPath)) throw new Error(`보고서를 찾을 수 없음: ${safe}`);

    const result = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const docxPath = jsonPath.replace(/\.json$/, '.docx');
    const filename = docxFilename(result);

    if (fs.existsSync(docxPath)) {
      return { buffer: fs.readFileSync(docxPath), filename };
    }
    const buffer = await buildDocx(result);
    fs.writeFileSync(docxPath, buffer);
    return { buffer, filename };
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

    if (p === '/api/report/files' && req.method === 'GET') {
      return this._json(res, 200, {
        files: listCaptionFiles(this.baseDir),
        running: Boolean(this.reportJob),
        hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
      });
    }

    if (p === '/api/report/run' && req.method === 'POST') {
      const body = await readJsonBody(req);
      return this._json(res, 200, this.startReport(body));
    }

    if (p === '/api/report/list' && req.method === 'GET') {
      return this._json(res, 200, { reports: this.listReports() });
    }

    if (p.startsWith('/api/report/view/') && req.method === 'GET') {
      const name = decodeURIComponent(p.slice('/api/report/view/'.length));
      return this._json(res, 200, this.readReport(name));
    }

    if (p.startsWith('/api/report/docx/') && req.method === 'GET') {
      const name = decodeURIComponent(p.slice('/api/report/docx/'.length));
      const { buffer, filename } = await this.getReportDocx(name);
      // filename*=UTF-8''… 로 한글 파일명을 보존한다. filename= 만 쓰면
      // 브라우저가 latin-1로 해석해 깨진다.
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': buffer.length,
      });
      return res.end(buffer);
    }

    res.writeHead(404);
    res.end('Not Found');
  }
}

module.exports = { AppServer };
