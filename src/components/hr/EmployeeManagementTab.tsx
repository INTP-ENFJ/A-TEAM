import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, 
  Search, 
  RefreshCw, 
  AlertCircle, 
  Loader2, 
  Building2, 
  Briefcase, 
  Mail, 
  Calendar,
  Filter,
  Pencil,
  UserX,
  UserCheck,
  X
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { EmployeeListItem, USER_RANK_LABELS, UserRankCode, UserRole } from '../../types';

interface EmployeeManagementTabProps {
  onShowToast: (msg: string) => void;
}

export const EmployeeManagementTab: React.FC<EmployeeManagementTabProps> = ({ onShowToast }) => {
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 검색 및 필터 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');

  // 직원 정보 수정 / 계정 비활성화
  const [deptOptions, setDeptOptions] = useState<{ id: string; name: string }[]>([]);
  const [posOptions, setPosOptions] = useState<{ id: string; name: string }[]>([]);
  const [editTarget, setEditTarget] = useState<EmployeeListItem | null>(null);
  const [formDeptId, setFormDeptId] = useState('');
  const [formPosId, setFormPosId] = useState('');
  const [formRank, setFormRank] = useState<UserRankCode>('reporter');
  const [formRole, setFormRole] = useState<UserRole>('reporter');
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [myId, setMyId] = useState<string | null>(null);

  // 직원 목록 로드 (get_hr_employees RPC 호출)
  const loadEmployees = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_hr_employees');

      if (rpcError) {
        throw rpcError;
      }

      const mapped: EmployeeListItem[] = (data || []).map((row: any) => ({
        id: row.id,
        name: row.name || '미등록',
        email: row.email || '(이메일 정보 없음)',
        department: row.department || '미지정',
        departmentId: row.department_id,
        rank: (row.rank as UserRankCode) || 'reporter',
        role: (row.role as UserRole) || 'reporter',
        roleTitle: row.role_title || '',
        positionTitleId: row.position_title_id,
        createdAt: row.created_at || '',
        isActive: row.is_active !== false,
      }));

      setEmployees(mapped);
    } catch (err: any) {
      console.error('Failed to load employees:', err);
      setError(err.message || '직원 목록을 불러오지 못했습니다. 인사부 관리자 권한을 확인하세요.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEmployees();
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        setMyId(u?.user?.id ?? null);
        const [d, p] = await Promise.all([
          supabase.from('departments').select('id, name, parent_id, sort_order').eq('is_active', true).order('sort_order'),
          supabase.from('position_titles').select('id, name, sort_order').eq('is_active', true).order('sort_order'),
        ]);
        setDeptOptions((d.data || []).map((x: any) => ({ id: x.id, name: x.name })));
        setPosOptions((p.data || []).map((x: any) => ({ id: x.id, name: x.name })));
      } catch (e) {
        console.error('Failed to load department/position options:', e);
      }
    })();
  }, []);

  const openEdit = (emp: EmployeeListItem) => {
    setEditTarget(emp);
    setFormDeptId(emp.departmentId || '');
    setFormPosId(emp.positionTitleId || '');
    setFormRank(emp.rank);
    setFormRole(emp.role);
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    if (!formDeptId || !formPosId) {
      onShowToast('부서와 직책을 모두 선택해 주세요.');
      return;
    }
    setIsSaving(true);
    try {
      const { error: rpcErr } = await supabase.rpc('hr_update_employee', {
        p_user_id: editTarget.id,
        p_department_id: formDeptId,
        p_position_title_id: formPosId,
        p_rank: formRank,
        p_role: formRole,
      });
      if (rpcErr) throw rpcErr;
      onShowToast(`${editTarget.name}님의 정보를 수정했습니다. 본인에게 알림이 갑니다.`);
      setEditTarget(null);
      await loadEmployees();
    } catch (err: any) {
      console.error('hr_update_employee failed:', err);
      onShowToast(err.message || '직원 정보를 수정하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleActive = async (emp: EmployeeListItem) => {
    const next = emp.isActive === false; // 지금 비활성이면 다시 활성화
    const msg = next
      ? `${emp.name}님의 계정을 다시 사용하도록 할까요?`
      : `${emp.name}님의 계정을 비활성화할까요?\n로그인이 막히고 지금 접속 중이면 접속이 끊깁니다. 기사와 기록은 지워지지 않으며, 언제든 다시 활성화할 수 있습니다.`;
    if (!confirm(msg)) return;
    setBusyId(emp.id);
    try {
      const { error: rpcErr } = await supabase.rpc('hr_set_employee_active', {
        p_user_id: emp.id,
        p_active: next,
      });
      if (rpcErr) throw rpcErr;
      onShowToast(next ? `${emp.name}님의 계정을 다시 사용합니다.` : `${emp.name}님의 계정을 비활성화했습니다.`);
      await loadEmployees();
    } catch (err: any) {
      console.error('hr_set_employee_active failed:', err);
      onShowToast(err.message || '계정 상태를 바꾸지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  // 고유 부서 목록 추출 (필터용)
  const departments = useMemo(() => {
    const set = new Set<string>();
    employees.forEach(emp => {
      if (emp.department) set.add(emp.department);
    });
    return Array.from(set).sort();
  }, [employees]);

  // 검색 및 부서 필터링 적용
  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      // 1. 부서 필터
      if (selectedDepartment !== 'all' && emp.department !== selectedDepartment) {
        return false;
      }

      // 2. 검색어 필터 (이름, 이메일, 부서, 직책)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const nameMatch = emp.name.toLowerCase().includes(q);
        const emailMatch = emp.email.toLowerCase().includes(q);
        const deptMatch = emp.department.toLowerCase().includes(q);
        const titleMatch = (emp.roleTitle || '').toLowerCase().includes(q);
        const rankMatch = (USER_RANK_LABELS[emp.rank] || '').toLowerCase().includes(q);
        return nameMatch || emailMatch || deptMatch || titleMatch || rankMatch;
      }

      return true;
    });
  }, [employees, selectedDepartment, searchQuery]);

  // 역할 뱃지 라벨
  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'editor_in_chief':
        return <span className="px-2 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800 text-[10px] font-bold">편집국장</span>;
      case 'desk_editor':
        return <span className="px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800 text-[10px] font-bold">데스크</span>;
      case 'reporter':
      default:
        return <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px]">일반 기자</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. 상단 탭 타이틀 및 액션 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white tracking-tight flex items-center space-x-2">
            <Users className="w-5 h-5 text-blue-400" />
            <span>언론사 재직 직원 명부</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-semibold border border-blue-500/30">
              총 {employees.length}명
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            공식 데이터베이스(`public.profiles`)와 계정(`auth.users`)을 결합한 전체 직원 명부입니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            loadEmployees();
            onShowToast('직원 목록을 새로고침했습니다.');
          }}
          disabled={loading}
          className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-semibold border border-slate-700 transition-colors cursor-pointer self-start sm:self-auto"
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

      {/* 2. 필터 및 검색 바 */}
      <div className="p-4 bg-slate-800 border border-slate-700 rounded-lg flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between shadow-sm">
        {/* 부서 필터 */}
        <div className="flex items-center space-x-2">
          <Filter className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="text-xs text-slate-400 font-medium whitespace-nowrap">소속 부서:</span>
          <select
            id="select-dept-filter"
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
          >
            <option value="all">전체 부서 ({employees.length})</option>
            {departments.map(dept => {
              const count = employees.filter(e => e.department === dept).length;
              return (
                <option key={dept} value={dept}>
                  {dept} ({count})
                </option>
              );
            })}
          </select>
        </div>

        {/* 검색 인풋 */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            id="input-employee-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="이름, 이메일, 부서, 직책 검색..."
            className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* 3. 직원 목록 테이블 */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden shadow-lg">
        <div className="px-4 py-3 bg-slate-900/60 border-b border-slate-700 font-semibold text-xs text-slate-300 flex items-center justify-between">
          <span className="flex items-center space-x-1.5">
            <Building2 className="w-4 h-4 text-blue-400" />
            <span>임직원 명부</span>
          </span>
          <span className="text-slate-400 font-normal">
            검색 결과 {filteredEmployees.length}명 / 전체 {employees.length}명
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400 text-xs flex items-center justify-center space-x-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
            <span>직원 명부 데이터를 불러오는 중...</span>
          </div>
        ) : filteredEmployees.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            {searchQuery || selectedDepartment !== 'all' 
              ? '검색 조건과 일치하는 직원이 없습니다.' 
              : '등록된 직원 정보가 없습니다.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/40 text-slate-400 font-semibold border-b border-slate-700">
                <tr>
                  <th className="py-2.5 px-4">성명 (이름)</th>
                  <th className="py-2.5 px-4">사내 이메일</th>
                  <th className="py-2.5 px-4">소속 부서</th>
                  <th className="py-2.5 px-4">공식 직책 / 직급</th>
                  <th className="py-2.5 px-4">시스템 역할</th>
                  <th className="py-2.5 px-4">계정 등록일</th>
                  <th className="py-2.5 px-4">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {filteredEmployees.map((emp) => (
                  <tr key={emp.id} className={`hover:bg-slate-700/40 transition-colors ${emp.isActive === false ? 'opacity-60' : ''}`}>
                    {/* 이름 (SSOT: profiles.name) */}
                    <td className="py-3 px-4 font-bold text-white flex items-center space-x-2">
                      <div className="w-6 h-6 rounded-full bg-blue-900/80 border border-blue-700 flex items-center justify-center text-[10px] font-bold text-blue-200 shrink-0">
                        {emp.name.slice(0, 1)}
                      </div>
                      <span>{emp.name}</span>
                      {emp.isActive === false && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 border border-slate-600 text-[10px] font-semibold">비활성</span>
                      )}
                    </td>

                    {/* 이메일 (auth.users.email) */}
                    <td className="py-3 px-4 font-mono text-slate-300">
                      <div className="flex items-center space-x-1.5">
                        <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span>{emp.email}</span>
                      </div>
                    </td>

                    {/* 소속 부서 */}
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-700/80 text-slate-200 border border-slate-600 text-[11px] font-medium">
                        {emp.department}
                      </span>
                    </td>

                    {/* 공식 직책 / 직급 */}
                    <td className="py-3 px-4 text-slate-200">
                      <div className="flex items-center space-x-1.5">
                        <Briefcase className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="font-semibold">{emp.roleTitle || '-'}</span>
                        <span className="text-slate-400 text-[11px]">
                          ({USER_RANK_LABELS[emp.rank] || emp.rank})
                        </span>
                      </div>
                    </td>

                    {/* 시스템 역할 */}
                    <td className="py-3 px-4">
                      {getRoleBadge(emp.role)}
                    </td>

                    {/* 가입일 */}
                    <td className="py-3 px-4 text-slate-400 text-[11px]">
                      <div className="flex items-center space-x-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span>
                          {emp.createdAt 
                            ? new Date(emp.createdAt).toLocaleDateString('ko-KR', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                              })
                            : '-'}
                        </span>
                      </div>
                    </td>

                    {/* 관리 */}
                    <td className="py-3 px-4">
                      {emp.id === myId ? (
                        <span className="text-[11px] text-slate-500">본인</span>
                      ) : (
                        <div className="flex items-center space-x-1.5">
                          <button
                            type="button"
                            onClick={() => openEdit(emp)}
                            disabled={busyId === emp.id}
                            className="inline-flex items-center space-x-1 px-2 py-1 rounded border border-slate-600 text-slate-200 hover:bg-slate-700 text-[11px] cursor-pointer"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>수정</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleActive(emp)}
                            disabled={busyId === emp.id}
                            className={`inline-flex items-center space-x-1 px-2 py-1 rounded border text-[11px] cursor-pointer ${
                              emp.isActive === false
                                ? 'border-emerald-700 text-emerald-300 hover:bg-emerald-950/50'
                                : 'border-rose-800 text-rose-300 hover:bg-rose-950/50'
                            }`}
                          >
                            {emp.isActive === false ? <UserCheck className="w-3 h-3" /> : <UserX className="w-3 h-3" />}
                            <span>{emp.isActive === false ? '다시 사용' : '비활성화'}</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. 직원 정보 수정 창 */}
      {editTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-800 border border-slate-600 rounded-lg shadow-2xl text-xs text-slate-200">
            <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
              <span className="font-bold text-sm text-white">{editTarget.name}님 정보 수정</span>
              <button type="button" onClick={() => setEditTarget(null)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <label className="block">
                <span className="block mb-1 text-slate-400">소속 부서</span>
                <select value={formDeptId} onChange={(e) => setFormDeptId(e.target.value)} className="w-full px-2.5 py-2 bg-slate-900 border border-slate-700 rounded">
                  <option value="">선택</option>
                  {deptOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block mb-1 text-slate-400">직책</span>
                <select value={formPosId} onChange={(e) => setFormPosId(e.target.value)} className="w-full px-2.5 py-2 bg-slate-900 border border-slate-700 rounded">
                  <option value="">선택</option>
                  {posOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block mb-1 text-slate-400">직급</span>
                <select value={formRank} onChange={(e) => setFormRank(e.target.value as UserRankCode)} className="w-full px-2.5 py-2 bg-slate-900 border border-slate-700 rounded">
                  {(Object.keys(USER_RANK_LABELS) as UserRankCode[]).map((r) => <option key={r} value={r}>{USER_RANK_LABELS[r]}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block mb-1 text-slate-400">시스템 역할 (기사 검토·승인 권한)</span>
                <select value={formRole} onChange={(e) => setFormRole(e.target.value as UserRole)} className="w-full px-2.5 py-2 bg-slate-900 border border-slate-700 rounded">
                  <option value="reporter">일반 기자</option>
                  <option value="desk_editor">데스크</option>
                  <option value="editor_in_chief">편집국장</option>
                </select>
              </label>
              <p className="text-[11px] text-amber-300/90">
                부장·차장 직급이나 데스크·편집국장 역할이면 같은 부서 기사를 검토·승인할 수 있습니다. 바꾸면 본인에게 알림이 가고 변경 기록에 남습니다.
              </p>
            </div>
            <div className="px-4 py-3 border-t border-slate-700 flex justify-end space-x-2">
              <button type="button" onClick={() => setEditTarget(null)} className="px-3 py-1.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700 cursor-pointer">취소</button>
              <button type="button" onClick={saveEdit} disabled={isSaving} className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50 cursor-pointer">
                {isSaving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
