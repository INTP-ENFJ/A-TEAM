import React, { useState } from 'react';
import { 
  Newspaper, 
  Lock, 
  ArrowRight, 
  AlertCircle, 
  Loader2, 
  User as UserIcon, 
  Building2, 
  Camera, 
  CheckCircle2, 
  ArrowLeft,
  KeyRound,
  Mail
} from 'lucide-react';
import { User, Department } from '../../types';
import { supabase } from '../../lib/supabase';
import { 
  COMPANY_EMAIL_SUFFIX, 
  validateAndNormalizeLoginId, 
  buildCompanyEmail 
} from '../../config/company';

interface LoginViewProps {
  onLoginSuccess?: (user: User) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  // 화면 모드: 'login' | 'signup' | 'success' | 'password_reset' | 'reset_success'
  const [viewMode, setViewMode] = useState<'login' | 'signup' | 'success' | 'password_reset' | 'reset_success'>('login');

  // --- 로그인 상태 ---
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // --- 비밀번호 분실 신고 상태 ---
  const [resetName, setResetName] = useState('');
  const [resetId, setResetId] = useState('');
  const [resetRecoveryEmail, setResetRecoveryEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // --- 회원가입 신청 상태 ---
  const [signupName, setSignupName] = useState('');
  const [signupDepartmentId, setSignupDepartmentId] = useState('');
  const [signupDepartmentName, setSignupDepartmentName] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isDeptLoading, setIsDeptLoading] = useState(false);
  const [signupId, setSignupId] = useState('');
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [photoNotice, setPhotoNotice] = useState(false);

  // 부서 목록 로드 (활성화된 부서만 조회)
  React.useEffect(() => {
    const fetchDepartments = async () => {
      setIsDeptLoading(true);
      try {
        const { data, error } = await supabase
          .from('departments')
          .select('id, name, parent_id, sort_order, is_active')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true });

        if (!error && data) {
          setDepartments(data.map(d => ({
            id: d.id,
            name: d.name,
            parentId: d.parent_id,
            sortOrder: d.sort_order,
            isActive: d.is_active,
          })));
        }
      } catch (err) {
        console.error('Failed to fetch departments:', err);
      } finally {
        setIsDeptLoading(false);
      }
    };

