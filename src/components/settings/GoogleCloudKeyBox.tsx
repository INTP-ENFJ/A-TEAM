import React, { useEffect, useState } from 'react';
import {
  getGoogleCloudKeyLast4, saveGoogleCloudKey, testGoogleCloudKey, clearGoogleCloudKey, maskLast4,
} from '../../services/aiKey';

/**
 * 구글 클라우드 받아쓰기 전용 키 칸.
 * 글쓰기 AI(Gemini·OpenAI 등)와 따로 등록하며, 녹음 받아쓰기에서만 쓰인다.
 */
export const GoogleCloudKeyBox: React.FC = () => {
  const [last4, setLast4] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    getGoogleCloudKeyLast4().then(v => { if (alive) setLast4(v); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await work();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || '처리하지 못했습니다.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () => run(async () => {
    const r = await saveGoogleCloudKey(input);
    setLast4(await getGoogleCloudKeyLast4());
    setInput('');
    setMsg({ ok: true, text: r.message || '구글 클라우드 키를 저장했습니다.' });
  });

  const handleTest = () => run(async () => {
    const r = await testGoogleCloudKey();
    setMsg({ ok: r.ok, text: r.message });
  });

  const handleRemove = () => run(async () => {
    await clearGoogleCloudKey();
    setLast4('');
    setMsg({ ok: true, text: '저장된 구글 클라우드 키를 지웠습니다.' });
  });

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
      <div>
        <h3 className="text-sm font-extrabold text-slate-900">구글 클라우드 키 (녹음 받아쓰기 전용)</h3>
        <p className="text-[12px] text-slate-600 mt-1 leading-relaxed">
          긴 녹음이나 화자 구분이 필요할 때 구글 클라우드의 음성 인식을 쓸 수 있습니다. 글쓰기 AI와는 별개이며, 사용 요금은 내 구글 클라우드 계정으로 청구됩니다.
          발급 방법은 사용자 가이드의 「API 연결」 탭에 있습니다.
        </p>
      </div>

      {last4 && (
        <p className="text-xs font-bold text-emerald-800">
          등록됨 ({maskLast4(last4)}) — 프로젝트 이름의 끝 4글자입니다.
        </p>
      )}

      <textarea
        rows={4}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={busy}
        spellCheck={false}
        autoComplete="off"
        placeholder={'서비스 계정 키 파일(JSON)을 메모장으로 열어 내용 전체를 복사해 붙여 넣으세요.\n{ "type": "service_account", ... }'}
        className="w-full text-[12px] font-mono p-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy || input.trim().length < 200}
          className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
        >
          확인 후 저장
        </button>
        {last4 && (
          <>
            <button
              type="button"
              onClick={handleTest}
              disabled={busy}
              className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 cursor-pointer disabled:opacity-50"
            >
              저장된 키 확인
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              className="px-3 py-1.5 rounded-md border border-red-300 bg-white hover:bg-red-50 text-xs font-bold text-red-700 cursor-pointer disabled:opacity-50"
            >
              키 지우기
            </button>
          </>
        )}
      </div>

      {msg && (
        <p className={`text-[12px] font-bold ${msg.ok ? 'text-emerald-800' : 'text-red-700'}`}>{msg.text}</p>
      )}
      <p className="text-[12px] text-slate-500">
        키는 암호화되어 내 계정에만 저장되며, 화면에는 다시 표시되지 않습니다. 채팅이나 메신저에 붙여 넣지 마세요.
      </p>
    </div>
  );
};
