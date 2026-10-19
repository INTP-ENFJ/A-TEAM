import React, { useState } from 'react';
import { Mic } from 'lucide-react';
import { DIARIZE_BADGE, STT_MODELS, diarizeCapableModels, findModel, getSttModel, setSttModel } from '../../services/sttModels';

/** 받아쓰기(녹음 → 글자) 모델 선택. 글쓰기 모델과 따로 저장하며, [녹음 정리] 화면과 같은 값을 씁니다. */
export const SttModelBox: React.FC = () => {
  const [gemini, setGemini] = useState(getSttModel('gemini', 'speech') || '');
  const [oaSpeech, setOaSpeech] = useState(getSttModel('openai', 'speech') || '');
  const [oaInterview, setOaInterview] = useState(getSttModel('openai', 'interview') || '');

  const selectCls = 'w-full border border-slate-300 rounded px-2 py-1.5 text-xs font-mono text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer';
  const badge = (engine: 'gemini' | 'openai', id: string) => {
    const info = findModel(engine, id);
    if (!info) return null;
    const b = DIARIZE_BADGE[info.diarize];
    return (
      <span className="block mt-1 text-[12px] text-slate-600">
        <span className={`inline-block px-1.5 py-0.5 rounded-full border font-bold mr-1.5 ${b.cls}`}>{b.text}</span>
        {info.note}
      </span>
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 shadow-xs">
      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
        <Mic className="w-4 h-4 text-blue-600" />
        받아쓰기(녹음 → 글자) 모델
      </h3>
      <p className="text-[12px] text-slate-600">
        글쓰기 모델과 따로 고릅니다. 글쓰기 모델이 막혀도 받아쓰기는 계속 쓸 수 있어요. 이 선택은 [녹음 정리] 화면과 같이 바뀝니다(이 컴퓨터에만 저장).
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <label className="font-semibold text-slate-700">
          Gemini (발표·인터뷰 공통)
          <select value={gemini} onChange={(e) => { setGemini(e.target.value); setSttModel('gemini', 'speech', e.target.value); }} className={selectCls}>
            {STT_MODELS.gemini.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          {badge('gemini', gemini)}
        </label>
        <label className="font-semibold text-slate-700">
          OpenAI · 발표용
          <select value={oaSpeech} onChange={(e) => { setOaSpeech(e.target.value); setSttModel('openai', 'speech', e.target.value); }} className={selectCls}>
            {STT_MODELS.openai.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          {badge('openai', oaSpeech)}
        </label>
        <label className="font-semibold text-slate-700">
          OpenAI · 인터뷰용 (화자 구분 모델만)
          <select value={oaInterview} onChange={(e) => { setOaInterview(e.target.value); setSttModel('openai', 'interview', e.target.value); }} className={selectCls}>
            {diarizeCapableModels('openai').map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          {badge('openai', oaInterview)}
        </label>
      </div>
      <p className="text-[12px] text-slate-600">구글 클라우드는 모델을 따로 고르지 않으며, 화자 구분이 가능합니다.</p>
    </div>
  );
};
