import React, { useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';

interface ApproveConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  articleTitle: string;
}

export const ApproveConfirmModal: React.FC<ApproveConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  articleTitle,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    try {
      setIsSubmitting(true);
      await onConfirm();
      onClose();
    } catch (err) {
      console.error('[ApproveConfirmModal] Error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center text-purple-600">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">기사 출고 승인</h3>
              <p className="text-xs text-slate-500">데스크 최종 검토 승인</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-3">
          <div>
            <span className="text-xs font-semibold text-slate-600">대상 기사</span>
            <p className="text-xs font-bold text-slate-800 line-clamp-2 mt-0.5">{articleTitle || '제목 없음'}</p>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            해당 기사를 검토 승인하고 <strong>출고 대기(Ready)</strong> 상태로 전환하시겠습니까?
            승인 즉시 버전 이력에 기록되며, 부장의 최종 출고가 가능해집니다.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-2 px-5 py-3.5 bg-slate-50 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="px-4 py-1.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 rounded-lg transition-colors shadow-2xs cursor-pointer"
          >
            {isSubmitting ? '승인 처리 중...' : '기사 승인'}
          </button>
        </div>
      </div>
    </div>
  );
};
