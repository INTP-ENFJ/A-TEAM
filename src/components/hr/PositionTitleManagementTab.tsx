import React, { useState, useEffect } from 'react';
import { 
  Briefcase, 
  Plus, 
  Edit2, 
  Trash2, 
  ToggleLeft, 
  ToggleRight, 
  Loader2, 
  RefreshCw, 
  AlertCircle,
  Check
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PositionTitle } from '../../types';

interface PositionTitleManagementTabProps {
  onShowToast: (msg: string) => void;
}

export const PositionTitleManagementTab: React.FC<PositionTitleManagementTabProps> = ({ onShowToast }) => {
  const [positions, setPositions] = useState<PositionTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPos, setEditingPos] = useState<PositionTitle | null>(null);
  const [posName, setPosName] = useState('');
  const [posSortOrder, setPosSortOrder] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 직책 목록 로드
  const loadPositions = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('position_titles')
        .select('*')
        .order('sort_order');

      if (err) throw err;
      // DB 컬럼명(snake_case)을 화면에서 쓰는 이름(camelCase)으로 변환
      setPositions(
        (data || []).map((row: any) => ({
          id: row.id,
          name: row.name,
          isActive: row.is_active !== false,
          sortOrder: row.sort_order ?? 0,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }))
      );
    } catch (err: any) {
      console.error('Failed to load position titles:', err);
      setError('직책 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPositions();
  }, []);

  // 직책 추가 모달
  const openCreateModal = () => {
    setEditingPos(null);
    setPosName('');
    setPosSortOrder((positions.length + 1) * 10);
    setIsModalOpen(true);
  };

  // 직책 수정 모달
  const openEditModal = (pos: PositionTitle) => {
    setEditingPos(pos);
    setPosName(pos.name);
    setPosSortOrder(pos.sortOrder);
    setIsModalOpen(true);
  };

  // 저장
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!posName.trim()) {
      onShowToast('직책명을 입력해주세요.');
      return;
    }

    setIsSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      if (editingPos) {
        // UPDATE
        const { error: updateErr } = await supabase
          .from('position_titles')
          .update({
            name: posName.trim(),
            sort_order: posSortOrder,
            updated_at: nowIso,
          })
          .eq('id', editingPos.id);

        if (updateErr) throw updateErr;
        onShowToast(`"${posName.trim()}" 직책 정보가 수정되었습니다.`);
      } else {
        // INSERT
        const { error: insertErr } = await supabase
          .from('position_titles')
          .insert({
            name: posName.trim(),
            sort_order: posSortOrder,
            is_active: true,
            created_at: nowIso,
            updated_at: nowIso,
          });

        if (insertErr) throw insertErr;
        onShowToast(`"${posName.trim()}" 직책이 신설되었습니다.`);
      }

      setIsModalOpen(false);
      await loadPositions();
    } catch (err: any) {
      console.error('Save position title failed:', err);
      onShowToast('직책 저장에 실패했습니다: ' + (err.message || '중복된 직책명일 수 있습니다.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // 활성/비활성화 토글
  const handleToggleActive = async (pos: PositionTitle) => {
    const nextState = !pos.isActive;
    try {
      const { error: err } = await supabase
        .from('position_titles')
        .update({
          is_active: nextState,
          updated_at: new Date().toISOString(),
        })
        .eq('id', pos.id);

      if (err) throw err;
      onShowToast(`"${pos.name}" 직책이 ${nextState ? '활성화' : '비활성화'}되었습니다.`);
      await loadPositions();
    } catch (err: any) {
      console.error('Toggle active failed:', err);
      onShowToast('상태 변경에 실패했습니다: ' + err.message);
    }
  };

  // 안전한 삭제 처리
  const handleDelete = async (pos: PositionTitle) => {
    // profiles 또는 signup_requests 참조 확인
    const { count: profileCount } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('position_title_id', pos.id);

    const { count: requestCount } = await supabase
      .from('signup_requests')
      .select('*', { count: 'exact', head: true })
      .eq('assigned_position_title_id', pos.id);

    const totalRefs = (profileCount || 0) + (requestCount || 0);

    if (totalRefs > 0) {
      onShowToast(`해당 직책을 참조하는 사용자/신청서가 ${totalRefs}건 존재합니다. 데이터 무결성을 위해 물리 삭제 대신 "비활성화"를 권장합니다.`);
      return;
    }

    if (!confirm(`"${pos.name}" 직책을 완전히 삭제하시겠습니까?`)) return;

    try {
      const { error: delErr } = await supabase
        .from('position_titles')
        .delete()
        .eq('id', pos.id);

      if (delErr) throw delErr;
      onShowToast(`"${pos.name}" 직책이 삭제되었습니다.`);
      await loadPositions();
    } catch (err: any) {
      console.error('Delete position title failed:', err);
      onShowToast('직책 삭제에 실패했습니다: ' + err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* 상단 액션 바 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white tracking-tight flex items-center space-x-2">
            <span>사내 직책 마스터 관리</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-semibold border border-slate-700">
              총 {positions.length}개 직책
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            기자 및 관리자에게 부여되는 공식 직책 명칭을 관리합니다. 기자 직급(rank) 및 CMS 역할(role)과는 독립된 사내 공식 표기명입니다.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={loadPositions}
            disabled={loading}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>새로고침</span>
          </button>
          <button
            type="button"
            id="btn-add-position-title"
            onClick={openCreateModal}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>새 직책 등록</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-950/60 border border-rose-800 text-rose-300 rounded text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* 직책 목록 테이블 */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden shadow-lg">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-xs flex items-center justify-center space-x-2">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
            <span>직책 데이터를 불러오는 중...</span>
          </div>
        ) : positions.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            등록된 직책이 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/60 text-slate-400 font-semibold border-b border-slate-700">
                <tr>
                  <th className="py-2.5 px-4 w-16 text-center">정렬 순서</th>
                  <th className="py-2.5 px-4">직책명</th>
                  <th className="py-2.5 px-4">운영 상태</th>
                  <th className="py-2.5 px-4">등록 일시</th>
                  <th className="py-2.5 px-4 text-right">관리 액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {positions.map((pos) => (
                  <tr key={pos.id} className="hover:bg-slate-700/40 transition-colors">
                    <td className="py-3 px-4 text-center font-mono text-slate-400 font-semibold">
                      {pos.sortOrder}
                    </td>
                    <td className="py-3 px-4 font-bold text-white flex items-center space-x-2">
                      <Briefcase className="w-4 h-4 text-emerald-400" />
                      <span>{pos.name}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[12px] font-semibold border ${
                        pos.isActive 
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-800' 
                          : 'bg-slate-900 text-slate-500 border-slate-700'
                      }`}>
                        {pos.isActive ? '운영 중' : '비활성'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      {pos.createdAt ? new Date(pos.createdAt).toLocaleDateString('ko-KR') : '-'}
                    </td>
                    <td className="py-3 px-4 text-right space-x-1">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(pos)}
                        className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-700 transition-colors cursor-pointer"
                        title={pos.isActive ? '비활성화' : '활성화'}
                      >
                        {pos.isActive ? <ToggleRight className="w-4 h-4 text-emerald-400" /> : <ToggleLeft className="w-4 h-4 text-slate-500" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditModal(pos)}
                        className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-700 transition-colors cursor-pointer"
                        title="직책명 수정"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(pos)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-700 transition-colors cursor-pointer"
                        title="직책 삭제"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 직책 추가/수정 모달 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden text-slate-200 text-xs">
            <form onSubmit={handleSubmit}>
              <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                <h3 className="font-bold text-white text-sm">
                  {editingPos ? '직책 정보 수정' : '새 사내 직책 등록'}
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
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    직책명 <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={posName}
                    onChange={(e) => setPosName(e.target.value)}
                    placeholder="예: 부장, 차장, 팀장, 선임기자"
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    표시 정렬 순서 (숫자가 작을수록 위쪽에 표시)
                  </label>
                  <input
                    type="number"
                    value={posSortOrder}
                    onChange={(e) => setPosSortOrder(Number(e.target.value))}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold flex items-center space-x-1.5 transition-colors cursor-pointer"
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
