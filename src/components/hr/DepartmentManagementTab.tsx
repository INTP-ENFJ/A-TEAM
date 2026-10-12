import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  Plus, 
  Edit2, 
  Trash2, 
  ToggleLeft, 
  ToggleRight, 
  Loader2, 
  RefreshCw, 
  CornerDownRight, 
  AlertCircle,
  Check
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Department } from '../../types';

interface DepartmentManagementTabProps {
  onShowToast: (msg: string) => void;
}

export const DepartmentManagementTab: React.FC<DepartmentManagementTabProps> = ({ onShowToast }) => {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 모달 상태 (추가 / 수정)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [deptName, setDeptName] = useState('');
  const [deptParentId, setDeptParentId] = useState<string | null>(null);
  const [deptSortOrder, setDeptSortOrder] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 부서 데이터 로드
  const loadDepartments = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('departments')
        .select('*')
        .order('sort_order');

      if (err) throw err;
      // DB 컬럼명(snake_case)을 화면에서 쓰는 이름(camelCase)으로 변환
      setDepartments(
        (data || []).map((row: any) => ({
          id: row.id,
          name: row.name,
          parentId: row.parent_id ?? null,
          isActive: row.is_active !== false,
          sortOrder: row.sort_order ?? 0,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }))
      );
    } catch (err: any) {
      console.error('Failed to load departments:', err);
      setError('부서 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDepartments();
  }, []);

  // 1차 부서 추가 모달 열기
  const openCreateRootModal = () => {
    setEditingDept(null);
    setDeptName('');
    setDeptParentId(null);
    setDeptSortOrder((departments.length + 1) * 10);
    setIsModalOpen(true);
  };

  // 하위 부서 추가 모달 열기
  const openCreateSubModal = (parent: Department) => {
    setEditingDept(null);
    setDeptName('');
    setDeptParentId(parent.id);
    const siblings = departments.filter(d => d.parentId === parent.id);
    setDeptSortOrder(parent.sortOrder + siblings.length + 1);
    setIsModalOpen(true);
  };

  // 수정 모달 열기
  const openEditModal = (dept: Department) => {
    setEditingDept(dept);
    setDeptName(dept.name);
    setDeptParentId(dept.parentId);
    setDeptSortOrder(dept.sortOrder);
    setIsModalOpen(true);
  };

  // 저장 (INSERT 또는 UPDATE)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptName.trim()) {
      onShowToast('부서명을 입력해주세요.');
      return;
    }

    setIsSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      if (editingDept) {
        // UPDATE
        const { error: updateErr } = await supabase
          .from('departments')
          .update({
            name: deptName.trim(),
            parent_id: deptParentId,
            sort_order: deptSortOrder,
            updated_at: nowIso,
          })
          .eq('id', editingDept.id);

        if (updateErr) throw updateErr;
        onShowToast(`"${deptName.trim()}" 부서가 수정되었습니다.`);
      } else {
        // INSERT
        const { error: insertErr } = await supabase
          .from('departments')
          .insert({
            name: deptName.trim(),
            parent_id: deptParentId,
            sort_order: deptSortOrder,
            is_active: true,
            created_at: nowIso,
            updated_at: nowIso,
          });

        if (insertErr) throw insertErr;
        onShowToast(`"${deptName.trim()}" 부서가 신설되었습니다.`);
      }

      setIsModalOpen(false);
      await loadDepartments();
    } catch (err: any) {
      console.error('Save department failed:', err);
      onShowToast('부서 저장에 실패했습니다: ' + (err.message || '중복된 부서명일 수 있습니다.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // 활성/비활성화 토글
  const handleToggleActive = async (dept: Department) => {
    const nextState = !dept.isActive;
    try {
      const { error: err } = await supabase
        .from('departments')
        .update({
          is_active: nextState,
          updated_at: new Date().toISOString(),
        })
        .eq('id', dept.id);

      if (err) throw err;
      onShowToast(`"${dept.name}" 부서가 ${nextState ? '활성화' : '비활성화'}되었습니다.`);
      await loadDepartments();
    } catch (err: any) {
      console.error('Toggle active failed:', err);
      onShowToast('상태 변경에 실패했습니다: ' + err.message);
    }
  };

  // 안전한 삭제 처리 (참조 데이터 유무 확인)
  const handleDelete = async (dept: Department) => {
    // 1. 하위 부서 존재 여부 확인
    const hasChildren = departments.some(d => d.parentId === dept.id);
    if (hasChildren) {
      onShowToast('하위 부서가 존재하는 부서는 삭제할 수 없습니다. 하위 부서를 먼저 정리하거나 비활성화를 사용하세요.');
      return;
    }

    // 2. profiles 또는 signup_requests 참조 확인
    const { count: profileCount } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('department_id', dept.id);

    const { count: requestCount } = await supabase
      .from('signup_requests')
      .select('*', { count: 'exact', head: true })
      .eq('department_id', dept.id);

    const totalRefs = (profileCount || 0) + (requestCount || 0);

    if (totalRefs > 0) {
      onShowToast(`해당 부서를 참조하는 사용자/신청서가 ${totalRefs}건 존재합니다. 데이터 무결성을 위해 물리 삭제 대신 "비활성화"를 권장합니다.`);
      return;
    }

    if (!confirm(`"${dept.name}" 부서를 완전히 삭제하시겠습니까?`)) return;

    try {
      const { error: delErr } = await supabase
        .from('departments')
        .delete()
        .eq('id', dept.id);

      if (delErr) throw delErr;
      onShowToast(`"${dept.name}" 부서가 삭제되었습니다.`);
      await loadDepartments();
    } catch (err: any) {
      console.error('Delete department failed:', err);
      onShowToast('부서 삭제에 실패했습니다: ' + err.message);
    }
  };

  const rootDepts = departments.filter(d => !d.parentId);

  return (
    <div className="space-y-6">
      {/* 상단 액션 바 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white tracking-tight flex items-center space-x-2">
            <span>언론사 조직 및 부서 관리</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-semibold border border-slate-700">
              총 {departments.length}개 조직
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            취재 본부 및 하위 부서/팀의 계층 구조를 관리합니다. 부서 비활성화 시 신규 가입 신청 드롭다운에서 제외됩니다.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={loadDepartments}
            disabled={loading}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>새로고침</span>
          </button>
          <button
            type="button"
            id="btn-add-root-department"
            onClick={openCreateRootModal}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>최상위 본부/부서 추가</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-950/60 border border-rose-800 text-rose-300 rounded text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* 계층형 부서 목록 */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden shadow-lg">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-xs flex items-center justify-center space-x-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
            <span>조직 데이터를 불러오는 중...</span>
          </div>
        ) : rootDepts.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            등록된 부서가 없습니다.
          </div>
        ) : (
          <div className="divide-y divide-slate-700/60">
            {rootDepts.map((root) => {
              const children = departments.filter(d => d.parentId === root.id);
              return (
                <div key={root.id} className="p-4 hover:bg-slate-750/30 transition-colors">
                  {/* 1차 본부/부서 행 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-md bg-blue-950 border border-blue-800 flex items-center justify-center text-blue-400">
                        <Building2 className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-white text-sm">{root.name}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded font-semibold border ${
                            root.isActive 
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-800' 
                              : 'bg-slate-900 text-slate-500 border-slate-700'
                          }`}>
                            {root.isActive ? '운영 중' : '비활성'}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400">
                          정렬 순서: {root.sortOrder} · 하위 부서: {children.length}개
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1.5">
                      <button
                        type="button"
                        onClick={() => openCreateSubModal(root)}
                        className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold rounded flex items-center space-x-1 transition-colors cursor-pointer"
                        title="하위 팀/부서 추가"
                      >
                        <Plus className="w-3 h-3" />
                        <span>하위 부서</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(root)}
                        className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-700 transition-colors cursor-pointer"
                        title={root.isActive ? '비활성화' : '활성화'}
                      >
                        {root.isActive ? <ToggleRight className="w-4 h-4 text-emerald-400" /> : <ToggleLeft className="w-4 h-4 text-slate-500" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditModal(root)}
                        className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-700 transition-colors cursor-pointer"
                        title="부서명 수정"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(root)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-700 transition-colors cursor-pointer"
                        title="부서 삭제"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* 2차 하위 부서/팀 목록 */}
                  {children.length > 0 && (
                    <div className="mt-3 ml-6 pl-4 border-l-2 border-slate-700 space-y-2">
                      {children.map((child) => (
                        <div key={child.id} className="flex items-center justify-between py-1.5 px-3 bg-slate-900/50 rounded-md border border-slate-800/80">
                          <div className="flex items-center space-x-2">
                            <CornerDownRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <span className="font-semibold text-slate-200 text-xs">{child.name}</span>
                            <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold border ${
                              child.isActive 
                                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800' 
                                : 'bg-slate-900 text-slate-500 border-slate-700'
                            }`}>
                              {child.isActive ? '운영 중' : '비활성'}
                            </span>
                            <span className="text-[10px] text-slate-500">(순서: {child.sortOrder})</span>
                          </div>

                          <div className="flex items-center space-x-1">
                            <button
                              type="button"
                              onClick={() => handleToggleActive(child)}
                              className="p-1 text-slate-400 hover:text-white rounded transition-colors cursor-pointer"
                              title={child.isActive ? '비활성화' : '활성화'}
                            >
                              {child.isActive ? <ToggleRight className="w-3.5 h-3.5 text-emerald-400" /> : <ToggleLeft className="w-3.5 h-3.5 text-slate-500" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditModal(child)}
                              className="p-1 text-slate-400 hover:text-white rounded transition-colors cursor-pointer"
                              title="수정"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(child)}
                              className="p-1 text-slate-400 hover:text-rose-400 rounded transition-colors cursor-pointer"
                              title="삭제"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 부서 추가/수정 모달 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden text-slate-200 text-xs">
            <form onSubmit={handleSubmit}>
              <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                <h3 className="font-bold text-white text-sm">
                  {editingDept ? '부서 정보 수정' : deptParentId ? '하위 부서/팀 신설' : '최상위 본부/부서 신설'}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSubmitting}
                  className="text-slate-400 hover:text-white p-1"
                >
                  ✕
                </button>
              </div>

              <div className="p-5 space-y-4">
                {deptParentId && (
                  <div className="p-2.5 bg-slate-800/80 rounded border border-slate-700 text-slate-300">
                    <span className="text-slate-400">상위 부서: </span>
                    <strong className="text-white">
                      {departments.find(d => d.id === deptParentId)?.name}
                    </strong>
                  </div>
                )}

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    부서명 <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={deptName}
                    onChange={(e) => setDeptName(e.target.value)}
                    placeholder="예: 산업1부, 정책사회부, 디지털뉴스팀"
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    표시 정렬 순서 (숫자가 작을수록 위쪽에 표시)
                  </label>
                  <input
                    type="number"
                    value={deptSortOrder}
                    onChange={(e) => setDeptSortOrder(Number(e.target.value))}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSubmitting}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold transition-colors cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>저장 중...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>저장 완료</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
