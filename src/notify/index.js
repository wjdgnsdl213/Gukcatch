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

async function dispatch(payload, { channels, baseDir, onError = console.error } = {}) {
  const list = channels || buildChannels();
  const results = await Promise.allSettled(list.map((ch) => ch.send(payload, { baseDir })));
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      onError(`[알림:${list[i].name}] 실패:`, r.reason?.message || r.reason);
    }
  });
}

module.exports = { dispatch, buildChannels };
