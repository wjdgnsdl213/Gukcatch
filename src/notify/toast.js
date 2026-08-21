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

async function send(payload) {
  const title = `[${payload.session}] ${payload.group} 감지`;
  const message = `${payload.keyword} — ${payload.text}`.slice(0, 200);

  const attempts = [
    () => sendViaNodeNotifier(title, message),
    () => sendViaPowerShellToast(title, message),
    () => sendViaMsgExe(message, title),
  ];

  let lastErr = null;
  for (const attempt of attempts) {
    try {
      await attempt();
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('토스트 알림 3단 폴백 전부 실패');
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

module.exports = { name: 'toast', send };
