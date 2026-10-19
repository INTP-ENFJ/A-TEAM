import React, { useState } from 'react';
import { Lock, Check, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface PasswordChangeBoxProps {
  /** 로그인에 쓰는 사내 이메일 (현재 비밀번호 확인용) */
  email: string;
}

/**
 * 환경설정의 비밀번호 변경 칸.
 * 임시 비밀번호로 처음 로그인한 직원은 여기서 본인만 아는 비밀번호로 바꾼다.
 * 입력한 비밀번호는 화면 밖으로 저장하거나 기록하지 않는다.
 */
export const PasswordChangeBox: React.FC<PasswordChangeBoxProps> = ({ email }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (next.length < 8) {
      setMessage({ ok: false, text: '새 비밀번호는 8자 이상으로 입력해 주세요.' });
      return;
    }
    if (!/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) {
      setMessage({ ok: false, text: '새 비밀번호에는 영문과 숫자가 모두 들어가야 합니다.' });
      return;
    }
    if (next !== confirm) {
      setMessage({ ok: false, text: '새 비밀번호 두 칸이 서로 다릅니다.' });
      return;
    }
    if (next === current) {
      setMessage({ ok: false, text: '현재 비밀번호와 다른 비밀번호를 입력해 주세요.' });
      return;
    }

    setBusy(true);
    try {
      // 1. 현재 비밀번호가 맞는지 확인
      const { error: checkErr } = await supabase.auth.signInWithPassword({ email, password: current });
      if (checkErr) {
        setMessage({ ok: false, text: '현재 비밀번호가 맞지 않습니다.' });
        return;
      }

      // 2. 새 비밀번호로 변경하고, "임시 비밀번호 사용 중" 표식을 지운다
      const { error: updErr } = await supabase.auth.updateUser({
        password: next,
        data: { must_change_password: false },
      });
      if (updErr) {
        setMessage({ ok: false, text: '비밀번호를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.' });
        return;
      }

      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage({ ok: true, text: '비밀번호를 변경했습니다. 다음 로그인부터 새 비밀번호를 사용하세요.' });
    } catch {
      setMessage({ ok: false, text: '비밀번호를 바꾸는 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.' });
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 border border-slate-300 rounded-md bg-white text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 shadow-2xs';

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 text-xs">
      <div className="flex items-center space-x-2">
        <Lock className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-bold text-slate-900">비밀번호 변경</h3>
      </div>
      <p className="text-[12px] text-slate-500 leading-relaxed">
        인사부에서 받은 임시 비밀번호로 로그인했다면, 본인만 아는 비밀번호로 꼭 바꿔 주세요.
        (8자 이상, 영문과 숫자를 함께 사용)
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor="pw-current" className="block font-semibold text-slate-700 mb-1">현재 비밀번호</label>
          <input id="pw-current" type="password" autoComplete="current-password" value={current}
            onChange={(e) => setCurrent(e.target.value)} className={inputClass} required />
        </div>
        <div>
          <label htmlFor="pw-new" className="block font-semibold text-slate-700 mb-1">새 비밀번호</label>
          <input id="pw-new" type="password" autoComplete="new-password" value={next}
            onChange={(e) => setNext(e.target.value)} className={inputClass} required />
        </div>
        <div>
          <label htmlFor="pw-confirm" className="block font-semibold text-slate-700 mb-1">새 비밀번호 확인</label>
          <input id="pw-confirm" type="password" autoComplete="new-password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} className={inputClass} required />
        </div>
      </div>

      {message && (
        <div className={`flex items-center space-x-2 p-2.5 rounded-md border text-[12px] font-medium ${
          message.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'
        }`}>
          {message.ok ? <Check className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={busy}
          className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-md font-bold text-xs shadow-2xs flex items-center space-x-2 transition-colors cursor-pointer disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
          <span>비밀번호 변경</span>
        </button>
      </div>
    </form>
  );
};
