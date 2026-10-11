import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, EyeOff, Loader2 } from 'lucide-react';

/** 가릴 네모: 사진 전체를 1로 본 위치와 크기 (0~1) */
export interface BlurRect { x: number; y: number; w: number; h: number; }
type Mode = 'blur' | 'mosaic';

const MAX_OUTPUT_EDGE = 4096;
const PREVIEW_WIDTH = 880;

/** 사진 위에 가림 효과를 그려 넣는다 (미리보기와 최종 저장이 같은 함수를 씀) */
export function paintBlur(
  ctx: CanvasRenderingContext2D,
  bmp: ImageBitmap,
  W: number,
  H: number,
  rects: BlurRect[],
  mode: Mode,
  strength: number,
) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(bmp, 0, 0, W, H);
  ctx.restore();

  const block = Math.max(4, Math.round((strength * Math.min(W, H)) / 120));
  for (const r of rects) {
    const px = Math.max(0, Math.round(r.x * W));
    const py = Math.max(0, Math.round(r.y * H));
    const pw = Math.min(W - px, Math.round(r.w * W));
    const ph = Math.min(H - py, Math.round(r.h * H));
    if (pw < 2 || ph < 2) continue;

    const tw = Math.max(1, Math.ceil(pw / block));
    const th = Math.max(1, Math.ceil(ph / block));
    const useFilter = mode === 'blur' && 'filter' in ctx;

    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();
    if (useFilter) {
      (ctx as any).filter = `blur(${Math.round(block * 0.6)}px)`;
      ctx.drawImage(bmp, 0, 0, W, H);
      (ctx as any).filter = 'none';
    } else {
      // 작게 줄였다가 다시 키우면 모자이크(또는 부드러운 흐림)가 됨
      const tmp = document.createElement('canvas');
      tmp.width = tw;
      tmp.height = th;
      const t = tmp.getContext('2d');
      if (t) {
        t.imageSmoothingEnabled = true;
        t.drawImage(bmp, (px / W) * bmp.width, (py / H) * bmp.height, (pw / W) * bmp.width, (ph / H) * bmp.height, 0, 0, tw, th);
        ctx.imageSmoothingEnabled = mode === 'blur';
        ctx.drawImage(tmp, 0, 0, tw, th, px, py, tw * block, th * block);
      }
    }
    ctx.restore();
  }
}

async function loadBitmap(src: string): Promise<ImageBitmap> {
  const res = await fetch(src);
  if (!res.ok) throw new Error('사진을 불러오지 못했습니다.');
  const blob = await res.blob();
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    return await createImageBitmap(blob);
  }
}

interface Props {
  src: string;
  onClose: () => void;
  /** 가려진 새 사진 파일을 넘겨 줌 (저장·교체는 부른 쪽에서) */
  onApply: (file: File) => Promise<void>;
}

