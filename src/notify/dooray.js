/**
 * Dooray 메신저 Incoming Webhook.
 *
 * ⚠️ TODO(검증 필요): NHN Cloud 공식 문서(docs.nhncloud.com/.../incoming-hook-guide)가
 * 접근 시 리다이렉트 오류를 반환해 정확한 페이로드 규격을 확인하지 못했다.
 * 아래는 Slack 호환 Incoming Webhook과 유사한 일반적인 형태(botName/text/
 * attachments)로 구현했다 — 실제 DOORAY_WEBHOOK_URL을 받으면 1회 테스트
 * 발송으로 검증하고, 필드명이 다르면 이 파일만 고치면 되도록 어댑터를
 * 얇게 유지했다.
 *
 * 미설정(DOORAY_WEBHOOK_URL 없음)이면 조용히 skip — 필수 채널이 아니다.
 */

async function send(payload) {
  const url = process.env.DOORAY_WEBHOOK_URL;
  if (!url) return;

  const body = {
    botName: '국캐치',
    text: `**[${payload.session}] ${payload.group} 감지** (담당: ${payload.dept || '미지정'})`,
    attachments: [
      {
        title: `키워드: ${payload.keyword} · 시점: ${payload.videoTimeFormatted}`,
        text: buildContextText(payload),
        color: payload.priority === 'high' ? '#e74c3c' : '#3498db',
      },
    ],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Dooray webhook HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }
}

function buildContextText(payload) {
  const lines = [
    ...(payload.contextBefore || []).map((t) => `　${t}`),
    `▶ ${payload.text}`,
    ...(payload.contextAfter || []).map((t) => `　${t}`),
  ];
  return lines.join('\n');
}

module.exports = { name: 'dooray', send };
