/**
 * 확정 이벤트(P0-2) → 키워드 매칭 → 문맥 수집 → 알림 디스패치.
 *
 * 문맥은 "확정 줄 기준 앞 3줄 + 뒤 2줄"이다. 뒤 2줄은 히트가 발생한
 * 시점에는 아직 존재하지 않으므로, 일정 시간 대기한 뒤 그 사이 확정된
 * 줄까지 포함해 알림을 발송한다 (CONTEXT_WAIT_MS).
 *
 * 딥링크(자막 클릭 → 영상 점프)는 webcast.go.kr의 URL 파라미터 규격이
 * 라이브 방송 재개 전까지 미검증이라 payload.deepLink = null로 둔다.
 * (VOD 사이트는 start/end 초 단위 속성을 쓰지만, 실시간 페이지가 같은
 * 방식을 쓴다는 보장이 없다 — ROADMAP P0-1-a)
 */

const { KeywordMatcher } = require('./keywords');
const { formatVideoTime } = require('./store');
const { dispatch } = require('./notify');

const CONTEXT_BEFORE = 3;
const CONTEXT_AFTER = 2;
const CONTEXT_WAIT_MS = 4000;
const MAX_HISTORY = 500; // 세션당 문맥 히스토리 메모리 상한

class HitDetector {
  /**
   * @param {import('./keywords').KeywordMatcher} matcher
   * @param {string} sessionName
   * @param {Array} channels - notify.buildChannels()의 결과 (세션들이 공유)
   * @param {import('./shot').ShotService} [shotService] - 없으면 화면 캡처를 건너뛴다
   */
  constructor({ matcher, sessionName, channels, baseDir = '.', mailTo, shotService, onError = console.error }) {
    this.matcher = matcher;
    this.sessionName = sessionName;
    this.channels = channels;
    this.baseDir = baseDir;
    this.mailTo = mailTo || null;
    this.shotService = shotService || null;
    this.onError = onError;
    this.history = [];
  }

  /** LineTracker의 onSettled 콜백에 그대로 연결한다. */
  onSettled(entry) {
    this.history.push(entry);
    if (this.history.length > MAX_HISTORY) this.history.shift();

    if (!this.matcher.enabled) return;

    const hits = this.matcher.match(entry.text);
    const historyIndex = this.history.length - 1;
    for (const hit of hits) {
      this._scheduleNotify(entry, hit, historyIndex);
    }
  }

  _scheduleNotify(entry, hit, historyIndex) {
    const timer = setTimeout(async () => {
      const before = this.history
        .slice(Math.max(0, historyIndex - CONTEXT_BEFORE), historyIndex)
        .map((e) => e.text);
      const after = this.history.slice(historyIndex + 1, historyIndex + 1 + CONTEXT_AFTER).map((e) => e.text);

      // P1-3: 히트 시점 화면 캡처. entry.page는 session.js가 onSettled에
      // 실어 보낸 것 — page가 이미 닫혔을 수도 있으니 실패해도 알림 자체는
      // 계속 보낸다(캡처는 부가 정보이지 알림의 필수 조건이 아니다).
      let screenshot = null;
      if (this.shotService && entry.page && !entry.page.isClosed?.()) {
        try {
          const videoTimeStr = formatVideoTime(entry.videoTime).replace(/:/g, '-');
          screenshot = await this.shotService.captureAndSave({
            page: entry.page,
            sessionName: this.sessionName,
            videoTimeStr,
          });
        } catch (err) {
          this.onError(`[${this.sessionName}] 화면 캡처 실패:`, err.message);
        }
      }

      const payload = {
        session: this.sessionName,
        keyword: hit.pattern,
        group: hit.group,
        dept: hit.dept,
        notify: hit.notify,
        emails: hit.emails,
        text: entry.text,
        videoTime: entry.videoTime,
        videoTimeFormatted: formatVideoTime(entry.videoTime),
        wallTime: entry.wallTime,
        contextBefore: before,
        contextAfter: after,
        deepLink: null, // TODO: 라이브 URL 파라미터 규격 확인 후 채울 것
        screenshotPath: screenshot?.path || null,
        screenshotMethod: screenshot?.method || null,
      };

      dispatch(payload, { channels: this.channels, baseDir: this.baseDir, mailTo: this.mailTo, onError: this.onError }).catch(
        (err) => this.onError('[알림 디스패치 실패]', err),
      );
    }, CONTEXT_WAIT_MS);
    timer.unref?.();
  }
}

module.exports = { HitDetector, KeywordMatcher, CONTEXT_BEFORE, CONTEXT_AFTER, CONTEXT_WAIT_MS };
