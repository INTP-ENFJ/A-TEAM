import React, { useState } from 'react';
import { KeyRound, Copy, Check, AlertTriangle } from 'lucide-react';

interface TempPasswordDialogProps {
  /** 안내 제목 (예: 가입 승인 완료) */
  title: string;
  /** 비밀번호를 받을 직원 이름 */
  name: string;
  /** 직원이 로그인에 쓰는 사내 이메일 */
  email: string;
  /** 임시 비밀번호 (화면에만 표시하고 저장하지 않는다) */
  password: string;
  onClose: () => void;
}

/**
 * 임시 비밀번호를 인사부에 한 번만 보여 주는 창.
 * 닫으면 다시 볼 수 없으므로, 직원에게 전달한 뒤 닫도록 안내한다.
 */
export const TempPasswordDialog: React.FC<TempPasswordDialogProps> = ({ title, name, email, password, onClose }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl text-slate-100 space-y-4">
        <div className="flex items-center space-x-3 text-emerald-400">
          <KeyRound className="w-6 h-6" />
          <h3 className="text-base font-bold text-slate-100">{title}</h3>
        </div>

        <div className="p-3.5 bg-slate-950 rounded-lg border border-slate-800 text-xs space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-400">직원:</span>
            <span className="font-semibold text-slate-200">{name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">로그인 아이디:</span>
            <span className="font-mono text-slate-200">{email}</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-slate-300">임시 비밀번호</span>
          <div className="flex items-center space-x-2">
            <code
              id="temp-password-value"
              className="flex-1 px-3 py-2.5 bg-slate-950 border border-emerald-800 rounded-lg text-base font-mono font-bold tracking-wider text-emerald-300 select-all"
            >
              {password}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center space-x-1.5 px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? '복사됨' : '복사'}</span>
            </button>
          </div>
        </div>

        <div className="text-xs text-amber-300 bg-amber-950/40 p-3 rounded-lg border border-amber-800/80 leading-relaxed space-y-1">
          <div className="flex items-center space-x-1.5 font-bold">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>이 창을 닫으면 다시 볼 수 없습니다</span>
          </div>
          <p>시스템이 메일을 보내지 않습니다. 본인 확인 후 전화·대면·사내 메신저로 직접 전달해 주세요.</p>
          <p>전달받은 직원은 로그인한 뒤 <strong>환경설정 → 계정</strong>에서 바로 비밀번호를 바꿔야 합니다.</p>
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow cursor-pointer"
          >
            전달했습니다 (닫기)
          </button>
        </div>
      </div>
    </div>
  );
};
