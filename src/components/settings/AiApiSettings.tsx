import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Globe, 
  Cpu, 
  Sliders, 
  CheckCircle2, 
  ShieldCheck, 
  Save, 
  Server, 
  Layers, 
  FileCheck2, 
  Image as ImageIcon, 
  Check,
  AlertCircle
} from 'lucide-react';
import { AiApiSettingsConfig, AiProvider, User, isDeskUser } from '../../types';
import { supabase } from '../../lib/supabase';
import { AiUsageStats } from './AiUsageStats';
import { GoogleCloudKeyBox } from './GoogleCloudKeyBox';
import { SttModelBox } from './SttModelBox';
import { FunctionModelsBox } from './FunctionModelsBox';
import { getMyAiKeyLast4, saveMyAiKey, clearMyAiKey, maskLast4, testSavedAiKey, getMyAiPrefs, setMyAiPrefs } from '../../services/aiKey';

// 기능별 모델 선택 목록 (한 곳에서만 관리)
// 2026-10 기준 공식 문서에서 확인한 모델 이름. 새 모델이 나오면 이 두 줄만 고치면 됩니다.
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-4-argon', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview'];
const FEATURE_GEMINI_MODELS = GEMINI_MODELS;

export const MODEL_DESCRIPTIONS: Record<string, string> = {
  'gemini-4-argon': '구글 최신 최상위 모델입니다. 가장 정확하지만 비용이 더 듭니다. 복잡한 기획 기사 검토에 알맞습니다.',
  'gemini-3.8-flash': '기본값 · 한국어 문맥 분석과 사실관계 검증에 알맞은 표준 모델입니다. 속도와 정확도의 균형이 좋습니다.',
  'gemini-3.6-flash': '이전 세대의 빠른 모델입니다. 3.8이 느리거나 막힐 때 대신 쓰기 좋습니다.',
  'gemini-3.5-flash-lite': '가볍고 값이 싼 모델입니다. 맞춤법처럼 단순한 검사에 알맞습니다.',
  'gemini-3.1-flash-lite': '가장 가벼운 모델입니다. 실시간 문장 진단처럼 빠른 응답이 필요할 때 씁니다.',
  'gemini-3.1-pro-preview': '시험판 프로 모델입니다. 긴 기획 기사의 논리 흐름 검토에 쓰며, 예고 없이 바뀔 수 있습니다.',
  'gpt-6.1-sol': 'OpenAI 상위 모델입니다. 정확도가 높고 비용도 높습니다.',
  'gpt-6-sol': 'OpenAI 상위 모델입니다. 복잡한 작업에 알맞습니다.',
  'gpt-6-luna': '기본값 · OpenAI 효율형 모델입니다. 값이 싸고 빨라서 일상 기사 검토에 알맞습니다.',
  'gpt-5.6-luna': '비용을 아끼고 싶을 때 쓰는 OpenAI 모델입니다.',
  'gpt-5.4-mini': '가벼운 OpenAI 모델입니다. 간단한 검사에 알맞습니다.',
  'gpt-4o': '이전 세대 모델입니다. 새 모델이 안 되는 경우에만 쓰세요.',
  'gpt-4o-mini': '이전 세대의 가벼운 모델입니다.',
  'claude-opus-5-5': 'Anthropic이 권하는 기본 모델입니다. 긴 글 분석과 정확한 검토에 강합니다.',
  'claude-sonnet-5-5': '기본값 · 속도와 정확도의 균형이 좋은 Claude 모델입니다.',
  'claude-haiku-5-5': '가장 빠르고 값이 싼 Claude 모델입니다. 단순 검사에 알맞습니다.',
  'claude-fable-5-1': '가장 강력한 Claude 모델입니다. 아주 어려운 분석에만 쓰세요. 비용이 가장 높습니다.',
};

