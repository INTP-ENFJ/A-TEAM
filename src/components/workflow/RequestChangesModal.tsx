import React, { useState } from 'react';
import { AlertCircle, X, Send } from 'lucide-react';

interface RequestChangesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
  articleTitle: string;
}

export const RequestChangesModal: React.FC<RequestChangesModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  articleTitle,
}) => {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return;

    try {
      setIsSubmitting(true);
      await onSubmit(trimmed);
      setReason('');
      onClose();
    } catch (err) {
      console.error('[RequestChangesModal] Error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center text-rose-600">
              <AlertCircle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">기사 수정 요청</h3>
              <p className="text-xs text-slate-500">기자에게 보낼 수정 요청 사유를 작성하세요</p>
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <span className="text-xs font-semibold text-slate-600">대상 기사</span>
            <p className="text-xs font-bold text-slate-800 line-clamp-1 mt-0.5">{articleTitle || '제목 없음'}</p>
          </div>

          <div>
            <label htmlFor="changes-reason" className="block text-xs font-semibold text-slate-700 mb-1.5">
              수정 요청 사유 <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="changes-reason"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 2문단의 통계 수치 출처를 보강하고, 기사 제목을 핵심 쟁점이 드러나도록 더 구체적으로 수정해주세요."
              disabled={isSubmitting}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-rose-500 focus:border-rose-500 text-slate-800 placeholder-slate-400 resize-none leading-relaxed"
              required
            />
            <p className="text-[12px] text-slate-500 mt-1">
              * 작성된 사유는 기자의 데스크 피드백 및 버전 기록에 자동으로 저장됩니다.
            </p>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !reason.trim()}
              className="flex items-center space-x-1.5 px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 rounded-lg transition-colors shadow-2xs cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSubmitting ? '요청 전송 중...' : '수정 요청 전송'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
