/**
 * SMTP 메일 알림.
 *
 * 발송 조건은 키워드 그룹의 `notify`다 — false면 실시간 알림을 보내지
 * 않는다(히트 기록과 보고서 키워드 필터에는 그대로 남는다).
 *
 * 수신자 우선순위: 그룹의 emails → config.json의 mailTo → 환경변수 MAIL_TO.
 * 그룹별 수신자를 두면 "이 키워드는 우리 부서만" 같은 라우팅이 된다.
 *
 * 비밀번호는 환경변수에만 둔다. config.json은 평문이고 저장소에 올라갈
 * 위험이 있어서, 주소·수신자는 설정 파일에서 관리하되 SMTP 인증 정보는
 * .env에 분리한다.
 *
 * 미설정(SMTP_HOST 없음, 수신자 없음, nodemailer 미설치)이면 조용히 skip.
 */

let nodemailer = null;
try {
  // eslint-disable-next-line global-require
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null;
}

let cachedTransporter = null;
let cachedKey = null;

/** 설정이 바뀌면(.env 수정 후 재시작 등) 트랜스포터를 다시 만든다. */
function transporterKey() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  return [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS].join('|');
}

function getTransporter() {
  if (!nodemailer) return null;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST) return null;

  const key = transporterKey();
  if (cachedTransporter && cachedKey === key) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  cachedKey = key;
  return cachedTransporter;
}

/** 쉼표/세미콜론/줄바꿈으로 구분된 주소 문자열 또는 배열을 배열로 */
function parseRecipients(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[,;\n]/);
  return list.map((s) => String(s).trim()).filter(Boolean);
}

/** 아주 느슨한 형태 검사 — 오타 하나로 전체 발송이 실패하는 것만 막는다. */
function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * 설정 상태를 돌려준다 (제어판 표시용).
 * 비밀번호 값 자체는 절대 내보내지 않고 설정 여부만 알린다.
 */
function mailStatus({ defaultTo } = {}) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, MAIL_TO } = process.env;
  const recipients = parseRecipients(defaultTo || MAIL_TO);
  return {
    installed: Boolean(nodemailer),
    host: SMTP_HOST || null,
    port: Number(SMTP_PORT || 587),
    user: SMTP_USER || null,
    hasPassword: Boolean(SMTP_PASS),
    from: SMTP_FROM || SMTP_USER || null,
    defaultRecipients: recipients,
    ready: Boolean(nodemailer && SMTP_HOST && recipients.length > 0),
  };
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

/**
 * @param {object} payload - hits.js가 만든 알림 페이로드
 * @param {object} [opts]
 * @param {string|string[]} [opts.defaultTo] - config.json의 기본 수신자
 */
async function send(payload, { defaultTo } = {}) {
  if (payload.notify === false) return;

  const groupTo = parseRecipients(payload.emails);
  const to = groupTo.length ? groupTo : parseRecipients(defaultTo || process.env.MAIL_TO);
  if (to.length === 0) return;

  const transporter = getTransporter();
  if (!transporter) return;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: to.join(', '),
    subject: `[국캐치] ${payload.session} — ${payload.group}`,
    text: buildText(payload),
    attachments: payload.screenshotPath ? [{ path: payload.screenshotPath }] : undefined,
  });
}

/**
 * 테스트 발송. 실제 키워드가 걸릴 때까지 기다리지 않고 SMTP 설정을
 * 확인할 수 있어야 한다 — 회의 중에 안 된다는 걸 알면 이미 늦는다.
 * @throws {Error} 사람이 읽을 수 있는 실패 사유
 */
async function sendTest({ to, defaultTo } = {}) {
  if (!nodemailer) throw new Error('nodemailer가 설치되어 있지 않습니다. npm install을 먼저 실행하세요.');
  if (!process.env.SMTP_HOST) throw new Error('SMTP_HOST가 설정되지 않았습니다. .env를 확인하세요.');

  const explicit = parseRecipients(to);
  const recipients = explicit.length ? explicit : parseRecipients(defaultTo || process.env.MAIL_TO);
  if (recipients.length === 0) throw new Error('수신자가 없습니다. 기본 수신자를 먼저 입력하세요.');

  const bad = recipients.filter((r) => !looksLikeEmail(r));
  if (bad.length) throw new Error(`이메일 형식이 아닙니다: ${bad.join(', ')}`);

  const transporter = getTransporter();
  // verify()가 인증·연결 문제를 sendMail보다 명확한 메시지로 알려준다.
  await transporter.verify();

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: recipients.join(', '),
    subject: '[국캐치] 테스트 메일',
    text: [
      '국캐치 알림 설정이 정상입니다.',
      '',
      '이 메일이 보이면 키워드가 감지될 때 같은 경로로 알림이 전송됩니다.',
      `발송 시각: ${new Date().toLocaleString('ko-KR')}`,
    ].join('\n'),
  });

  return { sent: recipients };
}

// alerting: 사용자를 방해하는 채널. 그룹이 '알림x'면 건너뛴다.
module.exports = { name: 'mail', alerting: true, send, sendTest, mailStatus, parseRecipients, looksLikeEmail };
