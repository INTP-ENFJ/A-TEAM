/**
 * 받아쓰기(STT) 모델 목록과 내 선택 저장.
 * - 글쓰기 모델과 따로 고릅니다. (글쓰기 모델이 막혀도 받아쓰기는 계속 되도록)
 * - 새 모델이 나오면 아래 STT_MODELS 한 곳만 고치면 [녹음 정리] 화면과 환경설정이 같이 바뀝니다.
 * - 2026-10 기준 공식 문서에서 확인한 이름입니다. 직접 시험하지 못한 모델은 note에 적어 두었습니다.
 */
import type { SttEngine, SttMode } from './rawDataService';

export type DiarizeLevel = 'good' | 'basic' | 'none';

export interface SttModelInfo {
  id: string;
  label: string;
  diarize: DiarizeLevel;
  note: string;
}

export const STT_MODELS: Record<'gemini' | 'openai', SttModelInfo[]> = {
  gemini: [
    { id: 'gemini-3.8-flash', label: 'gemini-3.8-flash', diarize: 'basic', note: '기본값 · 일반 모델이 듣고 받아 적습니다. 화자는 AI가 듣고 나눕니다.' },
    { id: 'gemini-3.6-flash', label: 'gemini-3.6-flash', diarize: 'basic', note: '3.8이 막힐 때 대신 쓰는 일반 모델입니다. (2026-10-16 시험 통과)' },
  ],
  openai: [
    { id: 'gpt-4o-transcribe-diarize', label: 'gpt-4o-transcribe-diarize', diarize: 'good', note: '화자 구분 전용 모델입니다. 다만 한국어 인식이 약해 한국어 녹음을 영어로 잘못 적은 적이 있습니다(10-16 시험). 한국어 인터뷰는 Gemini를 권장합니다.' },
    { id: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe', diarize: 'none', note: '정확한 받아쓰기 모델입니다. 화자는 나누지 못합니다.' },
    { id: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe', diarize: 'none', note: '값이 싼 받아쓰기 모델입니다. 화자는 나누지 못합니다.' },
    { id: 'gpt-transcribe', label: 'gpt-transcribe', diarize: 'none', note: '최신 받아쓰기 모델입니다. 아직 시험하지 못했습니다. 화자는 나누지 못합니다.' },
    { id: 'whisper-1', label: 'whisper-1', diarize: 'none', note: '예전부터 쓰던 받아쓰기 모델입니다. 화자는 나누지 못합니다.' },
  ],
};

export const DIARIZE_BADGE: Record<DiarizeLevel, { text: string; cls: string }> = {
  good: { text: '화자 구분 가능', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  basic: { text: '화자 구분 가능 (정확도 보통)', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  none: { text: '화자 구분 불가', cls: 'bg-slate-200 text-slate-700 border-slate-300' },
};

/** 구글 클라우드는 모델을 따로 고르지 않고, 화자 구분은 가능합니다 */
export const GOOGLE_CLOUD_DIARIZE: DiarizeLevel = 'good';

export function modelsFor(engine: SttEngine): SttModelInfo[] {
  return engine === 'googlecloud' ? [] : STT_MODELS[engine];
}

export function findModel(engine: SttEngine, id: string | undefined): SttModelInfo | undefined {
  return modelsFor(engine).find(m => m.id === id);
}

/** 인터뷰에서 화자를 나눌 수 있는 모델만 */
export function diarizeCapableModels(engine: SttEngine): SttModelInfo[] {
  return modelsFor(engine).filter(m => m.diarize !== 'none');
}

export function diarizeLevelOf(engine: SttEngine, modelId: string | undefined): DiarizeLevel {
  if (engine === 'googlecloud') return GOOGLE_CLOUD_DIARIZE;
  return findModel(engine, modelId)?.diarize ?? 'none';
}

// ----- 내 선택 저장 (이 컴퓨터의 브라우저에 저장) -----
type Saved = { gemini?: string; openaiSpeech?: string; openaiInterview?: string };
const KEY = 'press_stt_models';

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : {};
  } catch {
    return {};
  }
}

/** 지금 방식(발표/인터뷰)에서 쓸 모델. 저장된 값이 없거나 목록에 없으면 기본값 */
export function getSttModel(engine: SttEngine, mode: SttMode): string | undefined {
  if (engine === 'googlecloud') return undefined;
  const s = load();
  const saved = engine === 'gemini' ? s.gemini : mode === 'interview' ? s.openaiInterview : s.openaiSpeech;
  if (saved && findModel(engine, saved)) return saved;
  if (engine === 'gemini') return 'gemini-3.8-flash';
  return mode === 'interview' ? 'gpt-4o-transcribe-diarize' : 'gpt-4o-transcribe';
}

export function setSttModel(engine: SttEngine, mode: SttMode, id: string): void {
  if (engine === 'googlecloud') return;
  const s = load();
  if (engine === 'gemini') s.gemini = id;
  else if (mode === 'interview') s.openaiInterview = id;
  else s.openaiSpeech = id;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* 저장소를 못 쓰면 이번 한 번만 적용 */ }
}
