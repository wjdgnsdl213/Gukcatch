/**
 * 알림 디스패처. 채널 하나의 실패/미설정이 다른 채널을 막지 않도록
 * Promise.allSettled로 병렬 실행한다.
 */

const consoleChannel = require('./console');
const toastChannel = require('./toast');
const doorayChannel = require('./dooray');
const mailChannel = require('./mail');

/** dashboard는 상태(연결된 클라이언트)를 갖는 인스턴스라 동적으로 채널 목록에 끼워 넣는다. */
function buildChannels({ dashboard } = {}) {
  const channels = [consoleChannel, toastChannel, doorayChannel, mailChannel];
  if (dashboard) {
    channels.push({ name: 'dashboard', send: (payload) => dashboard.broadcast(payload) });
  }
  return channels;
}

/**
 * @param {string|string[]} [mailTo] - config.json의 기본 수신자 (메일 채널용)
 */
async function dispatch(payload, { channels, baseDir, mailTo, onError = console.error } = {}) {
  const all = channels || buildChannels();

  // 그룹이 '알림x'면 사용자를 방해하는 채널(토스트/메일/Dooray)만 건너뛴다.
  // 콘솔과 대시보드는 기록에 가까우므로 그대로 남긴다 — 알림을 끈 것이지
  // 히트 자체를 없앤 게 아니고, 회의 중 화면에서는 여전히 보여야 한다.
  const list = payload.notify === false ? all.filter((ch) => !ch.alerting) : all;

  const results = await Promise.allSettled(
    list.map((ch) => ch.send(payload, { baseDir, defaultTo: mailTo })),
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      onError(`[알림:${list[i].name}] 실패:`, r.reason?.message || r.reason);
    }
  });
}

module.exports = { dispatch, buildChannels };
