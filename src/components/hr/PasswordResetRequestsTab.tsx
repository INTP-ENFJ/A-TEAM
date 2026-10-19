import React, { useState, useEffect } from 'react';
import { 
  KeyRound, 
  CheckCircle2, 
  Clock, 
  Loader2, 
  RefreshCw, 
  AlertCircle,
  Building2,
  Mail,
  Search,
  PhoneCall,
  Check
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PasswordResetRequest } from '../../types';
import { TempPasswordDialog } from './TempPasswordDialog';

interface PasswordResetRequestsTabProps {
  onShowToast: (msg: string) => void;
  onRequestCountChange?: (count: number) => void;
}

export const PasswordResetRequestsTab: React.FC<PasswordResetRequestsTabProps> = ({ 
  onShowToast,
  onRequestCountChange 
}) => {
  const [requests, setRequests] = useState<PasswordResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'resolved'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 처리 완료 확인 모달
  const [resolvingItem, setResolvingItem] = useState<PasswordResetRequest | null>(null);
  const [resolveNote, setResolveNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 임시 비밀번호 발급 결과 (닫으면 다시 볼 수 없음)
  const [issued, setIssued] = useState<{ name: string; email: string; password: string } | null>(null);

  // 목록 로드
  const loadRequests = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: reqErr } = await supabase
        .from('password_reset_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (reqErr) throw reqErr;

      const mapped: PasswordResetRequest[] = (data || []).map((r: any) => ({
        id: r.id,
        name: r.name,
        loginId: r.login_id,
        companyEmail: r.company_email,
        recoveryEmail: r.recovery_email,
        registeredRecoveryEmail: r.registered_recovery_email,
        department: r.department,
        status: r.status,
        resolvedBy: r.resolved_by,
        resolvedAt: r.resolved_at,
        adminNotes: r.admin_notes,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));

      setRequests(mapped);

      const pendingCount = mapped.filter(r => r.status === 'pending').length;
      if (onRequestCountChange) {
        onRequestCountChange(pendingCount);
      }
    } catch (err: any) {
      console.error('Failed to load password reset requests:', err);
      setError('비밀번호 분실 신고 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, []);

  // 임시 비밀번호 발급 (인사부 관리자만 가능, 서버 함수가 권한을 다시 확인)
  const handleIssueTempPassword = async (item: PasswordResetRequest) => {
    if (!window.confirm(`${item.name} 님의 본인 확인을 마치셨나요?\n새 임시 비밀번호를 발급하면 기존 비밀번호는 즉시 사용할 수 없게 됩니다.`)) return;
    setProcessingId(item.id);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('hr-reset-password', {
        body: { requestId: item.id },
      });
      if (fnErr) {
        let msg = fnErr.message;
        try {
          const ctx = (fnErr as any).context;
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json();
            if (body?.error) msg = body.error;
          }
        } catch { /* 본문을 읽지 못하면 기본 메시지 사용 */ }
        throw new Error(msg);
      }
      if (!data?.temporaryPassword) throw new Error('임시 비밀번호를 받지 못했습니다.');

      // 발급 기록을 남기고 신고를 처리 완료로 바꾼다 (비밀번호 자체는 저장하지 않음)
      const note = '임시 비밀번호 발급 후 직접 전달';
      const { error: rpcErr } = await supabase.rpc('resolve_password_reset_request', {
        p_request_id: item.id,
        p_notes: note,
      });
      if (rpcErr) {
        await supabase
          .from('password_reset_requests')
          .update({ status: 'resolved', resolved_at: new Date().toISOString(), admin_notes: note })
          .eq('id', item.id);
      }

      setIssued({ name: data.name || item.name, email: data.email || item.companyEmail || item.loginId, password: data.temporaryPassword });
      await loadRequests();
    } catch (err: any) {
      console.error('Failed to issue temp password:', err?.message);
      alert('임시 비밀번호를 발급하지 못했습니다: ' + (err?.message || '잠시 후 다시 시도해 주세요.'));
    } finally {
      setProcessingId(null);
    }
  };

  // 처리 완료 실행
  const handleResolveSubmit = async () => {
    if (!resolvingItem) return;
    setIsSubmitting(true);
    try {
      const { error: rpcErr } = await supabase.rpc('resolve_password_reset_request', {
        p_request_id: resolvingItem.id,
        p_notes: resolveNote.trim() || '인사부에서 직접 본인 확인 후 조치 완료',
      });

      if (rpcErr) {
        // RPC 실패 시 직접 UPDATE 시도 (RLS 정책 적용됨)
        const { error: updateErr } = await supabase
          .from('password_reset_requests')
          .update({
            status: 'resolved',
            resolved_at: new Date().toISOString(),
            admin_notes: resolveNote.trim() || '인사부에서 직접 본인 확인 후 조치 완료',
          })
          .eq('id', resolvingItem.id);

        if (updateErr) throw updateErr;
      }

      onShowToast(`${resolvingItem.name} 님의 분실 신고를 처리 완료로 표시했습니다.`);
      setResolvingItem(null);
      setResolveNote('');
      await loadRequests();
    } catch (err: any) {
      console.error('Failed to resolve request:', err);
      alert('처리 상태 변경 중 오류가 발생했습니다: ' + (err.message || '다시 시도해주세요.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // 필터링된 데이터
  const filteredRequests = requests.filter(item => {
    if (filterStatus === 'pending' && item.status !== 'pending') return false;
    if (filterStatus === 'resolved' && item.status !== 'resolved') return false;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchName = item.name.toLowerCase().includes(query);
      const matchId = item.loginId.toLowerCase().includes(query);
      const matchDept = (item.department || '').toLowerCase().includes(query);
      const matchEmail = (item.recoveryEmail || item.registeredRecoveryEmail || '').toLowerCase().includes(query);
      return matchName || matchId || matchDept || matchEmail;
    }

    return true;
  });

  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const resolvedCount = requests.filter(r => r.status === 'resolved').length;

  return (
    <div className="space-y-6">
      {/* 1. 상단 안내 헤더 */}
      <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3 mb-2">
            <div className="p-2.5 bg-amber-950/70 border border-amber-800/80 rounded-lg text-amber-400">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
                <span>비밀번호 분실 신고 관리</span>
                {pendingCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-950 text-amber-300 border border-amber-700">
                    처리 대기 {pendingCount}건
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                직원이 로그인 화면에서 접수한 분실 신고 내역입니다. 본인 확인 후 [임시 비밀번호 발급]을 누르면 새 비밀번호가 화면에 한 번만 나옵니다. 직원에게 직접 전달해 주세요. (자동 메일은 가지 않습니다)
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2 self-start md:self-auto">
          <button
            type="button"
            onClick={loadRequests}
            disabled={loading}
            className="flex items-center space-x-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            title="새로고침"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>새로고침</span>
          </button>
        </div>
      </div>

      {/* 2. 검색 및 필터 바 */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        {/* 상태 필터 버튼 */}
        <div className="inline-flex rounded-lg bg-slate-950 p-1 border border-slate-800 text-xs font-medium">
          <button
            type="button"
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
              filterStatus === 'all'
                ? 'bg-blue-600 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            전체 ({requests.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('pending')}
            className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
              filterStatus === 'pending'
                ? 'bg-amber-600 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            처리 대기 ({pendingCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('resolved')}
            className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
              filterStatus === 'resolved'
                ? 'bg-emerald-600 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            처리 완료 ({resolvedCount})
          </button>
        </div>

        {/* 검색창 */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="이름, 아이디, 부서 검색..."
            className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* 3. 에러 알림 */}
      {error && (
        <div className="p-4 bg-rose-950/40 border border-rose-800/80 rounded-lg text-rose-300 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 4. 분실 신고 목록 테이블 */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-3 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
            <span className="text-xs">신고 목록을 불러오는 중입니다...</span>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-2 text-slate-400">
            <Clock className="w-8 h-8 text-slate-600" />
            <p className="text-sm font-semibold text-slate-300">신고 내역이 없습니다</p>
            <p className="text-xs text-slate-500">
              {filterStatus === 'pending'
                ? '현재 대기 중인 비밀번호 분실 신고가 없습니다.'
                : '조건에 해당하는 분실 신고 내역이 없습니다.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900/80 border-b border-slate-800 text-slate-400 font-semibold select-none">
                  <th className="py-3 px-4">신고 직원 (이름 / 아이디)</th>
                  <th className="py-3 px-4">부서</th>
                  <th className="py-3 px-4">복구용 연락처 (이메일)</th>
                  <th className="py-3 px-4">신고한 시간</th>
                  <th className="py-3 px-4 text-center">상태</th>
                  <th className="py-3 px-4 text-right">인사부 조치</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredRequests.map((item) => {
                  // 복구용 이메일 판별: 사용자가 입력한 recoveryEmail 혹은 프로필에 등록되어 있던 registeredRecoveryEmail
                  const effectiveEmail = item.recoveryEmail || item.registeredRecoveryEmail;
                  const hasEmail = Boolean(effectiveEmail && effectiveEmail.trim());

                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors ${
                        item.status === 'pending'
                          ? 'bg-slate-950 hover:bg-slate-900/60'
                          : 'bg-slate-950/40 hover:bg-slate-900/40 text-slate-400'
                      }`}
                    >
                      {/* 1. 직원 이름 / 아이디 */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-100 flex items-center space-x-1.5">
                          <span>{item.name}</span>
                        </div>
                        <div className="text-[12px] text-slate-400 font-mono mt-0.5">
                          {item.loginId}
                          {item.companyEmail && (
                            <span className="text-slate-500 text-[12px] ml-1">({item.companyEmail})</span>
                          )}
                        </div>
                      </td>

                      {/* 2. 부서 */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center space-x-1.5">
                          <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="text-slate-200 font-medium">
                            {item.department || '부서 미지정'}
                          </span>
                        </div>
                      </td>

                      {/* 3. 복구용 이메일 (요구사항 4번: 없으면 "복구 이메일 없음, 직접 확인 필요" 표시) */}
                      <td className="py-3.5 px-4">
                        {hasEmail ? (
                          <div className="flex items-center space-x-1.5 text-slate-200">
                            <Mail className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                            <span className="font-mono text-[12px]">{effectiveEmail}</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-amber-950/70 text-amber-300 border border-amber-800 text-[12px] font-semibold">
                            <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
                            <span>복구 이메일 없음, 직접 확인 필요</span>
                          </div>
                        )}
                      </td>

                      {/* 4. 신고 일시 */}
                      <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap">
                        <div className="flex items-center space-x-1">
                          <Clock className="w-3 h-3 text-slate-500" />
                          <span>
                            {new Date(item.createdAt).toLocaleString('ko-KR', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </td>

                      {/* 5. 상태 뱃지 */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        {item.status === 'pending' ? (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[12px] font-medium bg-amber-950 text-amber-300 border border-amber-800">
                            <Clock className="w-3 h-3" />
                            <span>처리 대기</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[12px] font-medium bg-emerald-950 text-emerald-300 border border-emerald-800">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>처리 완료</span>
                          </span>
                        )}
                      </td>

                      {/* 6. 인사부 조치 액션 버튼 */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        {item.status === 'pending' ? (
                          <div className="inline-flex items-center space-x-2">
                            <button
                              type="button"
                              onClick={() => handleIssueTempPassword(item)}
                              disabled={processingId === item.id}
                              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {processingId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                              <span>임시 비밀번호 발급</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setResolvingItem(item);
                                setResolveNote('');
                              }}
                              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-semibold shadow transition-colors cursor-pointer"
                              title="다른 방법으로 이미 해결했을 때"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>처리 완료</span>
                            </button>
                          </div>
                        ) : (
                          <div className="text-right">
                            <span className="text-[12px] text-slate-400 block">
                              완료일: {item.resolvedAt ? new Date(item.resolvedAt).toLocaleDateString('ko-KR') : '-'}
                            </span>
                            {item.adminNotes && (
                              <span className="text-[12px] text-slate-500 block truncate max-w-xs" title={item.adminNotes}>
                                {item.adminNotes}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {issued && (
        <TempPasswordDialog
          title="임시 비밀번호 발급 완료"
          name={issued.name}
          email={issued.email}
          password={issued.password}
          onClose={() => setIssued(null)}
        />
      )}

      {/* 5. 처리 완료 확인 모달 */}
      {resolvingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-center space-x-3 text-blue-400">
              <PhoneCall className="w-6 h-6" />
              <h3 className="text-base font-bold text-slate-100">비밀번호 분실 신고 처리 완료</h3>
            </div>

            <div className="p-3.5 bg-slate-950 rounded-lg border border-slate-800 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">신고 직원:</span>
                <span className="font-semibold text-slate-200">{resolvingItem.name} ({resolvingItem.loginId})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">소속 부서:</span>
                <span className="text-slate-200">{resolvingItem.department || '부서 미지정'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">복구 이메일:</span>
                <span className="font-mono text-slate-200">
                  {resolvingItem.recoveryEmail || resolvingItem.registeredRecoveryEmail || (
                    <span className="text-amber-400 font-sans font-semibold">복구 이메일 없음 (직접 대면/유선 확인)</span>
                  )}
                </span>
              </div>
            </div>

            <div className="text-xs text-amber-300 bg-amber-950/40 p-3 rounded-lg border border-amber-800/80 leading-relaxed">
              <strong>안내:</strong> 시스템이 사용자에게 메일을 자동으로 발송하지 않습니다. 인사부에서 본인 확인 후 전화나 메일로 직접 안내하셨는지 확인해 주세요.
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                처리 메모 (선택 입력)
              </label>
              <input
                type="text"
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                placeholder="예: 전화로 본인 확인 및 비밀번호 재설정 링크 구두 안내"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setResolvingItem(null)}
                disabled={isSubmitting}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleResolveSubmit}
                disabled={isSubmitting}
                className="flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>저장 중...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>처리 완료로 변경</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
