import React, { useEffect, useRef, useState } from 'react';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { AI_IMAGE_STYLES, generateAiImage, type AiImageStyle, type GeneratedImage } from '../../services/aiImageService';
import { PANEL_BTN_PRIMARY, PANEL_BTN_SECONDARY } from '../editor/PanelHeader';

export interface AiImageUse {
  file: File;
  /** 출처(크레딧)에 자동으로 들어갈 글 */
  credit: string;
  /** 캡션 첫머리에 자동으로 들어갈 글 */
  caption: string;
}

interface Props {
  onClose: () => void;
  onUse: (result: AiImageUse) => void;
}

/** 설명글로 AI 이미지를 만들어 보고, 마음에 들면 미디어 라이브러리 올리기 창으로 넘긴다 */
export const AiImageDialog: React.FC<Props> = ({ onClose, onUse }) => {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<AiImageStyle>('illustration');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedImage | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const make = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await generateAiImage(prompt.trim(), style);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = r.previewUrl;
      setResult(r);
    } catch (e: any) {
      setErr(e?.message || '이미지를 만들지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const use = () => {
    if (!result) return;
    const providerName = result.provider === 'openai' ? 'OpenAI' : 'Google';
    onUse({
      file: result.file,
      credit: `AI 생성 (${providerName} ${result.model})`,
      caption: '[AI 생성 이미지] ',
    });
  };

  return (
    <div className="fixed inset-0 z-[9998] bg-slate-900/50 flex items-center justify-center p-4" onMouseDown={() => !busy && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
          <div className="text-sm font-bold text-slate-900 flex items-center gap-2"><Sparkles className="w-4 h-4 text-purple-600" /> AI 이미지 만들기</div>
          <button type="button" onClick={onClose} disabled={busy} className="text-slate-500 hover:text-slate-800 cursor-pointer" aria-label="닫기"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto min-h-0 flex-1 text-xs">
          <label className="block">
            <span className="font-bold text-slate-700">어떤 이미지를 만들까요?</span>
            <textarea
              rows={3}
              maxLength={500}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={busy}
              placeholder="예: 늦은 밤 정류장에 서 있는 심야버스와 퇴근하는 시민들의 모습"
              className="mt-1 w-full border border-slate-300 rounded-lg p-2 text-xs text-slate-800 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none"
            />
          </label>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-bold text-slate-700 mr-1">그림 느낌</span>
            {AI_IMAGE_STYLES.map(s => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStyle(s.value)}
                disabled={busy}
                className={`px-2.5 py-1 rounded-full border text-[12px] font-semibold cursor-pointer ${
                  style === s.value ? 'bg-purple-600 border-purple-600 text-white' : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {err && <p className="rounded border border-rose-200 bg-rose-50 text-rose-700 p-2">{err}</p>}

          {result && (
            <div className="space-y-2">
              <img src={result.previewUrl} alt="AI가 만든 이미지 미리보기" className="w-full max-h-[40vh] object-contain rounded-lg border border-slate-200 bg-slate-50" />
              <p className="text-[12px] text-slate-700">마음에 들지 않으면 설명을 고쳐서 다시 만들 수 있어요.</p>
            </div>
          )}

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[12px] text-amber-900 space-y-0.5">
            <p className="font-bold">쓰기 전에 꼭 확인해 주세요</p>
            <p>• AI가 만든 이미지는 실제 사건의 사진이 아닙니다. 기사에서는 사진처럼 오해되지 않게 쓰세요.</p>
            <p>• 올릴 때 출처에 "AI 생성"이 자동으로 적히고, 캡션 맨 앞에도 표시가 붙습니다. 지우지 마세요.</p>
            <p>• 실존 인물의 얼굴이나 실제 회사 로고는 그려지지 않도록 막아 두었습니다.</p>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
          <button type="button" onClick={onClose} disabled={busy} className={PANEL_BTN_SECONDARY}>닫기</button>
          <button type="button" onClick={make} disabled={busy || prompt.trim().length < 5} className={`${PANEL_BTN_PRIMARY} disabled:opacity-50`}>
            {busy ? <><Loader2 className="w-3 h-3 animate-spin" /> 만드는 중...</> : result ? '다시 만들기' : '이미지 만들기'}
          </button>
          {result && (
            <button type="button" onClick={use} disabled={busy} className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50">
              라이브러리에 올리기
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
