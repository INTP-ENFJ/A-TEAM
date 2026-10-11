import { getAiKeyHeaders } from '../../services/aiKey';
import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Plus, Trash2, BarChart3, Loader2, ImagePlus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  InfographicData,
  InfographicStyle,
  drawInfographic,
  canvasToFile,
  extractLocal,
  normalizeData,
} from './infographic';
import { PanelHeader, PANEL_BTN_PRIMARY } from './PanelHeader';

interface Props {
  articleTitle: string;
  paragraphs: string[];
  /** 만든 그림을 기사 맨 아래에 넣는다 */
  onInsertImage: (file: File) => Promise<void>;
}

const STYLES: { value: InfographicStyle; label: string }[] = [
  { value: 'bar', label: '가로 막대' },
  { value: 'column', label: '세로 막대' },
  { value: 'cards', label: '큰 숫자 카드' },
];

export const InfographicPanel: React.FC<Props> = ({ articleTitle, paragraphs, onInsertImage }) => {
  const [data, setData] = useState<InfographicData>({ title: '', unit: '', items: [] });
  const [style, setStyle] = useState<InfographicStyle>('bar');
  const [busy, setBusy] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 처음 열 때 기사 제목으로 시작 (탭을 옮겨도 입력한 내용은 유지됨 - 창이 다시 열릴 때만 초기화)
  useEffect(() => {
    setData(d => (d.title ? d : { ...d, title: articleTitle || '' }));
  }, [articleTitle]);

  // 값이 바뀔 때마다 미리보기 다시 그리기
  useEffect(() => {
    if (canvasRef.current) drawInfographic(canvasRef.current, data, style);
  }, [data, style]);

  const bodyText = paragraphs.join('\n');

  const handleExtract = async () => {
    setBusy(true);
    setNotice(null);
    try {
      if (bodyText.trim().length < 20) {
        setNotice('기사 본문이 아직 너무 짧아요. 글을 조금 더 쓴 뒤 다시 눌러 주세요.');
        return;
      }
      let result: InfographicData | null = null;
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        const { data: res, error } = await supabase.functions.invoke('extract-infographic-data', {
          body: { title: articleTitle, text: bodyText },
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(await getAiKeyHeaders()) },
        });
        if (!error && res?.success) {
          result = normalizeData(res.data, articleTitle);
        }
      } catch {
        result = null;
      }

      if (result && result.items.length >= 2) {
        setData(result);
        setNotice('AI가 기사에서 숫자를 뽑았어요. 틀린 곳이 있으면 직접 고쳐 주세요.');
      } else {
        // AI를 쓸 수 없거나 결과가 없을 때: 이 화면에서 간단히 직접 뽑기
        const local = extractLocal(articleTitle, paragraphs);
        if (local.items.length >= 1) {
          setData(local);
          setNotice('AI를 쓸 수 없어 기사에서 숫자를 간단히 뽑았어요. 이름표와 숫자를 꼭 확인해 주세요.');
        } else {
          setNotice('기사에서 비교할 숫자를 찾지 못했어요. 아래에서 직접 입력할 수도 있어요.');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const updateItem = (idx: number, patch: Partial<{ label: string; value: number }>) =>
    setData(d => ({ ...d, items: d.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));

  const handleInsert = async () => {
    if (!canvasRef.current || data.items.length === 0) return;
    setInserting(true);
    try {
      drawInfographic(canvasRef.current, data, style);
      const file = await canvasToFile(canvasRef.current, `인포그래픽_${Date.now()}.png`);
      await onInsertImage(file);
      setNotice('기사 맨 아래에 인포그래픽을 넣었어요. 위치는 끌어서 옮길 수 있어요.');
    } catch (e: any) {
      setNotice(e?.message || '기사에 넣지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setInserting(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 text-slate-700">
      <PanelHeader
        icon={<BarChart3 className="w-4 h-4" />}
        title="AI 인포그래픽"
        subtitle="기사 속 숫자를 차트 그림으로 만들어 기사에 넣습니다"
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        <button
          type="button"
          disabled={busy}
          onClick={handleExtract}
          className={`${PANEL_BTN_PRIMARY} w-full justify-center py-2 text-xs`}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {busy ? '기사에서 숫자 찾는 중...' : '기사에서 숫자 뽑기'}
        </button>
        {notice && <p className="text-[11px] text-slate-600 bg-white border border-slate-200 rounded p-2">{notice}</p>}

        {/* 미리보기 */}
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-1 p-0.5 bg-slate-100 rounded-md text-[11px] font-semibold">
            {STYLES.map(s => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStyle(s.value)}
                className={`py-1 rounded cursor-pointer ${style === s.value ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
            <canvas ref={canvasRef} className="w-full h-auto block" style={{ aspectRatio: '16 / 9' }} />
          </div>
        </div>

        {/* 입력 */}
        <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-3">
          <label className="block">
            <span className="font-semibold text-slate-700">그림 제목</span>
            <input
              value={data.title}
              onChange={(e) => setData(d => ({ ...d, title: e.target.value }))}
              maxLength={60}
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>
          <label className="block">
            <span className="font-semibold text-slate-700">단위 (예: %, 명, 억 원)</span>
            <input
              value={data.unit}
              onChange={(e) => setData(d => ({ ...d, unit: e.target.value }))}
              maxLength={10}
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-slate-700">숫자 목록</span>
              <button
                type="button"
                disabled={data.items.length >= 8}
                onClick={() => setData(d => ({ ...d, items: [...d.items, { label: '', value: 0 }] }))}
                className="flex items-center gap-1 text-blue-600 hover:underline disabled:text-slate-500 cursor-pointer"
              >
                <Plus className="w-3 h-3" /> 항목 추가
              </button>
            </div>
            <div className="space-y-1.5">
              {data.items.length === 0 && (
                <p className="text-[11px] text-slate-600">위 버튼으로 뽑거나 [항목 추가]로 직접 넣어 주세요.</p>
              )}
              {data.items.map((it, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    value={it.label}
                    placeholder="이름표"
                    maxLength={20}
                    onChange={(e) => updateItem(i, { label: e.target.value })}
                    className="flex-1 min-w-0 border border-slate-300 rounded px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    value={Number.isFinite(it.value) ? it.value : 0}
                    onChange={(e) => updateItem(i, { value: parseFloat(e.target.value) || 0 })}
                    className="w-24 border border-slate-300 rounded px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setData(d => ({ ...d, items: d.items.filter((_, k) => k !== i) }))}
                    className="p-1 text-slate-500 hover:text-rose-600 cursor-pointer"
                    title="이 항목 지우기"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="text-[11px] text-slate-600">
          ※ AI가 뽑은 숫자는 반드시 기사 내용과 맞는지 확인하세요. 만든 그림은 기사 맨 아래에 사진으로 들어가며, 끌어서 옮길 수 있습니다.
        </p>
      </div>

      <div className="px-4 py-3 border-t border-slate-200 bg-white shrink-0">
        <button
          type="button"
          disabled={inserting || data.items.length === 0}
          onClick={handleInsert}
          className={`${PANEL_BTN_PRIMARY} w-full justify-center py-2 text-xs`}
        >
          {inserting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
          {inserting ? '넣는 중...' : '기사에 넣기'}
        </button>
      </div>
    </div>
  );
};
