/**
 * path traversal 방지가 된 정적 파일 서빙 헬퍼. dashboard.js(P1-2)와
 * app-server.js(GUI 제어판)가 둘 다 shots/ 디렉터리를 정적으로 서빙해야
 * 해서 공유 모듈로 뽑았다 — 보안에 민감한 로직을 두 곳에 복붙하면
 * 한쪽만 고쳐지는 사고가 나기 쉽다.
 */

const fs = require('fs');
const path = require('path');

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/**
 * `${urlPrefix}파일명` 요청을 `dir` 하위 파일로 서빙한다.
 * path.basename()이 디렉터리 성분을 전부 제거하므로 `../../etc/passwd`
 * 같은 요청도 dir 밖으로 못 나간다.
 *
 * @param {string} dir - 서빙할 루트 디렉터리
 * @param {string} urlPath - req.url (쿼리스트링 포함 가능)
 * @param {string} urlPrefix - 예: '/shots/'
 * @param {import('http').ServerResponse} res
 * @param {{cacheControl?: string}} [opts] - 정적 자산(폰트 등)은 오래 캐시해도 된다.
 *   파일명 자체가 바뀌지 않는 한(폰트 파일 교체 = 배포 갱신) 매번 2MB를
 *   다시 받을 이유가 없다. 캡처 스크린샷처럼 계속 늘어나는 파일에는 쓰지 않는다.
 */
function serveFromDir(dir, urlPath, urlPrefix, res, opts = {}) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.slice(urlPrefix.length).split('?')[0]);
  } catch {
    res.writeHead(400);
    return res.end('Bad Request');
  }
  const filename = path.basename(decoded);
  const filePath = path.join(dir, filename);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    const contentType = CONTENT_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': contentType };
    if (opts.cacheControl) headers['Cache-Control'] = opts.cacheControl;
    res.writeHead(200, headers);
    res.end(data);
  });
}

module.exports = { serveFromDir };