    fetchDepartments();
  }, []);

  // 입력값 초기화 헬퍼
  const resetSignupForm = () => {
    setSignupName('');
    setSignupDepartmentId('');
    setSignupDepartmentName('');
    setSignupId('');
    setSignupError(null);
    setPhotoNotice(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // 1. 아이디 입력값 유효성 검사 (공백, @, 특수문자, local-part 형식)
    const idValidation = validateAndNormalizeLoginId(loginId);
    if (!idValidation.isValid) {
      setErrorMessage(idValidation.errorMessage || '아이디를 올바르게 입력해주세요.');
      return;
    }

    if (!password) {
      setErrorMessage('비밀번호를 입력해주세요.');
      return;
    }

    // 2. 회사 이메일 주소 합성 (예: shinjw -> shinjw@pressdesk.co.kr)
    const fullEmail = buildCompanyEmail(idValidation.normalizedId);

    setLoading(true);
    try {
      // 1. Supabase Auth 이메일/비밀번호 로그인 API 호출
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: fullEmail,
        password,
      });

      if (authError || !authData.user) {
        const raw = authError?.message || '';
        setErrorMessage(
          /banned/i.test(raw)
            ? '비활성화된 계정입니다. 인사부에 문의해 주세요.'
            : raw || '로그인에 실패했습니다.'
        );
        return;
      }

      // 2. public.profiles 테이블에서 해당 사용자 프로필 조회
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, name, role, rank, role_title, department, avatar_url, recovery_email')
        .eq('id', authData.user.id)
        .single();

      if (profileError || !profile) {
        console.error('Profile fetch error:', profileError);
        setErrorMessage('사용자 프로필 정보를 불러오지 못했습니다.');
        return;
      }

      // 3. 조회된 profile과 Auth 정보를 기존 User 타입으로 명시적 매핑
      const mappedUser: User = {
        id: profile.id,
        name: profile.name,
        role: profile.role,
        rank: profile.rank,
        roleTitle: profile.role_title || '',
        department: profile.department || '',
        email: authData.user.email || '',
        avatar: profile.avatar_url || '',
        recoveryEmail: (profile as any).recovery_email || '',
      };

      // 4. 프로필 조회 성공 시 메인 화면 진입 콜백 호출 (App.tsx의 setCurrentUser 실행)
      if (onLoginSuccess) {
        onLoginSuccess(mappedUser);
      }
    } catch (err: any) {
      setErrorMessage(err.message || '로그인 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 회원가입 신청 제출 핸들러 (auth.signUp 미사용, signup_requests에만 anon INSERT)
  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupError(null);

    const trimmedName = signupName.trim();

    // 1. 유효성 검사
    if (!trimmedName) {
      setSignupError('이름을 입력해주세요.');
      return;
    }
    if (!signupDepartmentId || !signupDepartmentName) {
      setSignupError('소속 부서를 선택해주세요.');
      return;
    }

    const idValidation = validateAndNormalizeLoginId(signupId);
    if (!idValidation.isValid) {
      setSignupError(idValidation.errorMessage || '사내 아이디를 올바르게 입력해주세요.');
      return;
    }

    // 사내 이메일 주소 합성 (예: honggd -> honggd@pressdesk.co.kr)
    const fullEmail = buildCompanyEmail(idValidation.normalizedId);

    setSignupLoading(true);
    try {
      // 2. public.signup_requests INSERT (photo_url은 항상 null, department와 department_id 동시 전달)
      const { error: insertError } = await supabase
        .from('signup_requests')
        .insert({
          name: trimmedName,
          department: signupDepartmentName,
          department_id: signupDepartmentId,
          email: fullEmail,
          photo_url: null,
          status: 'pending',
          reviewed_by: null,
          reviewed_at: null,
        });

      if (insertError) {
        // Postgres UNIQUE 제약 위반(23505) 식별 (안정적인 code 값으로만 판별)
        if (insertError.code === '23505') {
          setSignupError('이미 가입 신청이 접수된 이메일입니다.');
        } else {
          console.error('Signup request insert error:', insertError);
          setSignupError('가입 신청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
        }
        return;
      }

      // 3. 성공 시 완료 화면으로 전환
      resetSignupForm();
      setViewMode('success');
    } catch (err) {
      console.error('Unexpected signup error:', err);
      setSignupError('가입 신청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setSignupLoading(false);
    }
  };

  // 비밀번호 분실 신고 제출 핸들러 (인사부 수동 처리 접수)
  const handlePasswordResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError(null);

    const trimmedName = resetName.trim();
    if (!trimmedName) {
      setResetError('성명을 입력해주세요.');
      return;
    }

    const idValidation = validateAndNormalizeLoginId(resetId);
    if (!idValidation.isValid) {
      setResetError(idValidation.errorMessage || '사내 아이디를 올바르게 입력해주세요.');
      return;
    }

    setResetLoading(true);
    try {
      const { data, error } = await supabase.rpc('submit_password_reset_request', {
        p_name: trimmedName,
        p_login_id: idValidation.normalizedId,
        p_recovery_email: resetRecoveryEmail.trim() || null,
      });

      if (error) {
        console.error('[LoginView.handlePasswordResetSubmit] Error:', error);
        setResetError(error.message || '분실 신고 접수 중 오류가 발생했습니다.');
        return;
      }

      setViewMode('reset_success');
      setResetName('');
      setResetId('');
      setResetRecoveryEmail('');
    } catch (err: any) {
      setResetError(err.message || '분실 신고 처리 중 오류가 발생했습니다.');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4 select-none">
      {/* Container */}
      <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Brand Header */}
        <div className="p-6 bg-slate-950 border-b border-slate-700/80 text-center">
          <div className="w-12 h-12 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-md mx-auto mb-3">
            <Newspaper className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold text-white tracking-tight">
            PRESS-CMS NEWSROOM WORKSPACE
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {viewMode === 'signup' 
              ? '기자·데스크 워크스페이스 신규 가입 신청' 
              : viewMode === 'success'
              ? '가입 신청서 접수 완료'
              : viewMode === 'password_reset'
              ? '비밀번호 분실 신고 (인사부 확인 접수)'
              : viewMode === 'reset_success'
              ? '분실 신고 접수 완료'
              : '언론사 내부 기사 편집 및 기사 출고 시스템 (통합 데스크탑 CMS)'}
          </p>
        </div>

        {/* 1. 로그인 화면 */}
        {viewMode === 'login' && (
          <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
            {/* Error Message Alert Banner */}
            {errorMessage && (
              <div 
                id="login-error-banner"
                className="p-3 bg-rose-950/50 border border-rose-800 text-rose-300 rounded-lg text-xs flex items-center space-x-2 animate-in fade-in duration-150"
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div>
              <label className="block text-slate-300 font-semibold mb-1">사내 아이디</label>
              <div className="flex rounded-md shadow-sm">
                <div className="relative flex-1">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-login-id"
                    type="text"
                    value={loginId}
                    onChange={(e) => {
                      const val = e.target.value.replace(/@pressdesk\.co\.kr$/i, '').trim();
                      setLoginId(val);
                    }}
                    placeholder="아이디 입력 (예: shinjw)"
                    disabled={loading}
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-r-0 border-slate-700 rounded-l text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 font-mono"
                  />
                </div>
                <div className="inline-flex items-center px-3 bg-slate-800 border border-slate-700 rounded-r text-slate-400 text-xs font-semibold select-none">
                  {COMPANY_EMAIL_SUFFIX}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">사내 인증 비밀번호</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="input-login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호를 입력하세요"
                  disabled={loading}
                  className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  id="btn-switch-to-forgot-password"
                  onClick={() => {
                    setErrorMessage(null);
                    setResetError(null);
                    setViewMode('password_reset');
                  }}
                  className="text-[11px] text-blue-400 hover:text-blue-300 font-medium transition-colors cursor-pointer"
                >
                  비밀번호를 잃어버렸어요
                </button>
              </div>
            </div>

            <button
              type="submit"
              id="btn-login-submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/60 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-lg font-bold shadow-md flex items-center justify-center space-x-2 transition-colors mt-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>로그인 중...</span>
                </>
              ) : (
                <>
                  <span>워크스페이스 입장</span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </>
              )}
            </button>

            {/* 회원가입 신청 진입 링크 */}
            <div className="pt-2 text-center border-t border-slate-700/60 mt-4">
              <span className="text-slate-400 text-xs">계정이 없으신가요? </span>
              <button
                type="button"
                id="btn-switch-to-signup"
                onClick={() => {
                  setErrorMessage(null);
                  resetSignupForm();
                  setViewMode('signup');
                }}
                className="text-blue-400 hover:text-blue-300 font-semibold underline underline-offset-2 ml-1 cursor-pointer transition-colors"
              >
                회원가입 신청
              </button>
            </div>
          </form>
        )}

        {/* 2. 회원가입 신청 화면 */}
        {viewMode === 'signup' && (
          <form onSubmit={handleSignupSubmit} className="p-6 space-y-3.5 text-xs">
            {signupError && (
              <div 
                id="signup-error-banner"
                className="p-3 bg-rose-950/50 border border-rose-800 text-rose-300 rounded-lg text-xs flex items-center space-x-2 animate-in fade-in duration-150"
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{signupError}</span>
              </div>
            )}

            {/* 사진 영역 UI (안내 전용, photo_url은 null로 저장) */}
            <div className="flex flex-col items-center justify-center pb-1">
              <div 
                onClick={() => setPhotoNotice(true)}
                className="w-16 h-16 rounded-full bg-slate-900 border-2 border-dashed border-slate-600 hover:border-blue-400 flex flex-col items-center justify-center text-slate-400 hover:text-blue-400 transition-colors cursor-pointer group"
                title="프로필 사진 (안내)"
              >
                <Camera className="w-5 h-5 mb-0.5 group-hover:scale-110 transition-transform" />
                <span className="text-[10px]">사진 등록</span>
              </div>
              {photoNotice && (
                <p className="text-[11px] text-blue-400 mt-1.5 animate-in fade-in">
                  프로필 사진 업로드는 다음 단계에서 연결됩니다.
                </p>
              )}
            </div>

            {/* 이름 입력 */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">성명 (이름) <span className="text-rose-400">*</span></label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="input-signup-name"
                  type="text"
                  value={signupName}
                  onChange={(e) => setSignupName(e.target.value)}
                  placeholder="예: 홍길동"
                  disabled={signupLoading}
                  className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
            </div>

            {/* 부서 선택 (계층형 드롭다운) */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                소속 부서 <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  id="select-signup-department"
                  value={signupDepartmentId}
                  onChange={(e) => {
                    const selectedId = e.target.value;
                    setSignupDepartmentId(selectedId);
                    const found = departments.find(d => d.id === selectedId);
                    setSignupDepartmentName(found ? found.name : '');
                  }}
                  disabled={signupLoading || isDeptLoading}
                  className="w-full pl-9 pr-8 py-2 bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 appearance-none cursor-pointer"
                >
                  <option value="">
                    {isDeptLoading ? '부서 목록을 불러오는 중...' : '-- 소속 부서를 선택하세요 --'}
                  </option>
                  {/* 계층형 정렬 렌더링: 1차 본부/국 아래 2차 부서 */}
                  {departments
                    .filter(d => !d.parentId)
                    .map(parent => {
                      const children = departments.filter(c => c.parentId === parent.id);
                      return (
                        <React.Fragment key={parent.id}>
                          <option value={parent.id} className="font-bold text-white bg-slate-800">
                            {parent.name}
                          </option>
                          {children.map(child => (
                            <option key={child.id} value={child.id} className="text-slate-200 pl-4">
                              &nbsp;&nbsp;↳ {child.name}
                            </option>
                          ))}
                        </React.Fragment>
                      );
                    })}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">
                  ▼
                </div>
              </div>
            </div>

            {/* 아이디 입력 */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                사내 아이디 <span className="text-rose-400">*</span>
              </label>
              <div className="flex rounded-md shadow-sm">
                <div className="relative flex-1">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-signup-id"
                    type="text"
                    value={signupId}
                    onChange={(e) => {
                      const val = e.target.value.replace(/@pressdesk\.co\.kr$/i, '').trim();
                      setSignupId(val);
                    }}
                    placeholder="아이디 입력 (예: honggd)"
                    disabled={signupLoading}
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-r-0 border-slate-700 rounded-l text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 font-mono"
                  />
                </div>
                <div className="inline-flex items-center px-3 bg-slate-800 border border-slate-700 rounded-r text-slate-400 text-xs font-semibold select-none">
                  {COMPANY_EMAIL_SUFFIX}
                </div>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 pt-1 leading-relaxed">
              ※ 직급 및 담당 역할은 가입 신청서 접수 후 인사부 승인 과정에서 공식 배정됩니다.
            </p>

            {/* 신청 버튼 */}
            <button
              type="submit"
              id="btn-signup-submit"
              disabled={signupLoading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/60 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-lg font-bold shadow-md flex items-center justify-center space-x-2 transition-colors mt-2 cursor-pointer whitespace-nowrap"
            >
              {signupLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>신청서 접수 중...</span>
                </>
              ) : (
                <>
                  <span>가입 신청서 제출</span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </>
              )}
            </button>

            {/* 로그인으로 돌아가기 */}
            <div className="pt-2 text-center border-t border-slate-700/60 mt-3">
              <button
                type="button"
                id="btn-back-to-login"
                onClick={() => {
                  setSignupError(null);
                  setViewMode('login');
                }}
                className="text-slate-400 hover:text-slate-200 inline-flex items-center text-xs font-semibold cursor-pointer transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                <span>로그인 화면으로 돌아가기</span>
              </button>
            </div>
          </form>
        )}

        {/* 3. 신청 완료 안내 화면 */}
        {viewMode === 'success' && (
          <div className="p-8 text-center space-y-4 animate-in fade-in duration-200">
            <div className="w-14 h-14 bg-emerald-950/80 border border-emerald-700 rounded-full flex items-center justify-center mx-auto text-emerald-400 shadow-lg">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <h2 className="text-base font-bold text-white mb-1.5">가입 신청이 접수되었습니다</h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                신청하신 정보는 인사부 검토 및 권한 배정 후 최종 승인됩니다.<br />
                승인 완료 시 등록하신 이메일로 비밀번호 설정 안내가 발송됩니다.
              </p>
            </div>

            <div className="pt-3">
              <button
                type="button"
                id="btn-success-to-login"
                onClick={() => {
                  setErrorMessage(null);
                  setViewMode('login');
                }}
                className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold text-xs transition-colors cursor-pointer"
              >
                로그인 화면으로 이동
              </button>
            </div>
          </div>
        )}

        {/* 4. 비밀번호 분실 신고 화면 */}
        {viewMode === 'password_reset' && (
          <form onSubmit={handlePasswordResetSubmit} className="p-6 space-y-4 text-xs">
            {/* 안내 배너 */}
            <div className="p-3 bg-blue-950/40 border border-blue-800/80 rounded-lg text-blue-200 text-xs space-y-1">
              <div className="flex items-center space-x-1.5 font-bold text-blue-300">
                <KeyRound className="w-4 h-4 text-blue-400 shrink-0" />
                <span>비밀번호 분실 신고 안내</span>
              </div>
              <p className="text-[11px] text-blue-200/90 leading-relaxed">
                비밀번호를 잃어버리셨나요? 본인 정보를 입력하여 신고해 주시면, 인사부 담당자가 직접 확인 후 사내 메신저, 전화 또는 복구용 이메일로 연락을 드립니다.
              </p>
            </div>

            {/* 에러 메시지 알림 */}
            {resetError && (
              <div 
                id="reset-error-banner"
                className="p-3 bg-rose-950/50 border border-rose-800 text-rose-300 rounded-lg text-xs flex items-center space-x-2 animate-in fade-in duration-150"
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{resetError}</span>
              </div>
            )}

            {/* 이름 입력 */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                성명 (이름) <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="input-reset-name"
                  type="text"
                  required
                  value={resetName}
                  onChange={(e) => setResetName(e.target.value)}
                  placeholder="예: 홍길동"
                  disabled={resetLoading}
                  className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
            </div>

            {/* 사내 아이디 입력 */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                사내 아이디 (사번) <span className="text-rose-400">*</span>
              </label>
              <div className="flex rounded-md shadow-sm">
                <div className="relative flex-1">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-reset-id"
                    type="text"
                    required
                    value={resetId}
                    onChange={(e) => {
                      const val = e.target.value.replace(/@pressdesk\.co\.kr$/i, '').trim();
                      setResetId(val);
                    }}
                    placeholder="아이디 입력 (예: shinjw)"
                    disabled={resetLoading}
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-r-0 border-slate-700 rounded-l text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 font-mono"
                  />
                </div>
                <div className="inline-flex items-center px-3 bg-slate-800 border border-slate-700 rounded-r text-slate-400 text-xs font-semibold select-none">
                  {COMPANY_EMAIL_SUFFIX}
                </div>
              </div>
            </div>

            {/* 등록된 복구용 이메일 입력 (선택 사항) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-slate-300 font-semibold">
                  등록된 복구용 개인 이메일
                </label>
                <span className="text-[10px] text-slate-400">선택 사항</span>
              </div>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="input-reset-recovery-email"
                  type="email"
                  value={resetRecoveryEmail}
                  onChange={(e) => setResetRecoveryEmail(e.target.value)}
                  placeholder="예: reporter@naver.com (등록한 경우 입력)"
                  disabled={resetLoading}
                  className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                ※ 프로필에 미리 등록해 둔 개인 이메일이 있다면 적어주세요. 등록하지 않았더라도 인사부가 직접 확인하여 연락드립니다.
              </p>
            </div>

            {/* 신고 접수 버튼 */}
            <button
              type="submit"
              id="btn-submit-password-reset"
              disabled={resetLoading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/60 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-lg font-bold shadow-md flex items-center justify-center space-x-2 transition-colors mt-2 cursor-pointer"
            >
              {resetLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>신고 접수 중...</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4 shrink-0" />
                  <span>인사부에 분실 신고 접수하기</span>
                </>
              )}
            </button>

            {/* 로그인으로 돌아가기 */}
            <div className="pt-2 text-center border-t border-slate-700/60 mt-3">
              <button
                type="button"
                id="btn-reset-back-to-login"
                onClick={() => {
                  setResetError(null);
                  setViewMode('login');
                }}
                className="text-slate-400 hover:text-slate-200 inline-flex items-center text-xs font-semibold cursor-pointer transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                <span>로그인 화면으로 돌아가기</span>
              </button>
            </div>
          </form>
        )}

        {/* 5. 분실 신고 접수 완료 안내 화면 */}
        {viewMode === 'reset_success' && (
          <div className="p-8 text-center space-y-4 animate-in fade-in duration-200">
            <div className="w-14 h-14 bg-emerald-950/80 border border-emerald-700 rounded-full flex items-center justify-center mx-auto text-emerald-400 shadow-lg">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <h2 className="text-base font-bold text-white mb-1.5">비밀번호 분실 신고가 접수되었습니다</h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                인사부 담당자가 확인한 후, 직접 연락(전화, 사내 메신저 또는 복구용 이메일)을 드려 비밀번호 재설정을 안내해 드립니다.<br />
                잠시만 기다려 주시기 바랍니다.
              </p>
            </div>

            <div className="pt-3">
              <button
                type="button"
                id="btn-reset-success-to-login"
                onClick={() => {
                  setErrorMessage(null);
                  setViewMode('login');
                }}
                className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold text-xs transition-colors cursor-pointer"
              >
                로그인 화면으로 돌아가기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
