/**
 * AI 기능(서버 함수) 호출이 실패했을 때 사용자에게 보여줄 쉬운 안내 문구.
 * - 서버가 "AI 키 미설정(CONFIG_ERROR)"이라고 알려 주면 그대로 안내하고,
 * - 서버가 직접 알려 준 4xx 안내(권한 없음 등)는 그대로 보여주고,
 * - 그 밖의 서버 내부 오류(500대)나 연결 실패는 "AI 키 미설정 또는 일시적 문제" 안내로 바꾼다.
 */
export const AI_UNAVAILABLE_MESSAGE =
  'AI 기능을 지금 사용할 수 없습니다. 내 AI 키가 등록되지 않았거나 일시적인 문제일 수 있어요. 환경설정에서 키를 확인해 주세요.';
export const AI_KEY_MISSING_MESSAGE =
  '개인 AI 키가 아직 등록되지 않았습니다. 환경설정의 AI 서비스 설정에서 내 AI 키를 등록해 주세요.';

export async function friendlyAiError(error: unknown): Promise<string> {
  const ctx = (error as any)?.context;
  if (ctx && typeof ctx.status === 'number') {
    let body: any = null;
    try {
      body = await (ctx as Response).clone().json();
    } catch {
      /* 본문을 읽지 못하면 아래 기본 안내 */
    }
    if (body?.code === 'CONFIG_ERROR') return AI_KEY_MISSING_MESSAGE;
    if (body?.code === 'AI_KEY_INVALID' && typeof body?.error === 'string') return body.error;
    if (ctx.status >= 400 && ctx.status < 500 && typeof body?.error === 'string' && body.error.trim()) {
      return body.error;
    }
  }
  return AI_UNAVAILABLE_MESSAGE;
}
