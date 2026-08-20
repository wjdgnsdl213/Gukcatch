/**
 * 키워드 히트 시점 화면 캡처 (P1-3) — 최대 차별점.
 *
 * 의원이 띄우는 자료화면(그래프/표/PPT)은 영상에만 존재하고 자막 텍스트에는
 * 절대 안 잡힌다. "사이트가 다 올려주는데 왜 필요하냐"는 질문에 대한
 * 가장 깔끔한 답변이 이 기능이다.
 *
 * ⚠️ 검은 화면 위험: DRM/하드웨어 가속 렌더링이면 video 영역이 검게
 * 캡처될 수 있다. probe.js(Phase 0)로 사전 확인한 3단 폴백을 그대로
 * 모듈화했다:
 *   1. canvas.drawImage(video)로 평균 밝기를 먼저 측정한다 (파일 저장 없이
 *      빠르게 판정만) — ROADMAP 원안은 "1.element→2.CDP→3.canvas" 순서지만,
 *      element/CDP 결과물(PNG)의 밝기를 판정하려면 PNG 디코딩 라이브러리가
 *      추가로 필요하다. canvas는 브라우저 API만으로 즉시 밝기를 알 수 있어
 *      먼저 판정 도구로 쓰고, 그 결과로 저장 방법을 고르는 순서로 바꿨다.
 *   2. 밝지 않으면(정상) → video 엘리먼트를 고품질로 바로 캡처해 저장
 *   3. 검거나(DRM/HW가속) canvas 자체가 실패하면 → CDP 전체화면 캡처로
 *      대체한다 (probe 테스트에서 canvas가 videoWidth=0으로 실패해도
 *      element/CDP 캡처는 정상 화면을 담는 경우를 실제로 관찰했다)
 *   4. CDP마저 실패하면 → canvas dataURL이라도 저장 (검더라도 "시도했다"는
 *      기록은 남긴다)
 */

const fs = require('fs');
const path = require('path');

const BLACK_LUMA_THRESHOLD = 8; // 0~255 스케일, 이 이하면 "검은 화면"
const DEFAULT_MAX_SHOTS_PER_SESSION = 200;

/** @returns {Promise<{buffer: Buffer, method: 'element'|'cdp'|'canvas', meanLuma: number|null, black?: boolean} | null>} */
async function captureVideoFrame(page) {
  const probe = await page.evaluate(() => {
    const v = document.querySelector('video');
    if (!v || !v.videoWidth) return { ok: false, reason: 'no-video-frame' };
    const c = document.createElement('canvas');
    c.width = Math.min(v.videoWidth, 640);
    c.height = Math.max(1, Math.round((c.width / v.videoWidth) * v.videoHeight));
    const ctx = c.getContext('2d');
    try {
      ctx.drawImage(v, 0, 0, c.width, c.height);
    } catch (e) {
      return { ok: false, reason: 'draw-failed: ' + e.message };
    }
    let px;
    try {
      px = ctx.getImageData(0, 0, c.width, c.height).data;
    } catch (e) {
      return { ok: false, reason: 'tainted-canvas: ' + e.message };
    }
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) {
      sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    }
    const meanLuma = sum / (px.length / 4);
    let dataUrl = null;
    try {
      dataUrl = c.toDataURL('image/png');
    } catch {
      dataUrl = null;
    }
    return { ok: true, meanLuma, dataUrl };
  });

  const isBlack = !probe.ok || probe.meanLuma < BLACK_LUMA_THRESHOLD;

  if (probe.ok && !isBlack) {
    try {
      const buffer = await page.locator('video').first().screenshot({ timeout: 5000 });
      return { buffer, method: 'element', meanLuma: probe.meanLuma };
    } catch {
      // element screenshot 실패 — CDP로 계속 폴백
    }
  }

  try {
    const cdp = await page.context().newCDPSession(page);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await cdp.detach();
    return { buffer: Buffer.from(data, 'base64'), method: 'cdp', meanLuma: probe.ok ? probe.meanLuma : null };
  } catch {
    if (probe.ok && probe.dataUrl) {
      return {
        buffer: Buffer.from(probe.dataUrl.split(',')[1], 'base64'),
        method: 'canvas',
        meanLuma: probe.meanLuma,
        black: isBlack,
      };
    }
    return null;
  }
}

class ShotService {
  constructor({ dir = 'shots', maxPerSession = DEFAULT_MAX_SHOTS_PER_SESSION } = {}) {
    this.dir = dir;
    this.maxPerSession = maxPerSession;
    this.counts = new Map(); // sessionName -> 저장된 캡처 수
  }

  /** 히트 시점 화면을 캡처해 파일로 저장한다. 세션당 회의당 상한 도달 시 조용히 null. */
  async captureAndSave({ page, sessionName, videoTimeStr }) {
    const count = this.counts.get(sessionName) || 0;
    if (count >= this.maxPerSession) return null;

    const result = await captureVideoFrame(page);
    if (!result) return null;

    fs.mkdirSync(this.dir, { recursive: true });
    const safeSession = String(sessionName).replace(/[\\/:*?"<>|]/g, '_');
    const filePath = path.join(this.dir, `${safeSession}_${videoTimeStr}_${Date.now()}.png`);
    fs.writeFileSync(filePath, result.buffer);

    this.counts.set(sessionName, count + 1);
    return {
      path: filePath,
      method: result.method,
      meanLuma: result.meanLuma,
      black: result.black || false,
    };
  }
}

module.exports = { ShotService, captureVideoFrame, BLACK_LUMA_THRESHOLD, DEFAULT_MAX_SHOTS_PER_SESSION };
