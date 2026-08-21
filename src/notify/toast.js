/**
 * 윈도우 토스트 알림. 3단 폴백:
 *   1. node-notifier (설치돼 있으면 우선 사용)
 *   2. PowerShell WinRT 토스트 API
 *   3. msg.exe (거의 모든 Windows에 내장 — 팝업이라 다소 침습적이지만 가장 확실)
 *
 * 셋 다 실패해도 dispatch()가 잡아 로그로 남기므로 여기서는 그냥 throw한다.
 *
 * 보안 주의: PowerShell 스크립트 문자열에 title/message를 직접 삽입하면
 * PowerShell 인젝션 위험이 있다(예: 텍스트에 `");whoami;("` 같은 내용이
 * 섞이는 경우). 스크립트는 고정 문자열로 두고, 실제 값은 환경변수로만
 * 전달한다 — execFile은 배열 인자라 OS 셸 인젝션과는 별개 문제다.
 */

const { execFile } = require('child_process');

let notifier = null;
try {
  // eslint-disable-next-line global-require
  notifier = require('node-notifier');
} catch {
  notifier = null;
}

/**
 * 3단 폴백을 순서대로 시도하고, 성공한 방식의 이름을 돌려준다.
 * @returns {Promise<string>} 'node-notifier' | 'powershell' | 'msg.exe'
 */
async function showToast(title, message) {
  const attempts = [
    ['node-notifier', () => sendViaNodeNotifier(title, message)],
    ['powershell', () => sendViaPowerShellToast(title, message)],
    ['msg.exe', () => sendViaMsgExe(message, title)],
  ];

  const failures = [];
  for (const [name, attempt] of attempts) {
    try {
      await attempt();
      return name;
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
    }
  }
  // 세 방식이 각각 왜 실패했는지 남긴다 — "그냥 실패"로는 원인을 못 좁힌다.
  throw new Error(`Windows 알림 3단 폴백 전부 실패 — ${failures.join(' / ')}`);
}

async function send(payload) {
  const title = `[${payload.session}] ${payload.group} 감지`;
  const message = `${payload.keyword} — ${payload.text}`.slice(0, 200);
  await showToast(title, message);
}

/**
 * 테스트 알림. 실제 키워드가 걸릴 때까지 기다리지 않고 확인할 수 있어야
 * 한다 — 메일 테스트와 같은 이유다.
 * @returns {Promise<{method: string}>}
 */
async function sendTest() {
  const method = await showToast(
    '[국캐치] 알림 테스트',
    '키워드가 감지되면 이런 알림이 뜹니다.',
  );
  return { method };
}

function sendViaNodeNotifier(title, message) {
  if (!notifier) return Promise.reject(new Error('node-notifier 미설치'));
  return new Promise((resolve, reject) => {
    notifier.notify({ title, message, sound: true }, (err) => (err ? reject(err) : resolve()));
  });
}

function sendViaPowerShellToast(title, message) {
  const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] > $null
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $template.GetElementsByTagName("text")
$texts.Item(0).AppendChild($template.CreateTextNode($env:NATV_TOAST_TITLE)) > $null
$texts.Item(1).AppendChild($template.CreateTextNode($env:NATV_TOAST_MESSAGE)) > $null
$toast = [Windows.UI.Notifications.ToastNotification]::new($template)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("국캐치").Show($toast)
`.trim();

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        env: { ...process.env, NATV_TOAST_TITLE: title, NATV_TOAST_MESSAGE: message },
        timeout: 10_000,
      },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

function sendViaMsgExe(message, title) {
  return new Promise((resolve, reject) => {
    execFile(
      'msg.exe',
      ['*', '/TIME:15', `${title}\n${message}`],
      { timeout: 10_000 },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

// alerting: 사용자를 방해하는 채널. 그룹이 '알림x'면 건너뛴다.
module.exports = { name: 'toast', alerting: true, send, sendTest };
