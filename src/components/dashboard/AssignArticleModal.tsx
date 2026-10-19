import React, { useState, useEffect } from 'react';
import { X, UserCheck, Calendar, Clock, Loader2, AlertCircle } from 'lucide-react';
import { DepartmentReporter } from '../../types';
import { articleWorkflowService } from '../../services/articleWorkflowService';

interface AssignArticleModalProps {
  isOpen: boolean;
  onClose: () => void;
  articleId: string;
  articleTitle: string;
  currentAuthorId?: string;
  currentDeadlineAt?: string | null;
  onSuccess?: (newAuthorId?: string, newDeadlineAt?: string | null, newReporterName?: string) => void;
  showToast?: (message: string) => void;
}

export const AssignArticleModal: React.FC<AssignArticleModalProps> = ({
  isOpen,
  onClose,
  articleId,
  articleTitle,
  currentAuthorId = '',
  currentDeadlineAt,
  onSuccess,
  showToast,
}) => {
  const [reporters, setReporters] = useState<DepartmentReporter[]>([]);
  const [selectedAuthorId, setSelectedAuthorId] = useState<string>(currentAuthorId);
  const [deadlineInput, setDeadlineInput] = useState<string>('');
  const [isLoadingReporters, setIsLoadingReporters] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // datetime-local input용 포맷팅 (YYYY-MM-DDTHH:mm)
  const formatIsoToInput = (iso?: string | null) => {
    if (!iso) return '';
    try {
      const date = new Date(iso);
      if (isNaN(date.getTime())) return '';
      const pad = (n: number) => String(n).padStart(2, '0');
      const y = date.getFullYear();
      const m = pad(date.getMonth() + 1);
      const d = pad(date.getDate());
      const hh = pad(date.getHours());
      const mm = pad(date.getMinutes());
      return `${y}-${m}-${d}T${hh}:${mm}`;
    } catch {
      return '';
    }
  };

  // 모달 열릴 때 초기화 및 부서 기자 목록 로드
  useEffect(() => {
    if (isOpen) {
      setSelectedAuthorId(currentAuthorId);
      setDeadlineInput(formatIsoToInput(currentDeadlineAt));
      setErrorMessage(null);

      const loadReporters = async () => {
        setIsLoadingReporters(true);
        try {
          const list = await articleWorkflowService.getDepartmentReporters();
          setReporters(list);
        } catch (err: any) {
          console.error('[AssignArticleModal] getDepartmentReporters error:', err);
          setErrorMessage('부서 기자 목록을 불러오지 못했습니다.');
        } finally {
          setIsLoadingReporters(false);
        }
      };

      loadReporters();
    }
  }, [isOpen, currentAuthorId, currentDeadlineAt]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAuthorId) {
      setErrorMessage('담당 기자를 선택해주세요.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const deadlineIso = deadlineInput ? new Date(deadlineInput).toISOString() : null;
      await articleWorkflowService.assignArticle(articleId, selectedAuthorId, deadlineIso);
      const selectedRep = reporters.find(r => r.id === selectedAuthorId);
      if (showToast) {
        showToast('기사 배정 및 마감시간이 성공적으로 저장되었습니다.');
      }
      if (onSuccess) {
        onSuccess(selectedAuthorId, deadlineIso, selectedRep?.name);
      }
      onClose();
    } catch (err: any) {
      console.error('[AssignArticleModal] assignArticle error:', err);
      setErrorMessage(err.message || '배정 처리에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      id="modal-assign-article-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
    >
      <div
        id="modal-assign-article-content"
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div
          style={{ background: 'var(--grad-topbar)' }}
          className="px-5 py-4 text-white flex items-center justify-between border-b border-slate-800 select-none"
        >
          <div className="flex items-center space-x-2">
            <UserCheck className="w-4 h-4 text-blue-300" />
            <h3 className="text-sm font-bold">기사 배정 및 마감시간 설정</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/70 hover:text-white p-1 rounded transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs text-slate-700">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 기사 정보 */}
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200/80">
            <span className="text-[12px] font-semibold text-slate-400">대상 기사</span>
            <p className="font-bold text-slate-900 mt-0.5 line-clamp-2">{articleTitle}</p>
          </div>

          {/* 담당 기자 선택 */}
          <div className="space-y-1.5">
            <label className="block font-bold text-slate-800">
              담당 기자 <span className="text-rose-500">*</span>
            </label>
            {isLoadingReporters ? (
              <div className="flex items-center space-x-2 p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                <span>부서 기자 목록을 불러오는 중...</span>
              </div>
            ) : (
              <select
                id="select-assign-author"
                value={selectedAuthorId}
                onChange={e => setSelectedAuthorId(e.target.value)}
                required
                className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600 shadow-2xs cursor-pointer"
              >
                <option value="">기자를 선택하세요</option>
                {reporters.map(rep => (
                  <option key={rep.id} value={rep.id}>
                    {rep.name} ({rep.rank || '기자'}) - {rep.department || '보도국'}
                  </option>
                ))}
              </select>
            )}
            <p className="text-[12px] text-slate-400">
              * 동일한 부서 소속 기자만 배정 대상에 노출됩니다.
            </p>
          </div>

          {/* 마감시간 설정 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block font-bold text-slate-800 flex items-center space-x-1">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <span>마감시간 (선택)</span>
              </label>
              {deadlineInput && (
                <button
                  type="button"
                  onClick={() => setDeadlineInput('')}
                  className="text-[12px] text-slate-400 hover:text-rose-600 cursor-pointer"
                >
                  마감시간 초기화
                </button>
              )}
            </div>
            <div className="relative">
              <input
                id="input-assign-deadline"
                type="datetime-local"
                value={deadlineInput}
                onChange={e => setDeadlineInput(e.target.value)}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600 shadow-2xs"
              />
            </div>
            <p className="text-[12px] text-slate-400 flex items-center space-x-1">
              <Clock className="w-3 h-3 text-slate-400" />
              <span>마감 24시간 이내는 [마감 임박], 기한 경과 시 [마감 초과]로 표시됩니다.</span>
            </p>
          </div>

          {/* Buttons */}
          <div className="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-semibold text-xs transition-colors cursor-pointer"
            >
              취소
            </button>
            <button
              id="btn-save-assignment"
              type="submit"
              disabled={isSubmitting || isLoadingReporters}
              style={{ background: 'var(--grad-button)' }}
              className="px-4 py-2 text-white rounded-lg font-bold text-xs shadow-xs hover:opacity-95 active:opacity-90 transition-all cursor-pointer flex items-center space-x-1.5 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>저장 중...</span>
                </>
              ) : (
                <span>설정 저장</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
