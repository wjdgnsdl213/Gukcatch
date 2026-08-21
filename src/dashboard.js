/**
 * 로컬 HTML 대시보드 — 의존성 없이 node:http + SSE만으로 실시간 갱신.
 * 브라우저에 열어두면 모든 세션의 키워드 히트가 한 화면에 쌓인다.
 */

const http = require('http');
const path = require('path');
const { serveFromDir } = require('./static-file');

const MAX_CACHED_HITS = 200;

const PAGE_HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>국캐치</title>
<style>
  body { font-family: -apple-system, "Malgun Gothic", sans-serif; margin: 0; background: #0f1420; color: #e6e8ee; }
  header { padding: 16px 24px; background: #171d2e; border-bottom: 1px solid #2a3350; position: sticky; top: 0; }
  header h1 { margin: 0; font-size: 18px; }
  #status { font-size: 12px; color: #8a93ab; margin-top: 4px; }
  #list { padding: 16px 24px; display: flex; flex-direction: column; gap: 10px; }
  .hit { background: #171d2e; border-left: 4px solid #3498db; border-radius: 6px; padding: 12px 16px; }
  .hit.muted { border-left-color: #d0d0d0; opacity: 0.75; }
  .hit .meta { font-size: 12px; color: #8a93ab; margin-bottom: 6px; }
  .hit .kw { display: inline-block; background: #2a3350; padding: 1px 8px; border-radius: 10px; font-size: 12px; margin-right: 6px; }
  .hit .text { font-size: 15px; }
  .hit .ctx { font-size: 13px; color: #8a93ab; margin-top: 6px; white-space: pre-line; }
  .hit img { display: block; margin-top: 8px; max-width: 480px; max-height: 270px; border-radius: 4px; border: 1px solid #2a3350; }
  .empty { color: #8a93ab; padding: 24px; text-align: center; }
</style>
</head>
<body>
<header>
  <h1>국캐치 — 실시간 키워드 히트</h1>
  <div id="status">연결 중...</div>
</header>
<div id="list"><div class="empty">아직 히트가 없습니다.</div></div>
<script>
  const list = document.getElementById('list');
  const status = document.getElementById('status');
  let rendered = false;

  function render(hit) {
    if (!rendered) { list.innerHTML = ''; rendered = true; }
    const el = document.createElement('div');
    el.className = 'hit' + (hit.notify === false ? ' muted' : '');
    const ctx = [
      ...(hit.contextBefore || []),
      '▶ ' + hit.text,
      ...(hit.contextAfter || []),
    ].join('\\n');
    el.innerHTML =
      '<div class="meta">[' + hit.session + '] ' + hit.videoTimeFormatted + '</div>' +
      '<span class="kw">' + hit.group + '</span>' + hit.keyword +
      '<div class="ctx"></div>';
    el.querySelector('.ctx').textContent = ctx;
    if (hit.screenshotPath) {
      const filename = hit.screenshotPath.split(/[\\/]/).pop();
      const img = document.createElement('img');
      img.src = '/shots/' + encodeURIComponent(filename);
      img.alt = '히트 시점 화면 캡처';
      el.appendChild(img);
    }
    list.prepend(el);
  }

  const es = new EventSource('/events');
  es.onopen = () => { status.textContent = '연결됨'; };
  es.onerror = () => { status.textContent = '연결 끊김 — 재연결 시도 중'; };
  es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'init') {
      msg.hits.slice().reverse().forEach(render);
    } else {
      render(msg);
    }
  };
</script>
</body>
</html>`;

class Dashboard {
  constructor({ port = 7878, shotsDir = null } = {}) {
    this.port = port;
    this.shotsDir = shotsDir ? path.resolve(shotsDir) : null;
    this.clients = new Set();
    this.recentHits = [];
    this.server = http.createServer((req, res) => this._handle(req, res));
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, () => resolve(this.port));
    });
  }

  broadcast(hit) {
    this.recentHits.push(hit);
    if (this.recentHits.length > MAX_CACHED_HITS) this.recentHits.shift();
    const data = `data: ${JSON.stringify(hit)}\n\n`;
    for (const res of this.clients) res.write(data);
  }

  _handle(req, res) {
    if (req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ type: 'init', hits: this.recentHits })}\n\n`);
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return;
    }
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PAGE_HTML);
      return;
    }
    if (this.shotsDir && req.url.startsWith('/shots/')) {
      return this._serveShot(req, res);
    }
    res.writeHead(404);
    res.end('Not Found');
  }

  /** 캡처된 스크린샷을 정적으로 서빙한다 (path traversal 방지는 static-file.js 참조). */
  _serveShot(req, res) {
    serveFromDir(this.shotsDir, req.url, '/shots/', res);
  }

  async close() {
    for (const res of this.clients) res.end();
    this.clients.clear();
    await new Promise((resolve) => this.server.close(() => resolve()));
  }
}

module.exports = { Dashboard };