export const BlurModal: React.FC<Props> = ({ src, onClose, onApply }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [rects, setRects] = useState<BlurRect[]>([]);
  const [draft, setDraft] = useState<BlurRect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<Mode>('blur');
  const [strength, setStrength] = useState(6);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadBitmap(src).then(b => { if (alive) setBmp(b); }).catch(e => { if (alive) setLoadErr(e?.message || '사진을 불러오지 못했습니다.'); });
    return () => { alive = false; };
  }, [src]);

  const preview = useMemo(() => {
    if (!bmp) return { w: 0, h: 0 };
    const w = Math.min(bmp.width, PREVIEW_WIDTH);
    return { w, h: Math.round((bmp.height * w) / bmp.width) };
  }, [bmp]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !bmp) return;
    c.width = preview.w;
    c.height = preview.h;
    const ctx = c.getContext('2d');
    if (ctx) paintBlur(ctx, bmp, preview.w, preview.h, rects, mode, strength);
  }, [bmp, preview, rects, mode, strength]);

  const pos = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const onDown = (e: React.PointerEvent) => {
    if (busy || !bmp) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = pos(e);
    setDraft({ ...startRef.current, w: 0, h: 0 });
  };
  const onMove = (e: React.PointerEvent) => {
    const s = startRef.current;
    if (!s) return;
    const p = pos(e);
    setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const onUp = () => {
    if (!startRef.current) return;
    startRef.current = null;
    if (draft && draft.w > 0.01 && draft.h > 0.01) setRects(prev => [...prev, draft]);
    setDraft(null);
  };

  const apply = async () => {
    if (!bmp) return;
    if (rects.length === 0) { setErr('가릴 곳을 먼저 마우스로 끌어서 그려 주세요.'); return; }
    setBusy(true);
    setErr(null);
    try {
      const scale = Math.min(1, MAX_OUTPUT_EDGE / Math.max(bmp.width, bmp.height));
      const W = Math.round(bmp.width * scale);
      const H = Math.round(bmp.height * scale);
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('이 브라우저에서는 사진을 처리할 수 없습니다.');
      paintBlur(ctx, bmp, W, H, rects, mode, strength);
      const blob: Blob = await new Promise((resolve, reject) =>
        c.toBlob(b => (b ? resolve(b) : reject(new Error('사진을 만들지 못했습니다.'))), 'image/jpeg', 0.92));
      const file = new File([blob], `가림처리_${Date.now()}.jpg`, { type: 'image/jpeg' });
      await onApply(file);
    } catch (e: any) {
      setErr(e?.message || '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-slate-900/60 flex items-center justify-center p-4" onMouseDown={() => !busy && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[96vh] flex flex-col overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="text-sm font-bold text-slate-900 flex items-center gap-2"><EyeOff className="w-4 h-4 text-blue-600" /> 사진 일부 가리기</div>
          <button type="button" disabled={busy} onClick={onClose} className="p-1 rounded hover:bg-slate-100 cursor-pointer"><X className="w-4 h-4 text-slate-500" /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto min-h-0 flex-1 text-xs text-slate-700">
          <p className="leading-relaxed">
            가릴 곳(얼굴, 차량 번호 등)을 사진 위에서 <strong>마우스로 끌어 네모</strong>를 그리세요. 여러 곳도 가능합니다.
            원본 사진은 그대로 남고, <strong>가린 사진이 새로 저장되어 기사 속 사진만 바뀝니다.</strong>
          </p>

          {loadErr && <p className="text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{loadErr}</p>}
          {!bmp && !loadErr && <div className="py-16 flex justify-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /></div>}

          {bmp && (
            <div className="flex justify-center bg-slate-100 rounded-lg p-2">
              <div
                ref={boxRef}
                className="relative select-none touch-none cursor-crosshair"
                style={{ width: `min(100%, ${preview.w}px, calc(52vh * ${preview.w / preview.h}))`, aspectRatio: `${preview.w} / ${preview.h}` }}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              >
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
                {rects.map((r, i) => (
                  <div key={i} className="absolute border-2 border-dashed border-blue-500 pointer-events-none" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}>
                    <span className="absolute -top-0.5 -left-0.5 bg-blue-600 text-white text-[10px] leading-none px-1 py-0.5 rounded-br">{i + 1}</span>
                  </div>
                ))}
                {draft && (
                  <div className="absolute border-2 border-dashed border-rose-500 bg-rose-500/10 pointer-events-none" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }} />
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-3">
              <span className="font-semibold">방식</span>
              <label className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={mode === 'blur'} onChange={() => setMode('blur')} /> 흐리게</label>
              <label className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={mode === 'mosaic'} onChange={() => setMode('mosaic')} /> 모자이크</label>
            </div>
            <label className="flex items-center gap-2">
              <span className="font-semibold">가리는 정도</span>
              <input type="range" min={2} max={10} value={strength} onChange={(e) => setStrength(Number(e.target.value))} className="w-36" />
            </label>
          </div>

          {rects.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {rects.map((_, i) => (
                <span key={i} className="inline-flex items-center gap-1 bg-blue-50 text-blue-800 border border-blue-200 rounded-full pl-2 pr-1 py-0.5">
                  {i + 1}번
                  <button type="button" onClick={() => setRects(prev => prev.filter((_, k) => k !== i))} className="p-0.5 rounded-full hover:bg-blue-100 cursor-pointer" title="이 네모 지우기"><X className="w-3 h-3" /></button>
                </span>
              ))}
              <button type="button" onClick={() => setRects([])} className="underline text-slate-600 hover:text-slate-900 cursor-pointer">모두 지우기</button>
            </div>
          )}

          {err && <p className="text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{err}</p>}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 shrink-0 bg-white">
          <button type="button" disabled={busy} onClick={onClose} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 cursor-pointer disabled:opacity-50">취소</button>
          <button type="button" disabled={busy || !bmp} onClick={apply} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 cursor-pointer disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <EyeOff className="w-3.5 h-3.5" />}
            {busy ? '저장하는 중...' : '가린 사진으로 바꾸기'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
