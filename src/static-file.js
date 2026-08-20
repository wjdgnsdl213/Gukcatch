/**
 * path traversal 방지가 된 정적 파일 서빙 헬퍼. dashboard.js(P1-2)와
 * app-server.js(GUI 제어판)가 둘 다 shots/ 디렉터리를 정적으로 서빙해야
 * 해서 공유 모듈로 뽑았다 — 보안에 민감한 로직을 두 곳에 복붙하면
 * 한쪽만 고쳐지는 사고가 나기 쉽다.
 */

const fs = require('fs');
const path = require('path');

const CONTENT_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

/**
 * `${urlPrefix}파일명` 요청을 `dir` 하위 파일로 서빙한다.
 * path.basename()이 디렉터리 성분을 전부 제거하므로 `../../etc/passwd`
 * 같은 요청도 dir 밖으로 못 나간다.
 *
 * @param {string} dir - 서빙할 루트 디렉터리
 * @param {string} urlPath - req.url (쿼리스트링 포함 가능)
 * @param {string} urlPrefix - 예: '/shots/'
 * @param {import('http').ServerResponse} res
 */
function serveFromDir(dir, urlPath, urlPrefix, res) {
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
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

module.exports = { serveFromDir };
