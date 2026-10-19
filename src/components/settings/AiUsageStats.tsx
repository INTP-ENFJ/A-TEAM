import React, { useEffect, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Row {
  fn: string;
  provider: string;
  model: string;
  calls: number;
  ok_calls: number;
  avg_latency_ms: number;
  avg_out_chars: number;
}

const FN_LABEL: Record<string, string> = {
  'ai-interview-draft': 'AI 초안 작성',
  'review-article-content': 'AI 검수',
  'analyze-media-image': '사진 분석',
  'extract-infographic-data': '인포그래픽 재료',
  'organize-raw-data': '원자료 정리',
  'transcribe-audio': '녹음 변환',
  'generate-image': 'AI 이미지',
};
const PROVIDER_LABEL: Record<string, string> = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude', custom: '사내 API' };

/** 최근 30일 AI 사용 현황 (기능·모델별 호출 수, 성공률, 평균 응답 시간). 내용과 사용자는 기록하지 않음 */
export const AiUsageStats: React.FC = () => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { data, error } = await supabase.rpc('ai_call_summary', { p_days: 30 });
      if (error) throw error;
      setRows(Array.isArray(data) ? (data as Row[]) : []);
    } catch {
      setErr('사용 현황을 불러오지 못했습니다. (SQL 적용 전이거나 권한이 없을 수 있어요)');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="p-4 rounded-lg border border-slate-200 bg-white space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">
          <BarChart3 className="w-4 h-4 text-blue-600" /> AI 사용 현황 (최근 30일, 팀 전체)
        </span>
        <button type="button" onClick={load} disabled={busy} className="text-[12px] underline text-slate-700 cursor-pointer disabled:opacity-50 flex items-center gap-1">
          <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} /> 새로고침
        </button>
      </div>
      {err && <p className="text-[12px] text-rose-700">{err}</p>}
      {rows && rows.length === 0 && <p className="text-[12px] text-slate-700">아직 기록이 없습니다. AI 기능을 쓰면 여기에 쌓입니다.</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] text-slate-800">
            <thead>
              <tr className="text-left text-slate-600 border-b border-slate-200">
                <th className="py-1 pr-2 font-semibold">기능</th>
                <th className="py-1 pr-2 font-semibold">공급자·모델</th>
                <th className="py-1 pr-2 font-semibold text-right">호출</th>
                <th className="py-1 pr-2 font-semibold text-right">성공률</th>
                <th className="py-1 pr-2 font-semibold text-right">평균 응답</th>
                <th className="py-1 font-semibold text-right">평균 결과 길이</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1 pr-2">{FN_LABEL[r.fn] || r.fn}</td>
                  <td className="py-1 pr-2 font-mono">{PROVIDER_LABEL[r.provider] || r.provider} · {r.model}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{r.calls}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{r.calls ? Math.round((r.ok_calls / r.calls) * 100) : 0}%</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{(r.avg_latency_ms / 1000).toFixed(1)}초</td>
                  <td className="py-1 text-right tabular-nums">{r.avg_out_chars.toLocaleString()}자</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[12px] text-slate-600">호출 횟수·성공 여부·걸린 시간만 기록하며, 입력한 글이나 사용자 이름은 저장하지 않습니다. 모델을 바꿔 쓰며 성능을 비교할 때 참고하세요.</p>
    </div>
  );
};