const PROVIDER_DEFAULTS: Record<AiProvider, { endpoint: string; defaultModel: string; models: string[] }> = {
  'Google Gemini': {
    endpoint: 'Supabase Edge Functions (review-article-content, analyze-media-image)',
    defaultModel: 'gemini-3.8-flash',
    models: GEMINI_MODELS,
  },
  'OpenAI': {
    endpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-6-luna',
    models: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-luna', 'gpt-5.4-mini', 'gpt-4o-mini'],
  },
  'Anthropic': {
    endpoint: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-5-5',
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
  },
  'Custom API': {
    endpoint: 'https://api.example.com/v1',
    defaultModel: 'custom-newsroom-llm-v1',
    models: ['custom-newsroom-llm-v1', 'editorial-v2-dense'],
  },
};

const DEFAULT_SETTINGS: AiApiSettingsConfig = {
  provider: 'Google Gemini',
  apiEndpoint: 'Supabase Edge Functions',
  apiKey: '',
  model: 'gemini-3.8-flash',
  temperature: 0.2,
  maxTokens: 4096,
  functionModels: {
    informationCheck: {
      provider: 'Google Gemini',
      model: 'gemini-3.8-flash',
    },
    spellingGrammar: {
      provider: 'Google Gemini',
      model: 'gemini-3.8-flash',
    },
    imageAnalysis: {
      provider: 'Google Gemini',
      model: 'gemini-3.8-flash',
    },
    factCheck: {
      provider: 'Google Gemini',
      model: 'gemini-3.8-flash',
    },
    missingInfoQuestion: {
      provider: 'Google Gemini',
      model: 'gemini-3.8-flash',
    },
  },
};

interface AiApiSettingsProps {
  currentUser?: User;
}

