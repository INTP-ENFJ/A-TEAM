import React, { useEffect, useState } from 'react';
import { Layers, FileCheck2, Image as ImageIcon, Sparkles, Check, AlertCircle } from 'lucide-react';
import {
  AiProviderName, AiFeatureName, FunctionModels,
  getMyFunctionModels, setMyFunctionModels, getMyKeyProviders,
} from '../../services/aiKey';

// 기능별로 AI 회사·모델을 따로 고르는 상자 (내 계정에 저장, 사람마다 다르게 쓸 수 있음)
// 비워 두면(= "기본 설정 따르기") 위 1번에서 고른 AI를 그대로 씁니다.

type FeatureProvider = Exclude<AiProviderName, 'Custom API'>;
const FEATURE_PROVIDERS: FeatureProvider[] = ['Google Gemini', 'OpenAI', 'Anthropic'];

const FEATURES: { id: AiFeatureName; title: string; tag: string; desc: string; icon: React.ReactNode; color: string }[] = [
  {
    id: 'review',
    title: '기사 종합 검수 & 교열',
    tag: 'Article Review',
    desc: 'AI 검수(맞춤법·비문·제목과 본문·표기법)에 쓰입니다.',
    icon: <FileCheck2 className="w-4 h-4" />,
    color: 'bg-blue-100 text-blue-800',
  },
  {
    id: 'media',
    title: '보도사진 이미지 분석',
    tag: 'Media Vision Analysis',
    desc: '사진 설명·캡션 제안에 쓰입니다. (AI 이미지 만들기는 따로 이미지 모델을 씁니다)',
    icon: <ImageIcon className="w-4 h-4" />,
    color: 'bg-emerald-100 text-emerald-800',
  },
  {
    id: 'draft',
    title: '질문형 인터뷰 초안 생성 & 요약',
    tag: 'Interview & Draft Generation',
    desc: 'AI 초안, 원자료 정리, 녹음 요약, 인포그래픽 숫자 뽑기에 쓰입니다.',
    icon: <Sparkles className="w-4 h-4" />,
    color: 'bg-purple-100 text-purple-800',
  },
];

interface Props {
  modelsByProvider: Record<FeatureProvider, string[]>;
  defaultModelByProvider: Record<FeatureProvider, string>;
}

export const FunctionModelsBox: React.FC<Props> = ({ modelsByProvider, defaultModelByProvider }) => {
  const [fm, setFm] = useState<FunctionModels>({});
  const [keyProviders, setKeyProviders] = useState<AiProviderName[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([getMyFunctionModels(), getMyKeyProviders()]).then(([f, k]) => {
      if (!alive) return;
      setFm(f);
      setKeyProviders(k);
    });
    return () => { alive = false; };
  }, []);

  const changeProvider = (id: AiFeatureName, value: string) => {
    setMsg(null);
    setFm(prev => {
      const next = { ...prev };
      if (!value) delete next[id];
      else {
        const p = value as FeatureProvider;
        next[id] = { provider: p, model: defaultModelByProvider[p] };
      }
      return next;
    });
  };

  const changeModel = (id: AiFeatureName, model: string) => {
    setMsg(null);
    setFm(prev => (prev[id] ? { ...prev, [id]: { ...prev[id]!, model } } : prev));
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await setMyFunctionModels(fm);
      setMsg({ ok: true, text: '기능별 AI를 내 계정에 저장했습니다. 다음 AI 호출부터 적용됩니다.' });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || '저장하지 못했습니다.' });
    } finally {
      setBusy(false);
    }
  };

  const selectCls = 'font-mono text-xs font-semibold px-2 py-1 rounded border border-slate-300 bg-white text-slate-800';

  return (
    <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center space-x-2">
          <Layers className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-900">2. AI 기능별 모델 (내 설정)</h3>
        </div>
        <span className="text-[12px] text-slate-500">사람마다 다르게 고를 수 있습니다</span>
      </div>

      <p className="text-[12px] text-slate-700 bg-slate-50 border border-slate-200 rounded-md p-2.5 leading-5">
        기능마다 다른 AI를 쓸 수 있습니다. 예: 검수는 Claude, 초안은 Gemini.
        "기본 설정 따르기"로 두면 위 1번에서 고른 AI를 씁니다. 고른 AI 회사의 키가 등록되어 있지 않으면 기본 설정으로 대신 동작합니다.
      </p>

      <div className="space-y-3">
        {FEATURES.map(f => {
          const cur = fm[f.id];
          const curProvider = cur?.provider as FeatureProvider | undefined;
          const models = curProvider ? modelsByProvider[curProvider] : [];
          const modelList = cur && !models.includes(cur.model) ? [cur.model, ...models] : models;
          const noKey = curProvider && !keyProviders.includes(curProvider);
          return (
            <div key={f.id} className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-start space-x-2.5">
                <div className={`w-7 h-7 rounded-md ${f.color} flex items-center justify-center shrink-0 mt-0.5`}>{f.icon}</div>
                <div>
                  <div className="font-bold text-xs text-slate-900 flex items-center space-x-1.5">
                    <span>{f.title}</span>
                    <span className="text-[12px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 font-normal">{f.tag}</span>
                  </div>
                  <p className="text-[12px] text-slate-600 mt-0.5">{f.desc}</p>
                  {noKey && (
                    <p className="text-[12px] text-amber-800 mt-1">
                      {curProvider} 키가 등록되어 있지 않아, 지금은 기본 설정으로 동작합니다. 위 1번에서 이 회사의 키를 등록해 주세요.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <select
                  aria-label={`${f.title} AI 회사`}
                  value={curProvider || ''}
                  onChange={(e) => changeProvider(f.id, e.target.value)}
                  className={selectCls}
                >
                  <option value="">기본 설정 따르기</option>
                  {FEATURE_PROVIDERS.map(p => (
                    <option key={p} value={p}>{p}{keyProviders.includes(p) ? '' : ' (키 없음)'}</option>
                  ))}
                </select>
                {cur && (
                  <select
                    aria-label={`${f.title} 모델`}
                    value={cur.model}
                    onChange={(e) => changeModel(f.id, e.target.value)}
                    className={selectCls}
                  >
                    {modelList.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-3">
        {msg && (
          <span className={`text-xs flex items-center gap-1 ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
            {msg.ok ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
            {msg.text}
          </span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="px-4 py-2 rounded-md font-bold text-xs bg-blue-600 hover:bg-blue-500 text-white disabled:bg-slate-300"
        >
          {busy ? '저장 중…' : '기능별 AI 저장'}
        </button>
      </div>
    </div>
  );
};
