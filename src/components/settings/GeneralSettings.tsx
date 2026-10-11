import React, { useState } from 'react';
import { 
  SlidersHorizontal, 
  Sparkles, 
  Check, 
  Save, 
  Clock
} from 'lucide-react';
import { User } from '../../types';

interface GeneralSettingsProps {
  currentUser: User;
}

export const GeneralSettings: React.FC<GeneralSettingsProps> = () => {
  const [aiSensitivity, setAiSensitivity] = useState<'strict' | 'standard' | 'lenient'>('standard');
  const [useCustomDictionary, setUseCustomDictionary] = useState(true);
  const [requireBalancedCheck, setRequireBalancedCheck] = useState(true);
  const [autoSaveInterval, setAutoSaveInterval] = useState('realtime');
  const [isSaved, setIsSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <SlidersHorizontal className="w-5 h-5 text-blue-600" />
            <span>일반 편집 환경 설정 (General Settings)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            기사 작성 자동 저장 간격, 보도 윤리 검토 규칙 및 사내 사전 기준을 구성합니다.
          </p>
        </div>

        {isSaved && (
          <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded text-xs font-bold animate-fade-in shadow-xs">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>설정이 저장되었습니다!</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-6 text-xs text-slate-700">
        {/* Editorial Standards */}
        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center space-x-2 text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <h3>1. AI 보조 검토 규칙 및 엄격도</h3>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                정보 확인 및 사실 검증 엄격도 (Information Check Sensitivity)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { id: 'strict', label: '엄격 (권장)', desc: '공식 통계, 법안 번호, 날짜, 직함 전수 대조' },
                  { id: 'standard', label: '표준', desc: '주요 수치 및 고유명사 핵심 대조' },
                  { id: 'lenient', label: '완화', desc: '명백한 오류만 경고 제안' },
                ].map((s) => (
                  <div
                    key={s.id}
                    onClick={() => setAiSensitivity(s.id as any)}
                    className={`p-2.5 rounded-md border cursor-pointer transition-all ${
                      aiSensitivity === s.id
                        ? 'border-slate-800 bg-slate-100 text-slate-900 font-medium ring-1 ring-slate-800'
                        : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                    }`}
                  >
                    <div className="font-bold text-xs">{s.label}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{s.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Toggles */}
            <div className="space-y-2 pt-2">
              <label className="flex items-start space-x-2.5 cursor-pointer p-2 rounded-md hover:bg-slate-50 transition-colors">
                <input
                  type="checkbox"
                  checked={useCustomDictionary}
                  onChange={(e) => setUseCustomDictionary(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <div>
                  <span className="font-semibold text-slate-800">사내 고유 언론 표준 용어집 우선 적용</span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    국립국어원 표준국어대사전 외에 언론사 자체 외래어 표기 및 경제/정치 전문 용어 사전을 우선 적용합니다.
                  </p>
                </div>
              </label>

              <label className="flex items-start space-x-2.5 cursor-pointer p-2 rounded-md hover:bg-slate-50 transition-colors">
                <input
                  type="checkbox"
                  checked={requireBalancedCheck}
                  onChange={(e) => setRequireBalancedCheck(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <div>
                  <span className="font-semibold text-slate-800">균형 보도 및 누락 정보 질문 활성화</span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    여야 쟁점 사안 및 정책 보도 시 반대 의견 또는 재원 대책이 누락된 경우 기자에게 AI 질문 카드를 제시합니다.
                  </p>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Auto Save & Interface Settings */}
        <div className="bg-white p-5 rounded-md border border-slate-200 shadow-2xs space-y-4">
          <div className="flex items-center space-x-2 text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            <Clock className="w-4 h-4 text-slate-600" />
            <h3>2. 원고 자동 저장 및 에디터 편의성</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">자동 저장 주기</label>
              <select
                value={autoSaveInterval}
                onChange={(e) => setAutoSaveInterval(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 shadow-2xs"
              >
                <option value="realtime">실시간 타이핑 즉시 (권장)</option>
                <option value="30s">30초 주기</option>
                <option value="1m">1분 주기</option>
              </select>
              <span className="text-[10px] text-slate-400 mt-1 block">
                키보드 단축키 Ctrl+S / Cmd+S로도 언제든 즉시 저장이 가능합니다.
              </span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">기본 본문 폰트 설정</label>
              <select className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 shadow-2xs">
                <option value="serif">명조체 (신문 보도 표준 한국어 폰트)</option>
                <option value="sans">고딕체 (디지털 웹 친화 폰트)</option>
              </select>
              <span className="text-[10px] text-slate-400 mt-1 block">
                에디터 편집 화면 및 독자 뷰어에 기본 적용될 글꼴입니다.
              </span>
            </div>
          </div>
        </div>


        <div className="flex items-center justify-end space-x-3 pt-1">
          <button
            type="submit"
            id="btn-save-general-settings"
            className="px-6 py-2 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white rounded-md font-bold text-xs shadow-2xs flex items-center space-x-2 transition-colors cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>설정 저장</span>
          </button>
        </div>
      </form>
    </div>
  );
};