export const AiApiSettings: React.FC<AiApiSettingsProps> = ({ currentUser }) => {
  const [settings, setSettings] = useState<AiApiSettingsConfig>(() => {
    try {
      const saved = localStorage.getItem('press_ai_api_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        delete parsed.apiKey;
        return { ...DEFAULT_SETTINGS, ...parsed, apiKey: '' };
      }
    } catch {
      // ignore
    }
    return DEFAULT_SETTINGS;
  });

  // 내 개인 AI 키 (공급자별, 내 계정에 암호화되어 저장. 화면에는 뒤 4자리만 표시)
  const [myKey, setMyKey] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 공급자를 바꾸면 그 공급자에 등록된 내 키를 불러옴
  useEffect(() => {
    let alive = true;
    setKeyInput('');
    setKeyMsg(null);
    getMyAiKeyLast4(settings.provider).then(k => { if (alive) setMyKey(k); });
    return () => { alive = false; };
  }, [settings.provider]);

  const persistMyPrefs = async () => {
    await setMyAiPrefs({
      provider: settings.provider,
      model: settings.model,
      endpoint: settings.provider === 'Custom API' ? (settings.apiEndpoint || '') : '',
    });
  };

  const handleSaveMyKey = async () => {
    setKeyBusy(true);
    setKeyMsg(null);
    try {
      const check = await saveMyAiKey(
        {
          provider: settings.provider,
          model: settings.model,
          endpoint: settings.provider === 'Custom API' ? (settings.apiEndpoint || '') : '',
        },
        keyInput,
      );
      setMyKey(keyInput.trim().slice(-4));
      setKeyInput('');
      setKeyMsg({ ok: true, text: check.unverified ? check.message : '키를 확인하고 내 계정에 안전하게 저장했습니다. 다른 컴퓨터에서 로그인해도 그대로 쓸 수 있습니다.' });
    } catch (e: any) {
      setKeyMsg({ ok: false, text: e?.message || '키를 저장하지 못했습니다.' });
    } finally {
      setKeyBusy(false);
    }
  };

  // 키는 그대로 두고 공급자·모델·주소만 바꿔 저장
  const handleSaveMyPrefs = async () => {
    setKeyBusy(true);
    try {
      await persistMyPrefs();
      setKeyMsg({ ok: true, text: '내 공급자와 모델 설정을 저장했습니다.' });
    } catch (e: any) {
      setKeyMsg({ ok: false, text: e?.message || '저장하지 못했습니다.' });
    } finally {
      setKeyBusy(false);
    }
  };

  const handleTestMyKey = async () => {
    setKeyBusy(true);
    const check = await testSavedAiKey(settings.provider, settings.provider === 'Custom API' ? (settings.apiEndpoint || '') : '');
    setKeyMsg({ ok: check.ok, text: check.message });
    setKeyBusy(false);
  };

  const handleRemoveMyKey = async () => {
    setKeyBusy(true);
    try {
      await clearMyAiKey(settings.provider);
      setMyKey('');
      setKeyMsg({ ok: true, text: '내 계정에 저장된 키를 지웠습니다.' });
    } catch (e: any) {
      setKeyMsg({ ok: false, text: e?.message || '키를 지우지 못했습니다.' });
    } finally {
      setKeyBusy(false);
    }
  };

  const [articleReviewModel, setArticleReviewModel] = useState<string>('gemini-3.8-flash');
  const [mediaAnalysisModel, setMediaAnalysisModel] = useState<string>('gemini-3.8-flash');
  const [articleGenerationModel, setArticleGenerationModel] = useState<string>('gemini-3.8-flash');
  const [isSaved, setIsSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 권한 체크: 데스크(부장/차장/데스크에디터/편집국장) 권한 사용자만 AI 전체 모델 설정 변경 가능
  const isAuthorized = Boolean(isDeskUser(currentUser));

  // DB에서 최신 AI 시스템 설정 조회 (새로고침 유지 및 다중 사용자 동기화)
  useEffect(() => {
    let isMounted = true;
    const fetchDbSettings = async () => {
      const prefs = await getMyAiPrefs();
      try {
        const { data, error } = await supabase
          .from('ai_system_settings')
          .select('*')
          .eq('id', 'default')
          .maybeSingle();

        if (!error && data && isMounted) {
          setSettings(prev => ({
            ...prev,
            model: prefs ? prev.model : (data.active_model || prev.model),
          }));
          setArticleReviewModel(data.article_review_model || data.active_model || 'gemini-3.8-flash');
          setMediaAnalysisModel(data.media_analysis_model || data.active_model || 'gemini-3.8-flash');
          setArticleGenerationModel(data.article_generation_model || data.active_model || 'gemini-3.8-flash');
        }
      } catch (err) {
        console.warn('[AiApiSettings] DB 설정 로드 실패 (fallback 사용):', err);
      }
    };

    fetchDbSettings().then(() => {
      // 내가 저장해 둔 공급자·모델·주소가 있으면 그것을 우선 적용
      getMyAiPrefs().then(prefs => {
        if (prefs && isMounted) {
          setSettings(prev => ({
            ...prev,
            provider: prefs.provider,
            model: prefs.model || PROVIDER_DEFAULTS[prefs.provider].defaultModel,
            apiEndpoint: prefs.provider === 'Custom API' ? (prefs.endpoint || PROVIDER_DEFAULTS['Custom API'].endpoint) : PROVIDER_DEFAULTS[prefs.provider].endpoint,
          }));
        }
      });
    });
    return () => { isMounted = false; };
  }, []);

  // 공급자 변경 핸들러
  const handleProviderChange = (newProvider: AiProvider) => {
    const config = PROVIDER_DEFAULTS[newProvider];
    setSettings(prev => ({
      ...prev,
      provider: newProvider,
      apiEndpoint: config.endpoint,
      model: config.defaultModel,
    }));
  };

  // 설정 저장 핸들러
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);

    if (!isAuthorized) {
      setSaveError('AI 시스템 모델 설정은 데스크(부장·차장) 권한 사용자만 변경할 수 있습니다.');
      return;
    }

    try {
      // 1. Supabase DB 영구 저장
      const { error: dbError } = await supabase
        .from('ai_system_settings')
        .update({
          active_model: settings.model,
          article_review_model: articleReviewModel,
          media_analysis_model: mediaAnalysisModel,
          article_generation_model: articleGenerationModel,
          updated_at: new Date().toISOString(),
          updated_by: currentUser?.id,
        })
        .eq('id', 'default');

      if (dbError) {
        console.warn('[AiApiSettings] DB 업데이트 실패:', dbError);
      }

      // 2. 로컬 스토리지 캐시 영구 저장
      const { apiKey: _omittedKey, ...safeSettings } = settings;
      localStorage.setItem('press_ai_api_settings', JSON.stringify({
        ...safeSettings,
        apiKey: '',
        model: settings.model,
        articleReviewModel,
        mediaAnalysisModel,
        articleGenerationModel,
      }));

      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2500);
    } catch (err: any) {
      setSaveError(err.message || '설정 저장 중 오류가 발생했습니다.');
    }
  };

  return (
    <div className="space-y-6">
      {/* 상단 배너 / 안내 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <Sparkles className="w-5 h-5 text-blue-600" />
            <span>AI 서비스 설정 (AI Service Settings)</span>
            <span className="text-[12px] font-mono font-medium px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
              Personal API Key
            </span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            AI 기능(AI 검수, AI 초안, 인포그래픽, 사진 분석)은 각자 등록한 개인 AI 키로 동작합니다. 키를 등록하지 않으면 AI 기능을 쓸 수 없습니다.</p>
        </div>

        {isSaved && (
          <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded text-xs font-bold animate-fade-in shadow-xs">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>AI 모델 설정이 서버와 로컬에 안전하게 저장되었습니다!</span>
          </div>
        )}

        {saveError && (
          <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-50 text-rose-800 border border-rose-300 rounded text-xs font-bold animate-fade-in shadow-xs">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <span>{saveError}</span>
          </div>
        )}
      </div>

      {/* 권한 안내 (일반 기자일 경우) */}
      {!isAuthorized && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center space-x-2 text-xs text-amber-900">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>기본 운영 모델 및 기능별 라우팅 설정 변경은 데스크 및 부장/차장 권한 사용자만 수행할 수 있습니다. (현재 읽기 전용)</span>
        </div>
      )}

      {/* 보안 아키텍처 상태 카드 */}
      <div className="p-4 bg-slate-900 text-white rounded-lg border border-slate-800 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold tracking-wide text-slate-200 uppercase">
              Security Architecture
            </span>
          </div>
          <span className="text-[12px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
            Personal Key · Encrypted
          </span>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          개인 AI 키는 내 계정에 암호화(AES-GCM)되어 서버에 저장되며, 화면과 브라우저로는 다시 돌아오지 않습니다. AI를 부를 때 서버 함수가 내 키를 직접 꺼내 쓰고, 호출 시 클라이언트의 Supabase JWT를 기반으로 <strong className="text-white">can_access_article</strong> 권한을 검증합니다.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-2 text-[12px] font-mono text-slate-400">
          <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60 flex items-center space-x-2">
            <Server className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="truncate">review-article-content</span>
          </div>
          <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60 flex items-center space-x-2">
            <Server className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">analyze-media-image</span>
          </div>
          <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60 flex items-center space-x-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Key Encrypted At Rest</span>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6 text-xs text-slate-700">
        {/* CARD 1: Provider & Active Model */}
        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center space-x-2">
              <Cpu className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-bold text-slate-900">
                1. 기본 LLM 공급자 및 운영 모델 (Active Model)
              </h3>
            </div>
            <span className="text-[12px] text-slate-400 font-mono">Google DeepMind</span>
          </div>

          {/* Provider Selection */}
          <div className="space-y-2">
            <label className="block font-semibold text-slate-700">
              AI 인프라 공급자 (Provider)
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {(['Google Gemini', 'OpenAI', 'Anthropic', 'Custom API'] as AiProvider[]).map((prov) => {
                const isSelected = settings.provider === prov;
                const isAvailable = true;

                return (
                  <button
                    key={prov}
                    type="button"
                    disabled={!isAvailable}
                    onClick={() => handleProviderChange(prov)}
                    className={`p-3 text-left rounded-lg border transition-all text-xs cursor-pointer ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/70 text-blue-950 font-bold shadow-2xs ring-1 ring-blue-500/30'
                        : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{prov}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-blue-600" />}
                    </div>
                    <span className="text-[12px] text-slate-400 block mt-1">
                      {prov === 'Google Gemini' && 'Gemini 3.8 Flash'}
                      {prov === 'OpenAI' && 'GPT-6 Luna / Sol'}
                      {prov === 'Anthropic' && 'Claude Sonnet / Opus 5.5'}
                      {prov === 'Custom API' && '사내 LLM 엔드포인트'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 내 개인 AI 키 (선택한 공급자 기준) */}
          <div className="p-4 rounded-lg border border-blue-200 bg-blue-50/40 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-blue-600" />
                내 {settings.provider} 키 (API Key)
              </span>
              <span className={`text-[12px] font-bold px-2 py-0.5 rounded border ${myKey ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-amber-50 text-amber-900 border-amber-300'}`}>
                {myKey ? `등록됨 (${maskLast4(myKey)})` : '아직 등록 안 됨'}
              </span>
            </div>
            <p className="leading-relaxed text-slate-700">
              AI 기능(AI 검수·AI 초안·인포그래픽·사진 분석)은 <strong>내가 등록한 키</strong>로 동작하고, 사용 비용도 내 계정에서 나갑니다.
              키는 <strong>내 계정에 암호화되어 저장</strong>되므로 회사 컴퓨터 등 다른 곳에서 로그인해도 다시 입력하지 않아도 됩니다.
              화면에는 뒤 4자리만 보이며, 키 전체는 다시 불러올 수 없습니다.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={myKey ? '새 키로 바꾸려면 여기에 붙여 넣기' : '발급받은 키를 여기에 붙여 넣기'}
                className="flex-1 min-w-0 border border-slate-300 rounded px-3 py-2 text-xs text-slate-800 placeholder:text-slate-500 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="button"
                disabled={keyBusy || !keyInput.trim()}
                onClick={handleSaveMyKey}
                className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50 shrink-0"
              >
                {keyBusy ? '확인 중...' : '확인 후 저장'}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" disabled={keyBusy} onClick={handleSaveMyPrefs} className="underline text-slate-800 hover:text-slate-950 cursor-pointer disabled:opacity-50">공급자·모델만 저장</button>
              {myKey && <button type="button" disabled={keyBusy} onClick={handleTestMyKey} className="underline text-slate-800 hover:text-slate-950 cursor-pointer disabled:opacity-50">키 다시 확인</button>}
              {myKey && <button type="button" disabled={keyBusy} onClick={handleRemoveMyKey} className="underline text-rose-700 hover:text-rose-900 cursor-pointer disabled:opacity-50">지우기</button>}
            </div>
            {keyMsg && (
              <p className={`rounded border p-2 ${keyMsg.ok ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-rose-700 bg-rose-50 border-rose-200'}`}>
                {keyMsg.text}
              </p>
            )}
          </div>

          {/* Endpoint Info & Active Model */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                서버 엔드포인트 아키텍처
              </label>
              <div className="relative">
                <Globe className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  readOnly={settings.provider !== 'Custom API'}
                  value={settings.apiEndpoint || 'Supabase Edge Functions'}
                  onChange={(e) => setSettings({ ...settings, apiEndpoint: e.target.value })}
                  placeholder="https://사내-llm-주소/v1"
                  className={`w-full pl-8 pr-3 py-2 border border-slate-300 rounded font-mono text-xs ${
                    settings.provider === 'Custom API' ? 'bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500' : 'bg-slate-100 text-slate-600 cursor-not-allowed'
                  }`}
                />
              </div>
              <span className="text-[12px] text-slate-400 mt-1 block">
                {settings.provider === 'Custom API'
                  ? '사내 LLM 주소를 https:// 로 입력하세요. OpenAI 방식(/chat/completions)과 호환되어야 하며, 사내망 전용 주소는 서버에서 접근할 수 없습니다.'
                  : '서버 함수(Edge Function)를 통해 로그인·권한을 확인한 뒤 내 키로 안전하게 호출됩니다.'}
              </span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                내가 쓸 모델 (Active Model)
              </label>
              <div className="relative">
                <Cpu className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                {settings.provider === 'Custom API' ? (
                  <input
                    value={settings.model}
                    onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                    placeholder="사내 모델 이름"
                    className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded font-mono text-xs text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                ) : (
                  <select
                    value={settings.model}
                    onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                    className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded font-mono text-xs text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                  >
                    {Array.from(new Set([...(PROVIDER_DEFAULTS[settings.provider]?.models || []), settings.model]))
                      .filter(Boolean)
                      .map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                  </select>
                )}
              </div>
              <span className="text-[12px] text-blue-700 font-sans mt-1 block">
                {MODEL_DESCRIPTIONS[settings.model] || `${settings.provider} 환경에서 기사 검토 및 작업에 사용할 기본 언어 모델입니다.`}
              </span>
            </div>
          </div>

          {/* Temperature & Max Tokens Slider */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-700 flex items-center space-x-1">
                  <Sliders className="w-3.5 h-3.5 text-slate-500" />
                  <span>Temperature (온도)</span>
                </label>
                <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-white border border-slate-300 text-blue-600">
                  {settings.temperature.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0.0"
                max="1.0"
                step="0.05"
                disabled={!isAuthorized}
                value={settings.temperature}
                onChange={(e) => setSettings({ ...settings, temperature: parseFloat(e.target.value) })}
                className="w-full accent-blue-600 cursor-pointer disabled:cursor-not-allowed"
              />
              <div className="flex justify-between text-[12px] text-slate-400">
                <span>0.0 (엄격·정확한 팩트체크 권장)</span>
                <span>1.0 (창의적 질문)</span>
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-700">
                  Max Tokens (최대 출력 토큰)
                </label>
                <div className="flex space-x-1">
                  {[2048, 4096, 8192].map((tokens) => (
                    <button
                      key={tokens}
                      type="button"
                      disabled={!isAuthorized}
                      onClick={() => setSettings({ ...settings, maxTokens: tokens })}
                      className={`px-1.5 py-0.5 rounded text-[12px] font-mono font-medium transition-colors ${
                        settings.maxTokens === tokens
                          ? 'bg-blue-600 text-white font-bold'
                          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-50'
                      }`}
                    >
                      {tokens}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="number"
                min="512"
                max="32768"
                step="512"
                disabled={!isAuthorized}
                value={settings.maxTokens}
                onChange={(e) => setSettings({ ...settings, maxTokens: parseInt(e.target.value) || 4096 })}
                className="w-full p-1.5 bg-white border border-slate-300 rounded font-mono text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100"
              />
              <span className="text-[12px] text-slate-400 block">
                장문 기획 취재 원고 분석 시 4096 이상의 토큰 설정이 권장됩니다.
              </span>
            </div>
          </div>
        </div>

        {/* CARD 2: 기능별 AI (사람마다 따로 저장, 실제 AI 호출에 반영) */}
        <FunctionModelsBox
          modelsByProvider={{
            'Google Gemini': PROVIDER_DEFAULTS['Google Gemini'].models,
            'OpenAI': PROVIDER_DEFAULTS['OpenAI'].models,
            'Anthropic': PROVIDER_DEFAULTS['Anthropic'].models,
          }}
          defaultModelByProvider={{
            'Google Gemini': PROVIDER_DEFAULTS['Google Gemini'].defaultModel,
            'OpenAI': PROVIDER_DEFAULTS['OpenAI'].defaultModel,
            'Anthropic': PROVIDER_DEFAULTS['Anthropic'].defaultModel,
          }}
        />

        {/* Action Button: Save */}
        <div className="flex items-center justify-end space-x-3 pt-1">
          <button
            type="submit"
            id="btn-save-ai-settings"
            disabled={!isAuthorized}
            className={`px-6 py-2.5 rounded-md font-bold text-xs shadow-sm flex items-center space-x-2 transition-colors ${
              isAuthorized
                ? 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            <Save className="w-4 h-4" />
            <span>설정 저장</span>
          </button>
        </div>
      </form>

      <SttModelBox />
      <GoogleCloudKeyBox />

      <AiUsageStats />
    </div>
  );
};
