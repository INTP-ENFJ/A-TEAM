import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Loader2, 
  RefreshCw, 
  AlertCircle,
  Building2,
  Award,
  Shield,
  Briefcase
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { 
  Department, 
  PositionTitle, 
  SignupRequestItem, 
  UserRankCode, 
  UserRole,
  USER_RANK_LABELS 
} from '../../types';

interface SignupApprovalTabProps {
  onShowToast: (msg: string) => void;
}

export const SignupApprovalTab: React.FC<SignupApprovalTabProps> = ({ onShowToast }) => {
  const [requests, setRequests] = useState<SignupRequestItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positionTitles, setPositionTitles] = useState<PositionTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 승인 검토 모달 상태
  const [selectedRequest, setSelectedRequest] = useState<SignupRequestItem | null>(null);
  const [assignDeptId, setAssignDeptId] = useState<string>('');
  const [assignDeptName, setAssignDeptName] = useState<string>('');
  const [assignPosId, setAssignPosId] = useState<string>('');
  const [assignPosName, setAssignPosName] = useState<string>('');
  const [assignRank, setAssignRank] = useState<UserRankCode>('reporter');
  const [assignRole, setAssignRole] = useState<UserRole>('reporter');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 데이터 로드
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. 가입 신청서 목록 조회
      const { data: reqData, error: reqErr } = await supabase
        .from('signup_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (reqErr) throw reqErr;

      setRequests((reqData || []).map(r => ({
        id: r.id,
        name: r.name,
        department: r.department,
        departmentId: r.department_id,
        email: r.email,
        photoUrl: r.photo_url,
        status: r.status,
        reviewedBy: r.reviewed_by,
        reviewedAt: r.reviewed_at,
        createdAt: r.created_at,
        assignedRank: r.assigned_rank,
        assignedRole: r.assigned_role,
        assignedRoleTitle: r.assigned_role_title,
        assignedPositionTitleId: r.assigned_position_title_id,
        authUserId: r.auth_user_id,
      })));

      // 2. 부서 마스터 로드 (활성 부서)
      const { data: deptData } = await supabase
        .from('departments')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');

      setDepartments(deptData || []);

      // 3. 직책 마스터 로드 (활성 직책)
      const { data: posData } = await supabase
        .from('position_titles')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');

      setPositionTitles(posData || []);
    } catch (err: any) {
      console.error('Failed to load signup requests:', err);
      setError('가입 신청 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // 승인 검토 모달 열기
  const openApprovalModal = (req: SignupRequestItem) => {
    setSelectedRequest(req);
    // 기본 부서: 신청자가 선택한 부서 또는 기존 신청 부서 매핑
    const initialDeptId = req.departmentId || (departments.find(d => d.name === req.department)?.id || '');
    setAssignDeptId(initialDeptId);
    setAssignDeptName(departments.find(d => d.id === initialDeptId)?.name || req.department);

    // 기본 직책: 평기자 또는 첫 번째 항목
    const defaultPos = positionTitles.find(p => p.name === '평기자') || positionTitles[0];
    setAssignPosId(defaultPos?.id || '');
    setAssignPosName(defaultPos?.name || '평기자');

    setAssignRank('reporter');
    setAssignRole('reporter');
  };

  // 승인 실행 (1. DB 배정 정보 업데이트 ➔ 2. approve-signup Edge Function 호출)
  const handleApprove = async () => {
    if (!selectedRequest) return;
    if (!assignDeptId || !assignPosId) {
      onShowToast('소속 부서와 직책을 모두 선택해주세요.');
      return;
    }

    setIsSubmitting(true);
    setProcessingId(selectedRequest.id);

    try {
      // 1. 배정 정보(부서, 직책, rank, role)를 signup_requests에 먼저 저장
      const nowIso = new Date().toISOString();
      const { error: updateErr } = await supabase
        .from('signup_requests')
        .update({
          department_id: assignDeptId,
          department: assignDeptName,
          assigned_position_title_id: assignPosId,
          assigned_role_title: assignPosName,
          assigned_rank: assignRank,
          assigned_role: assignRole,
          updated_at: nowIso,
        })
        .eq('id', selectedRequest.id)
        .eq('status', 'pending');

      if (updateErr) {
        throw new Error('배정 정보 저장에 실패했습니다: ' + updateErr.message);
      }

      // 2. approve-signup Edge Function 호출
      const { data: funcData, error: funcErr } = await supabase.functions.invoke('approve-signup', {
        body: { signupRequestId: selectedRequest.id },
      });

      if (funcErr || funcData?.error) {
        throw new Error(funcData?.error || funcErr?.message || '승인 처리 함수 호출에 실패했습니다.');
      }

      onShowToast(`"${selectedRequest.name}" 님의 가입 신청이 승인되었으며 초대장이 발송되었습니다.`);
      setSelectedRequest(null);
      await loadData();
    } catch (err: any) {
      console.error('Approval failed:', err);
      onShowToast(err.message || '승인 처리 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
      setProcessingId(null);
    }
  };

  // 반려 처리
  const handleReject = async (req: SignupRequestItem) => {
    if (!confirm(`"${req.name}" 님의 가입 신청을 반려하시겠습니까?`)) return;

    setProcessingId(req.id);
    try {
      const nowIso = new Date().toISOString();
      const { error: rejectErr } = await supabase
        .from('signup_requests')
        .update({
          status: 'rejected',
          reviewed_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', req.id)
        .eq('status', 'pending');

      if (rejectErr) throw rejectErr;

      onShowToast(`"${req.name}" 님의 가입 신청이 반려 처리되었습니다.`);
      await loadData();
    } catch (err: any) {
      console.error('Rejection failed:', err);
      onShowToast('반려 처리에 실패했습니다: ' + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const pendingRequests = requests.filter(r => r.status === 'pending');
  const completedRequests = requests.filter(r => r.status !== 'pending');

  // 부서 계층 정렬 목록
  const orderedDepartments: Array<{ dept: Department; isChild: boolean }> = [];
  const roots = departments.filter(d => !d.parentId);
  roots.forEach(root => {
    orderedDepartments.push({ dept: root, isChild: false });
    departments.filter(d => d.parentId === root.id).forEach(child => {
      orderedDepartments.push({ dept: child, isChild: true });
    });
  });

  return (
    <div className="space-y-6">
      {/* 상단 탭 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white tracking-tight flex items-center space-x-2">
            <span>회원가입 승인 관리</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-semibold border border-blue-500/30">
              대기 {pendingRequests.length}건
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            신규 가입 신청서를 검토하고 공식 부서, 직책, 직급 및 권한을 배정하여 승인합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>새로고침</span>
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rose-950/60 border border-rose-800 text-rose-300 rounded text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* 1. 대기 중인 신청 목록 */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden shadow-lg">
        <div className="px-4 py-3 bg-slate-900/60 border-b border-slate-700 font-semibold text-xs text-slate-300 flex items-center justify-between">
          <span className="flex items-center space-x-1.5">
            <Clock className="w-4 h-4 text-amber-400" />
            <span>승인 대기 신청서</span>
          </span>
          <span className="text-slate-400 font-normal">총 {pendingRequests.length}건</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-400 text-xs flex items-center justify-center space-x-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
            <span>가입 신청 데이터를 불러오는 중...</span>
          </div>
        ) : pendingRequests.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            현재 대기 중인 가입 신청이 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/40 text-slate-400 font-semibold border-b border-slate-700">
                <tr>
                  <th className="py-2.5 px-4">성명 (이름)</th>
                  <th className="py-2.5 px-4">사내 이메일</th>
                  <th className="py-2.5 px-4">희망 소속 부서</th>
                  <th className="py-2.5 px-4">신청 일시</th>
                  <th className="py-2.5 px-4 text-right">검토 및 승인</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {pendingRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-700/40 transition-colors">
                    <td className="py-3 px-4 font-bold text-white">{req.name}</td>
                    <td className="py-3 px-4 text-slate-300 font-mono">{req.email}</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-700 text-slate-200 border border-slate-600 text-[11px] font-medium">
                        {req.department}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      {new Date(req.createdAt).toLocaleString('ko-KR', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <button
                        type="button"
                        id={`btn-approve-req-${req.id}`}
                        onClick={() => openApprovalModal(req)}
                        disabled={processingId === req.id}
                        className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded text-xs shadow-xs transition-colors cursor-pointer"
                      >
                        승인 및 권한 배정
                      </button>
                      <button
                        type="button"
                        id={`btn-reject-req-${req.id}`}
                        onClick={() => handleReject(req)}
                        disabled={processingId === req.id}
                        className="px-2.5 py-1.5 bg-slate-700 hover:bg-rose-900/60 text-slate-300 hover:text-rose-200 font-semibold rounded text-xs transition-colors cursor-pointer"
                      >
                        반려
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 2. 승인/반려 완료 내역 */}
      {completedRequests.length > 0 && (
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-900/50 border-b border-slate-700 text-xs font-semibold text-slate-400 flex items-center justify-between">
            <span>최근 처리 완료 내역</span>
            <span>{completedRequests.length}건</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-400">
              <thead className="bg-slate-900/30 text-slate-500 text-[11px] border-b border-slate-700/60">
                <tr>
                  <th className="py-2 px-4">성명</th>
                  <th className="py-2 px-4">이메일</th>
                  <th className="py-2 px-4">최종 배정 부서</th>
                  <th className="py-2 px-4">직책 / 직급</th>
                  <th className="py-2 px-4">상태</th>
                  <th className="py-2 px-4">처리 일시</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/40">
                {completedRequests.slice(0, 5).map((req) => (
                  <tr key={req.id}>
                    <td className="py-2 px-4 text-slate-300 font-medium">{req.name}</td>
                    <td className="py-2 px-4 font-mono">{req.email}</td>
                    <td className="py-2 px-4">{req.department}</td>
                    <td className="py-2 px-4">
                      {req.assignedRoleTitle ? `${req.assignedRoleTitle} (${USER_RANK_LABELS[req.assignedRank || 'reporter']})` : '-'}
                    </td>
                    <td className="py-2 px-4">
                      {req.status === 'approved' ? (
                        <span className="inline-flex items-center space-x-1 text-emerald-400 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>승인 완료</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 text-rose-400 font-semibold">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>반려</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-4">
                      {req.reviewedAt ? new Date(req.reviewedAt).toLocaleString('ko-KR') : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. 승인 및 권한 배정 모달 */}
      {selectedRequest && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden text-slate-200 text-xs">
            {/* Modal Header */}
            <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-sm">가입 승인 및 권한 배정</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  신청자: <strong className="text-white">{selectedRequest.name}</strong> ({selectedRequest.email})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRequest(null)}
                disabled={isSubmitting}
                className="text-slate-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4">
              {/* 소속 부서 선택 */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1 flex items-center space-x-1.5">
                  <Building2 className="w-3.5 h-3.5 text-blue-400" />
                  <span>최종 소속 부서 배정</span>
                </label>
                <select
                  id="select-assign-department"
                  value={assignDeptId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setAssignDeptId(id);
                    setAssignDeptName(departments.find(d => d.id === id)?.name || '');
                  }}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                >
                  <option value="">부서를 선택하세요</option>
                  {orderedDepartments.map(({ dept, isChild }) => (
                    <option key={dept.id} value={dept.id}>
                      {isChild ? `\u00A0\u00A0\u00A0\u00A0└ ${dept.name}` : dept.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 공식 직책 선택 (position_titles 마스터) */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1 flex items-center space-x-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-emerald-400" />
                  <span>공식 직책 배정 (사내 표시 직책)</span>
                </label>
                <select
                  id="select-assign-position"
                  value={assignPosId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setAssignPosId(id);
                    setAssignPosName(positionTitles.find(p => p.id === id)?.name || '');
                  }}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                >
                  <option value="">직책을 선택하세요</option>
                  {positionTitles.map((pos) => (
                    <option key={pos.id} value={pos.id}>
                      {pos.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 기자 직급 선택 (rank) */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5 flex items-center space-x-1.5">
                  <Award className="w-3.5 h-3.5 text-amber-400" />
                  <span>기자 직급 배정 (기사 최종 출고 권한 기준)</span>
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(['trainee', 'reporter', 'deputy', 'manager'] as UserRankCode[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setAssignRank(r)}
                      className={`py-2 px-2 rounded border text-center font-medium transition-colors cursor-pointer ${
                        assignRank === r
                          ? 'bg-blue-600 border-blue-500 text-white font-bold'
                          : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      <div>{USER_RANK_LABELS[r]}</div>
                      <div className="text-[10px] opacity-70">
                        {r === 'manager' ? '출고 권한' : '작성 권한'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* CMS 시스템 역할 (role) */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5 flex items-center space-x-1.5">
                  <Shield className="w-3.5 h-3.5 text-purple-400" />
                  <span>CMS 워크스페이스 역할</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: 'reporter', label: '취재기자', desc: '기사 작성' },
                    { key: 'desk_editor', label: '데스크 에디터', desc: '기사 감수/교열' },
                    { key: 'editor_in_chief', label: '편집국장', desc: '총괄 책임' },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setAssignRole(item.key as UserRole)}
                      className={`py-2 px-2 rounded border text-center font-medium transition-colors cursor-pointer ${
                        assignRole === item.key
                          ? 'bg-purple-600 border-purple-500 text-white font-bold'
                          : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      <div>{item.label}</div>
                      <div className="text-[10px] opacity-70">{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setSelectedRequest(null)}
                disabled={isSubmitting}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold transition-colors cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                id="btn-confirm-approve"
                onClick={handleApprove}
                disabled={isSubmitting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold flex items-center space-x-1.5 transition-colors cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>승인 및 초대장 발송 중...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>최종 승인 및 초대 발송</span>
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
