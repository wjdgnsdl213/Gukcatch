/**
 * SMTP 메일 알림. high priority 그룹만 발송한다 — 그 외까지 메일로 보내면
 * 회의 내내 메일함이 폭주한다.
 *
 * 미설정(SMTP_HOST/MAIL_TO 없음, 또는 nodemailer 미설치)이면 조용히 skip.
 */

let nodemailer = null;
try {
  // eslint-disable-next-line global-require
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null;
}

let cachedTransporter = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  if (!nodemailer) return null;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST) return null;

  cachedTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  return cachedTransporter;
}

async function send(payload) {
  if (payload.priority !== 'high') return;

  const to = process.env.MAIL_TO;
  if (!to) return;

  const transporter = getTransporter();
  if (!transporter) return;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: `[국캐치] ${payload.session} - ${payload.group}`,
    text: buildText(payload),
    attachments: payload.screenshotPath ? [{ path: payload.screenshotPath }] : undefined,
  });
}

function buildText(payload) {
  return [
    `키워드: ${payload.keyword} (${payload.group}, 담당: ${payload.dept || '미지정'})`,
    `상임위: ${payload.session}`,
    `영상 시점: ${payload.videoTimeFormatted}`,
    '',
    '문맥:',
    ...(payload.contextBefore || []),
    `▶ ${payload.text}`,
    ...(payload.contextAfter || []),
  ].join('\n');
}

module.exports = { name: 'mail', send };
