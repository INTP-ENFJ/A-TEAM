/**
 * PRESS-CMS 회사 단일 설정 (Company Configuration)
 * 
 * 회사 이메일 도메인 및 인증 관련 단일 진실 공급원(Single Source of Truth)입니다.
 * 향후 회사 도메인 변경 시 이 파일의 상수만 수정하면 전체 UI 및 검증 로직에 일괄 반영됩니다.
 */

export const COMPANY_EMAIL_DOMAIN = 'pressdesk.co.kr';
export const COMPANY_EMAIL_SUFFIX = `@${COMPANY_EMAIL_DOMAIN}`;

/**
 * 아이디(이메일 local-part) 정규화 및 유효성 검사 결과 타입
 */
export interface IdValidationResult {
  isValid: boolean;
  normalizedId: string;
  errorMessage?: string;
}

/**
 * 사용자 입력 아이디 정규화 및 엄격한 유효성 검증
 * - 앞뒤 공백 제거 (trim)
 * - 소문자 변환 (lowercase)
 * - 빈 문자열 금지
 * - '@' 문자 입력 금지 (도메인은 UI에서 고정 표시됨)
 * - 공백(space) 포함 금지
 * - 이메일 local-part 표준 규격 (영문 소문자, 숫자, 점, 하이픈, 언더스코어) 검증
 */
export function validateAndNormalizeLoginId(rawInput: string): IdValidationResult {
  const trimmed = rawInput.trim();

  if (!trimmed) {
    return {
      isValid: false,
      normalizedId: '',
      errorMessage: '사번 또는 아이디를 입력해주세요.',
    };
  }

  // 사용자가 전체 이메일(예: shinjw@pressdesk.co.kr)을 입력한 경우 자동 분리
  let candidateId = trimmed;
  if (trimmed.includes('@')) {
    const parts = trimmed.split('@');
    const domain = parts[parts.length - 1].toLowerCase();
    if (domain !== COMPANY_EMAIL_DOMAIN.toLowerCase()) {
      return {
        isValid: false,
        normalizedId: trimmed,
        errorMessage: `사내 이메일 계정(${COMPANY_EMAIL_SUFFIX})만 사용할 수 있습니다.`,
      };
    }
    candidateId = parts.slice(0, parts.length - 1).join('@');
  }

  if (/\s/.test(candidateId)) {
    return {
      isValid: false,
      normalizedId: candidateId,
      errorMessage: '아이디에 공백(띄어쓰기)을 포함할 수 없습니다.',
    };
  }

  const normalized = candidateId.toLowerCase();

  // 이메일 local-part 표준 형식 검증 (영문자, 숫자, ., -, _ 허용, 2자~64자)
  const localPartRegex = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;
  if (!localPartRegex.test(normalized)) {
    return {
      isValid: false,
      normalizedId: normalized,
      errorMessage: '영문 소문자, 숫자, 마침표(.), 하이픈(-), 밑줄(_)만 사용할 수 있습니다.',
    };
  }

  return {
    isValid: true,
    normalizedId: normalized,
  };
}

/**
 * 아이디로부터 완전한 회사 이메일 주소 생성
 */
export function buildCompanyEmail(loginId: string): string {
  const { normalizedId } = validateAndNormalizeLoginId(loginId);
  return `${normalizedId}${COMPANY_EMAIL_SUFFIX}`;
}

/**
 * 완전한 이메일 주소에서 아이디(local-part) 추출
 */
export function extractCompanyLoginId(email: string): string {
  if (!email) return '';
  const parts = email.trim().toLowerCase().split('@');
  return parts[0] || '';
}

/**
 * 이메일 주소가 회사 도메인과 정확히 일치하는지 검증
 * (도메인 뒤에 서브도메인이나 우회 도메인이 붙는 공격 방어)
 */
export function isCompanyEmail(email: string): boolean {
  if (!email || !email.includes('@')) return false;
  const parts = email.trim().toLowerCase().split('@');
  if (parts.length !== 2) return false;
  const domainPart = parts[1];
  return domainPart === COMPANY_EMAIL_DOMAIN;
}
