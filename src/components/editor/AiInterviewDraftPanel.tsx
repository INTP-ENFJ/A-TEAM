import { friendlyAiError } from '../../services/aiErrors';
import { getAiKeyHeaders, getSttKeyStatus } from '../../services/aiKey';
import {
  readRawTextFile, organizeRawData, formatOrganizedMemo, RAW_FILE_EXTENSIONS,
  fetchWebSource, formatWebMemo, transcribeAudioFile, AUDIO_EXTENSIONS, STT_LANGUAGE_LABEL,
  type OrganizedRawData, type OrganizeMeta, type SttLanguage, type SttMode, type SttEngine,
} from '../../services/rawDataService';
import React, { useState, useEffect, useRef } from 'react';
import { checkEvidence, summarizeEvidence, EvidenceSegment, EvidenceSource } from './evidenceCheck';
import { PanelHeader } from './PanelHeader';
import {
  Sparkles,
  Send,
  MessageSquare,
  Bot,
  User as UserIcon,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  RefreshCw,
  Plus,
  ArrowRight,
  ChevronRight,
  FileText,
  FileCheck,
  Check,
  X,
  RotateCcw,
  SlidersHorizontal,
  BookmarkPlus
} from 'lucide-react';
import { User } from '../../types';
import { supabase } from '../../lib/supabase';

export interface FiveW1HState {
  who: string | null;
  what: string | null;
  when: string | null;
  where: string | null;
  why: string | null;
  how: string | null;
}

export interface QuoteItem {
  speaker: string;
  quote: string;
}

export interface KeyFigureItem {
  label: string;
  value: string;
}

export interface DraftState {
  topic: string;
  keywords: string[];
  five_w1h: FiveW1HState;
  quotes: QuoteItem[];
  key_figures: KeyFigureItem[];
  open_gaps: string[];
  title_candidates: string[];
  lead_paragraph: string | null;
  body_blocks: string[];
}

export interface ConversationItem {
  role: 'ai' | 'reporter';
  content: string;
  created_at: string;
}

interface AiInterviewDraftPanelProps {
  articleId: string;
  currentTitle?: string;
  currentUser: User;
  onApplyBlocks: (paragraphs: string[]) => Promise<void>;
  onApplyTitle?: (title: string) => void;
  onClose?: () => void;
  /** 좁은 오른쪽 창에서 쓸 때: 대화와 미리보기를 탭으로 나눠 보여줌 */
  compact?: boolean;
  showToast?: (message: string) => void;
}

export const AiInterviewDraftPanel: React.FC<AiInterviewDraftPanelProps> = ({
  articleId,
  currentTitle = '',
  currentUser: _currentUser,
  onApplyBlocks,
  onApplyTitle,
  compact = false,
  showToast,
}) => {
  // 세션 상태
  const [compactView, setCompactView] = useState<'chat' | 'draft'>('chat');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<'collecting' | 'finalized'>('collecting');
  const [draftState, setDraftState] = useState<DraftState>({
    topic: currentTitle || '',
    keywords: [],
    five_w1h: { who: null, what: null, when: null, where: null, why: null, how: null },
    quotes: [],
    key_figures: [],
    open_gaps: ['who', 'what', 'when', 'where', 'why', 'how'],
    title_candidates: [],
    lead_paragraph: null,
    body_blocks: [],
  });
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [isReadyToFinalize, setIsReadyToFinalize] = useState(false);

  // 기사 톤 선택 상태 (스트레이트/해설/인터뷰/피처)
  const [selectedTone, setSelectedTone] = useState<'straight' | 'explanatory' | 'interview' | 'feature'>('straight');

  // 입력 폼 상태 (초기 인터뷰 시작용)
  const [topicInput, setTopicInput] = useState(currentTitle || '');
  const [keywordsInput, setKeywordsInput] = useState('');
  const [rawNotesInput, setRawNotesInput] = useState('');

  // 원자료 정리 (파일 불러오기 → AI 정리 → 메모에 넣기)
  const rawFileRef = useRef<HTMLInputElement | null>(null);
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [organized, setOrganized] = useState<{ data: OrganizedRawData; meta: OrganizeMeta } | null>(null);
  const [rawBeforeOrganize, setRawBeforeOrganize] = useState<string | null>(null);
  // 웹 주소에서 가져오기 / 녹음 받아쓰기
  const audioFileRef = useRef<HTMLInputElement | null>(null);
  const [showWebInput, setShowWebInput] = useState(false);
  const [webUrlInput, setWebUrlInput] = useState('');
  const [isFetchingWeb, setIsFetchingWeb] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showAudioPanel, setShowAudioPanel] = useState(false);
  const [sttLanguage, setSttLanguage] = useState<SttLanguage>('ko');
  const [sttMode, setSttMode] = useState<SttMode>('speech');
  const [sttSpeakers, setSttSpeakers] = useState('');
  const [sttEngine, setSttEngine] = useState<SttEngine>('gemini');
  const [sttKeys, setSttKeys] = useState<{ gemini: boolean; openai: boolean; googlecloud: boolean; active: string } | null>(null);
  const [sttProgress, setSttProgress] = useState('');
  // 인터뷰 받아쓰기 직후: 화자 이름 바꾸기 (현재 표기 → 입력한 이름)
  const [speakerNames, setSpeakerNames] = useState<{ current: string; input: string }[]>([]);

  // 대화 중 답변 입력
  const [showEvidence, setShowEvidence] = useState(true);
  const [answerInput, setAnswerInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(true);

  // 섹션 재작성 피드백 모달 상태
  const [regenTarget, setRegenTarget] = useState<{ type: 'lead' | 'block'; index: number } | null>(null);
  const [regenFeedback, setRegenFeedback] = useState('');
  const [isRegenerating, setIsRegenerating] = useState(false);

  // 초안 전체 수정 지시
  const [reviseInput, setReviseInput] = useState('');
  const [isRevising, setIsRevising] = useState(false);

  // 적용 완료 체크 표시
  const [appliedBlockIndices, setAppliedBlockIndices] = useState<Set<number>>(new Set());
  const [isLeadApplied, setIsLeadApplied] = useState(false);

  // 근거 문장 표시: 초안 문장이 기자가 준 자료에서 나왔는지 글자 비교
  const evidenceSources: EvidenceSource[] = [
    ...conversation
      .filter((c) => c.role === 'reporter')
      .map((c, i) => ({ label: `답변 ${i + 1}`, text: c.content })),
    ...(rawNotesInput.trim() ? [{ label: '취재 메모', text: rawNotesInput }] : []),
    {
      label: '수집 팩트',
      text: [
        ...draftState.quotes.map((q) => `${q.quote} ${q.speaker}`),
        ...draftState.key_figures.map((k) => `${k.label} ${k.value}`),
        ...Object.values(draftState.five_w1h || {}).map((v) => (v ? String(v) : '')),
      ].join(' '),
    },
  ];
  const leadEvidence: EvidenceSegment[] = draftState.lead_paragraph
    ? checkEvidence(draftState.lead_paragraph, evidenceSources)
    : [];
  const blockEvidence: EvidenceSegment[][] = draftState.body_blocks.map((b) => checkEvidence(b, evidenceSources));
  const evidenceSummary = summarizeEvidence([leadEvidence, ...blockEvidence]);
  const renderEvidence = (segs: EvidenceSegment[], plain: string) =>
    !showEvidence
      ? plain
      : segs.map((seg, i) =>
          seg.status === 'neutral' ? (
            <span key={i}>{seg.text}</span>
          ) : (
            <span
              key={i}
              title={seg.note}
              className={
                seg.status === 'supported'
                  ? 'bg-emerald-100/70 rounded-sm'
                  : 'bg-amber-200/80 underline decoration-dotted decoration-amber-700 rounded-sm'
              }
            >
              {seg.text}
            </span>
          )
        );

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // 1. 기존 세션 복원
  useEffect(() => {
    let isMounted = true;
    const fetchExistingSession = async () => {
      try {
        setIsLoadingSession(true);
        const { data, error } = await supabase
          .from('ai_draft_sessions')
          .select('*')
          .eq('article_id', articleId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data && isMounted) {
          setSessionId(data.id);
          setSessionStatus(data.status as any);
          if (data.draft_state) {
            setDraftState(data.draft_state as DraftState);
            if (data.draft_state.topic) {
              setTopicInput(data.draft_state.topic);
            }
          }
          if (Array.isArray(data.conversation)) {
            setConversation(data.conversation as ConversationItem[]);
          }
          if (data.status === 'finalized' || (data.draft_state?.body_blocks && data.draft_state.body_blocks.length > 0)) {
            setIsReadyToFinalize(true);
          }
        }
      } catch (err) {
        console.warn('[AiInterviewDraftPanel] 세션 로드 실패:', err);
      } finally {
        if (isMounted) setIsLoadingSession(false);
      }
    };

    fetchExistingSession();
    return () => { isMounted = false; };
  }, [articleId]);

  // 대화 목록 스크롤 이동
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation]);

  // 5W1H 완성도 계산 (0 ~ 100%)
  const completed5W1HCount = Object.values(draftState.five_w1h).filter(Boolean).length;
  const progressPercent = Math.round((completed5W1HCount / 6) * 100);

  // Edge Function 호출 공통 헬퍼
  const invokeDraftFunction = async (payload: any) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    const { data, error } = await supabase.functions.invoke('ai-interview-draft', {
      body: payload,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(await getAiKeyHeaders()) },
    });

    if (error) {
      console.error('[AiInterviewDraftPanel] Edge Function error:', error);
      throw new Error(await friendlyAiError(error));
    }

    if (!data || !data.success) {
      throw new Error(data?.error || 'AI 응답 처리에 실패했습니다.');
    }

    return data;
  };

  // 2. 인터뷰 시작 (Start)
  const handleStartInterview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicInput.trim()) {
      showToast?.('취재 주제를 입력해주세요.');
      return;
    }

    try {
      setIsSubmitting(true);
      const keywords = keywordsInput
        .split(',')
        .map(k => k.trim())
        .filter(Boolean);

      const res = await invokeDraftFunction({
        action: 'start',
        articleId,
        topic: topicInput.trim(),
        keywords,
        rawNotes: rawNotesInput.trim(),
        tone: selectedTone,
      });

      if (res.sessionId) setSessionId(res.sessionId);
      if (res.draftState) setDraftState(res.draftState);
      if (res.conversation) setConversation(res.conversation);
      setIsReadyToFinalize(Boolean(res.readyToFinalize));
      showToast?.('AI 인터뷰가 시작되었습니다. 질문에 답변해주세요.');
    } catch (err: any) {
      showToast?.(`인터뷰 시작 실패: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 2-1. 원자료 파일 불러오기
  const handleRawFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await readRawTextFile(file);
      setRawNotesInput(prev => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
      setOrganized(null);
      showToast?.(`"${file.name}" 내용을 불러왔습니다. [AI로 정리하기]를 눌러 보세요.`);
    } catch (err: any) {
      showToast?.(err?.message || '파일을 불러오지 못했습니다.');
    }
  };

  // 2-1b. 웹 주소에서 글 가져오기 (출처·수집일 자동 기재)
  const handleFetchWeb = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!webUrlInput.trim() || isFetchingWeb) return;
    try {
      setIsFetchingWeb(true);
      const src = await fetchWebSource(webUrlInput.trim());
      const memo = formatWebMemo(src);
      setRawNotesInput(prev => (prev.trim() ? `${prev.trim()}\n\n${memo}` : memo));
      setOrganized(null);
      setWebUrlInput('');
      setShowWebInput(false);
      showToast?.(`"${src.title || src.host}" 내용을 가져왔습니다.${src.truncated ? ' (길어서 앞부분만)' : ''}`);
    } catch (err: any) {
      showToast?.(err?.message || '웹 자료를 가져오지 못했습니다.');
    } finally {
      setIsFetchingWeb(false);
    }
  };

  // 2-1c. 녹음 받아쓰기 설정 열기 (등록된 키 확인 후 기본 엔진 고르기)
  const toggleAudioPanel = async () => {
    const next = !showAudioPanel;
    setShowAudioPanel(next);
    if (!next) return;
    try {
      const st = await getSttKeyStatus();
      setSttKeys(st);
      const order: SttEngine[] = [];
      if (st.active === 'gemini' || st.active === 'openai') order.push(st.active);
      order.push('gemini', 'openai', 'googlecloud');
      const pick = order.find(e => st[e]);
      if (pick) setSttEngine(pick);
    } catch {
      setSttKeys(null);
    }
  };

  // 2-1d. 녹음 파일을 글자로 받아 적기
  const handleAudioFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || isTranscribing) return;
    try {
      setIsTranscribing(true);
      setSpeakerNames([]);
      setSttProgress('');
      showToast?.('녹음을 글자로 바꾸는 중입니다. 길면 몇 분 걸릴 수 있어요.');
      const speakers = Number(sttSpeakers);
      const res = await transcribeAudioFile(
        file,
        {
          engine: sttEngine,
          language: sttLanguage,
          mode: sttMode,
          speakers: sttMode === 'interview' && Number.isInteger(speakers) && speakers >= 2 && speakers <= 6 ? speakers : undefined,
        },
        (done, total) => setSttProgress(total > 1 ? `${done}/${total} 조각 처리` : ''),
      );
      const kind = sttMode === 'interview' ? '인터뷰' : '발표';
      const memo = `[녹음 받아쓰기 · ${STT_LANGUAGE_LABEL[sttLanguage]} · ${kind}] ${file.name}\n${res.text}`;
      if (conversation.length > 0) {
        // 인터뷰가 이미 시작된 뒤에는 받아쓴 글을 답변 칸에 넣어 확인 후 보내게 한다
        const flat = res.text.replace(/\s*\n+\s*/g, ' ').trim();
        setAnswerInput(prev => (prev.trim() ? `${prev.trim()} ${flat}` : flat));
        showToast?.('받아쓴 글을 답변 칸에 넣었습니다. 잘못 들은 곳이 없는지 고친 뒤 보내 주세요.');
        return;
      }
      setRawNotesInput(prev => (prev.trim() ? `${prev.trim()}\n\n${memo}` : memo));
      setOrganized(null);
      if (res.diarized) {
        const found = Array.from(new Set(Array.from(res.text.matchAll(/^(화자\d+):/gm)).map(m => m[1])));
        setSpeakerNames(found.map(c => ({ current: c, input: '' })));
      }
      showToast?.(res.notes.length ? res.notes.join(' ') : '받아쓰기가 끝났습니다. 잘못 들은 곳이 없는지 확인해 주세요.');
    } catch (err: any) {
      showToast?.(err?.message || '녹음을 글자로 바꾸지 못했습니다.');
    } finally {
      setIsTranscribing(false);
      setSttProgress('');
    }
  };

  // 화자 이름 바꾸기: 메모 안의 "화자1:" 줄머리를 입력한 이름으로 바꾼다
  const applySpeakerNames = () => {
    let text = rawNotesInput;
    const nextNames = speakerNames.map(sp => {
      const name = sp.input.trim().replace(/[:\n\r]/g, '').slice(0, 20);
      if (!name || name === sp.current) return sp;
      const escaped = sp.current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`^${escaped}:`, 'gm'), `${name}:`);
      return { current: name, input: '' };
    });
    setRawNotesInput(text);
    setSpeakerNames(nextNames);
    setOrganized(null);
  };

  // 녹음 받아쓰기 옵션 창 (취재 정보 입력 화면과 답변 입력 화면에서 같이 사용)
  const audioPanelJsx = (
                      <div className="mt-1.5 p-2.5 rounded-lg border border-slate-300 bg-slate-50 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-[11px] font-bold text-slate-700">
                            말하는 언어
                            <select
                              value={sttLanguage}
                              onChange={(e) => setSttLanguage(e.target.value as SttLanguage)}
                              className="mt-0.5 w-full text-xs p-1.5 bg-white border border-slate-300 rounded cursor-pointer"
                            >
                              {(Object.keys(STT_LANGUAGE_LABEL) as SttLanguage[]).map(l => (
                                <option key={l} value={l}>{STT_LANGUAGE_LABEL[l]}</option>
                              ))}
                            </select>
                          </label>
                          <label className="text-[11px] font-bold text-slate-700">
                            받아쓰기 방식
                            <select
                              value={sttMode}
                              onChange={(e) => setSttMode(e.target.value as SttMode)}
                              className="mt-0.5 w-full text-xs p-1.5 bg-white border border-slate-300 rounded cursor-pointer"
                            >
                              <option value="speech">발표·강연 (한 사람)</option>
                              <option value="interview">인터뷰 (화자 나누기)</option>
                            </select>
                          </label>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-[11px] font-bold text-slate-700">
                            받아쓰기 엔진
                            <select
                              value={sttEngine}
                              onChange={(e) => setSttEngine(e.target.value as SttEngine)}
                              className="mt-0.5 w-full text-xs p-1.5 bg-white border border-slate-300 rounded cursor-pointer"
                            >
                              <option value="gemini">Gemini{sttKeys && !sttKeys.gemini ? ' (키 없음)' : ''}</option>
                              <option value="openai">OpenAI{sttKeys && !sttKeys.openai ? ' (키 없음)' : ''}</option>
                              <option value="googlecloud">구글 클라우드{sttKeys && !sttKeys.googlecloud ? ' (키 없음)' : ''}</option>
                            </select>
                          </label>
                          {sttMode === 'interview' && (
                            <label className="text-[11px] font-bold text-slate-700">
                              말하는 사람 수 (선택)
                              <select
                                value={sttSpeakers}
                                onChange={(e) => setSttSpeakers(e.target.value)}
                                className="mt-0.5 w-full text-xs p-1.5 bg-white border border-slate-300 rounded cursor-pointer"
                              >
                                <option value="">모름</option>
                                {[2, 3, 4, 5, 6].map(n => <option key={n} value={String(n)}>{n}명</option>)}
                              </select>
                            </label>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-600">
                          Claude는 소리를 들을 수 없어 받아쓰기에는 위 세 엔진만 쓸 수 있습니다. 엔진별 키는 환경설정 → AI 서비스 설정에서 등록합니다.
                          {sttEngine === 'googlecloud'
                            ? ' 구글 클라우드는 30분·60MB까지, 1분 단위로 나눠 처리합니다.'
                            : ' Gemini·OpenAI는 10MB까지 올릴 수 있습니다.'}
                          {sttMode === 'interview' ? ' 화자 구분은 완벽하지 않을 수 있으니 결과를 꼭 확인해 주세요.' : ''}
                        </p>
                        <button
                          type="button"
                          onClick={() => audioFileRef.current?.click()}
                          disabled={isTranscribing || (!!sttKeys && !sttKeys[sttEngine])}
                          className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50"
                        >
                          녹음 파일 고르고 시작
                        </button>
                        {sttKeys && !sttKeys[sttEngine] && (
                          <p className="text-[10px] text-red-700 font-bold">이 엔진의 키가 등록되어 있지 않습니다. 환경설정에서 먼저 등록해 주세요.</p>
                        )}
                      </div>
  );

  // 2-2. 원자료를 AI로 정리
  const handleOrganizeRaw = async () => {
    if (isOrganizing) return;
    try {
      setIsOrganizing(true);
      const res = await organizeRawData(rawNotesInput, topicInput.trim());
      setOrganized(res);
    } catch (err: any) {
      showToast?.(`원자료 정리 실패: ${err.message}`);
    } finally {
      setIsOrganizing(false);
    }
  };

  const handleUseOrganized = () => {
    if (!organized) return;
    setRawBeforeOrganize(rawNotesInput);
    setRawNotesInput(formatOrganizedMemo(organized.data));
    setOrganized(null);
    showToast?.('정리본을 취재 메모에 넣었습니다. 내용을 확인한 뒤 인터뷰를 시작하세요.');
  };

  // 3. 답변 전송 (Answer)
  const handleSendAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answerInput.trim() || isSubmitting) return;

    const currentAnswer = answerInput.trim();
    setAnswerInput('');

    try {
      setIsSubmitting(true);
      const res = await invokeDraftFunction({
        action: 'answer',
        articleId,
        sessionId,
        answerText: currentAnswer,
        tone: selectedTone,
      });

      if (res.draftState) setDraftState(res.draftState);
      if (res.conversation) setConversation(res.conversation);
      if (typeof res.readyToFinalize === 'boolean') {
        setIsReadyToFinalize(res.readyToFinalize);
      }
    } catch (err: any) {
      showToast?.(`답변 전송 실패: ${err.message}`);
      setAnswerInput(currentAnswer);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 4. 초안 정리 및 최종 조립 (Finalize)
  const handleFinalizeDraft = async () => {
    try {
      setIsSubmitting(true);
      const res = await invokeDraftFunction({
        action: 'finalize',
        articleId,
        sessionId,
        tone: selectedTone,
      });

      if (res.draftState) setDraftState(res.draftState);
      if (res.conversation) setConversation(res.conversation);
      setSessionStatus('finalized');
      setIsReadyToFinalize(true);
      showToast?.('수집된 사실을 바탕으로 기사 초안이 완성되었습니다!');
    } catch (err: any) {
      showToast?.(`초안 조립 실패: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 5. 섹션 재작성 (Regenerate Section)
  const handleRegenerateSectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regenTarget || !regenFeedback.trim() || isRegenerating) return;

    try {
      setIsRegenerating(true);
      const res = await invokeDraftFunction({
        action: 'regenerate_section',
        articleId,
        sessionId,
        sectionType: regenTarget.type,
        sectionIndex: regenTarget.index,
        feedbackText: regenFeedback.trim(),
        tone: selectedTone,
      });

      if (res.draftState) setDraftState(res.draftState);
      if (res.conversation) setConversation(res.conversation);
      setRegenTarget(null);
      setRegenFeedback('');
      showToast?.('피드백을 반영하여 해당 문단을 다시 작성했습니다.');
    } catch (err: any) {
      showToast?.(`재작성 실패: ${err.message}`);
    } finally {
      setIsRegenerating(false);
    }
  };

  // 5-2. 초안 전체 수정 지시 (예: "전체를 더 짧게", "제목을 덜 자극적으로")
  const handleReviseDraft = async (text: string) => {
    const instruction = text.trim();
    if (!instruction || isRevising) return;
    try {
      setIsRevising(true);
      const res = await invokeDraftFunction({
        action: 'revise_draft',
        articleId,
        sessionId,
        instructionText: instruction,
        tone: selectedTone,
      });
      if (res.draftState) setDraftState(res.draftState);
      if (res.conversation) setConversation(res.conversation);
      setReviseInput('');
      // 내용이 바뀌었으므로 "본문에 넣음" 표시 초기화
      setAppliedBlockIndices(new Set());
      setIsLeadApplied(false);
      showToast?.('지시를 반영해 초안을 다시 작성했습니다.');
    } catch (err: any) {
      showToast?.(`수정 지시 실패: ${err.message}`);
    } finally {
      setIsRevising(false);
    }
  };

  // 6. 본문 블록에 단일 삽입
  const handleApplySingleBlock = async (text: string, index: number, isLead = false) => {
    try {
      await onApplyBlocks([text]);
      if (isLead) {
        setIsLeadApplied(true);
      } else {
        setAppliedBlockIndices(prev => new Set([...prev, index]));
      }
      showToast?.('기사 본문에 문단이 안전하게 추가되었습니다.');
    } catch (err: any) {
      showToast?.(`본문 적용 실패: ${err.message}`);
    }
  };

  // 7. 전체 초안 일괄 삽입
  const handleApplyAllDraft = async () => {
    const allParagraphs: string[] = [];
    if (draftState.lead_paragraph) {
      allParagraphs.push(draftState.lead_paragraph);
    }
    if (draftState.body_blocks && draftState.body_blocks.length > 0) {
      allParagraphs.push(...draftState.body_blocks);
    }

    if (allParagraphs.length === 0) {
      showToast?.('적용할 초안 내용이 없습니다.');
      return;
    }

    try {
      await onApplyBlocks(allParagraphs);
      setIsLeadApplied(true);
      const allIndices = new Set(draftState.body_blocks.map((_, i) => i));
      setAppliedBlockIndices(allIndices);
      showToast?.(`초안 ${allParagraphs.length}개 문단이 본문에 모두 추가되었습니다.`);
    } catch (err: any) {
      showToast?.(`본문 일괄 적용 실패: ${err.message}`);
    }
  };

  if (isLoadingSession) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-600 space-y-3">
        <RefreshCw className="w-6 h-6 animate-spin text-purple-600" />
        <span className="text-xs font-semibold">AI 취재 인터뷰 세션을 불러오는 중...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* 1. 상단 패널 헤더 */}
      <PanelHeader
        icon={<Sparkles className="w-4 h-4" />}
        title="AI 초안 작성"
        subtitle="기자가 입력한 사실만으로 육하원칙 초안을 조립합니다"
        badge={<span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">기자 작성 보조</span>}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* 기사 톤 선택 드롭다운 */}
          <div className="flex items-center space-x-1.5">
            <label htmlFor="select-article-tone" className="text-[11px] font-bold text-slate-600 hidden sm:inline">
              기사 톤:
            </label>
            <select
              id="select-article-tone"
              value={selectedTone}
              onChange={(e) => setSelectedTone(e.target.value as any)}
              className="text-xs font-semibold bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer shadow-2xs"
              title="조립할 기사의 어조와 스타일을 선택합니다"
            >
              <option value="straight">스트레이트 (사실·두괄식)</option>
              <option value="explanatory">해설·분석 (맥락·심층)</option>
              <option value="interview">인터뷰 (문답·발언 중심)</option>
              <option value="feature">피처·르포 (현장 묘사)</option>
            </select>
          </div>

          {/* 5W1H 수집 진행도 */}
          <div className="flex items-center space-x-2">
            <span className="text-[11px] font-bold text-slate-600">수집 진행:</span>
            <div className="w-16 bg-slate-200 rounded-full h-2 overflow-hidden">
              <div
                className="bg-purple-600 h-2 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-[11px] font-extrabold text-purple-700">{progressPercent}%</span>
          </div>

        </div>
        {compact && (
          <div className="mt-2.5 grid grid-cols-2 gap-1 p-0.5 bg-slate-100 rounded-md text-[11px] font-semibold">
            <button type="button" onClick={() => setCompactView('chat')} className={`py-1 rounded cursor-pointer ${compactView === 'chat' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'}`}>인터뷰 대화</button>
            <button type="button" onClick={() => setCompactView('draft')} className={`py-1 rounded cursor-pointer ${compactView === 'draft' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'}`}>초안 미리보기</button>
          </div>
        )}
      </PanelHeader>

      {/* 2. 메인 바디 레이아웃 (대화창 + 실시간 초안 미리보기) */}
      <div className={compact ? 'flex-1 overflow-hidden flex flex-col' : 'flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-200'}>
        {/* [좌측 7컬럼]: AI 인터뷰 채팅 영역 */}
        <div className={`md:col-span-7 flex flex-col h-full bg-slate-50 ${compact && compactView === 'draft' ? 'hidden' : ''}`}>
          {/* 대화 내역 스크롤 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {conversation.length === 0 ? (
              /* 최초 시작 폼 */
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-4">
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-slate-900 flex items-center space-x-1.5">
                    <FileText className="w-4 h-4 text-purple-600" />
                    <span>취재 기본 정보 입력</span>
                  </h4>
                  <p className="text-[11px] text-slate-700 font-medium">
                    취재하고자 하는 핵심 주제와 메모를 입력하시면 AI가 맞춤형 질문을 시작합니다.
                  </p>
                </div>

                <form onSubmit={handleStartInterview} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      취재 주제 / 가제 <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={topicInput}
                      onChange={(e) => setTopicInput(e.target.value)}
                      placeholder="예: 서울시 대중교통 심야할증 개편안 발표"
                      className="w-full text-xs p-2 bg-white border border-slate-300 rounded-lg placeholder:text-slate-600 font-medium focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      핵심 키워드 (쉼표 구분)
                    </label>
                    <input
                      type="text"
                      value={keywordsInput}
                      onChange={(e) => setKeywordsInput(e.target.value)}
                      placeholder="예: 서울시, 심야버스, 요금인상, 택시업계"
                      className="w-full text-xs p-2 bg-white border border-slate-300 rounded-lg placeholder:text-slate-600 font-medium focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      기사 어조 및 서술 톤
                    </label>
                    <select
                      value={selectedTone}
                      onChange={(e) => setSelectedTone(e.target.value as any)}
                      className="w-full text-xs p-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer"
                    >
                      <option value="straight">스트레이트 (사실·두괄식 역피라미드)</option>
                      <option value="explanatory">해설·분석 (배경 맥락 및 다각도 심층 분석)</option>
                      <option value="interview">인터뷰 (취재원 문답 및 핵심 발언 부각)</option>
                      <option value="feature">피처·르포 (현장 분위기 및 서사적 묘사)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      초기 취재 메모 / 로우데이터 (선택)
                    </label>
                    <textarea
                      rows={4}
                      value={rawNotesInput}
                      onChange={(e) => setRawNotesInput(e.target.value)}
                      placeholder="보도자료 핵심 문구, 수치 메모, 관계자 구두 발언 등 수집한 원자료를 편하게 붙여넣으세요."
                      className="w-full text-xs p-2 bg-white border border-slate-300 rounded-lg placeholder:text-slate-600 font-medium focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none"
                    />
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      <input
                        ref={rawFileRef}
                        type="file"
                        accept={RAW_FILE_EXTENSIONS.map(x => `.${x}`).join(',')}
                        onChange={handleRawFile}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => rawFileRef.current?.click()}
                        className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-800 cursor-pointer"
                      >
                        파일 불러오기 (TXT·CSV)
                      </button>
                      <input
                        ref={audioFileRef}
                        type="file"
                        accept={AUDIO_EXTENSIONS.map(x => `.${x}`).join(',')}
                        onChange={handleAudioFile}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={toggleAudioPanel}
                        disabled={isTranscribing}
                        className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-800 cursor-pointer disabled:opacity-50"
                      >
                        {isTranscribing ? `받아 적는 중... ${sttProgress}` : '녹음 받아쓰기'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowWebInput(v => !v)}
                        className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-800 cursor-pointer"
                      >
                        웹 주소에서 가져오기
                      </button>
                      <button
                        type="button"
                        onClick={handleOrganizeRaw}
                        disabled={isOrganizing || rawNotesInput.trim().length < 30}
                        className="px-2.5 py-1 rounded border border-purple-300 bg-purple-50 hover:bg-purple-100 text-[11px] font-bold text-purple-900 cursor-pointer disabled:opacity-50"
                      >
                        {isOrganizing ? '정리 중...' : 'AI로 정리하기'}
                      </button>
                      {rawBeforeOrganize !== null && (
                        <button
                          type="button"
                          onClick={() => { setRawNotesInput(rawBeforeOrganize); setRawBeforeOrganize(null); }}
                          className="text-[11px] underline text-slate-700 cursor-pointer"
                        >
                          정리 전 원문으로 되돌리기
                        </button>
                      )}
                    </div>
                    {showAudioPanel && audioPanelJsx}
                    {speakerNames.length > 0 && (
                      <div className="mt-1.5 p-2.5 rounded-lg border border-purple-200 bg-purple-50 space-y-1.5">
                        <p className="text-[11px] font-bold text-purple-900">화자 이름 바꾸기 (비워 두면 그대로)</p>
                        <div className="flex flex-wrap gap-2">
                          {speakerNames.map((sp, i) => (
                            <label key={sp.current} className="flex items-center gap-1 text-[11px] text-slate-800">
                              <span className="font-bold">{sp.current}</span>
                              <input
                                value={sp.input}
                                maxLength={20}
                                onChange={(e) => setSpeakerNames(prev => prev.map((x, j) => (j === i ? { ...x, input: e.target.value } : x)))}
                                placeholder="예: 김 의원"
                                className="w-24 text-xs p-1 bg-white border border-slate-300 rounded"
                              />
                            </label>
                          ))}
                          <button
                            type="button"
                            onClick={applySpeakerNames}
                            className="px-2 py-1 rounded bg-purple-700 hover:bg-purple-800 text-white text-[11px] font-bold cursor-pointer"
                          >
                            이름 적용
                          </button>
                        </div>
                      </div>
                    )}
                    {showWebInput && (
                      <form onSubmit={handleFetchWeb} className="flex items-center gap-1.5 mt-1.5">
                        <input
                          type="url"
                          value={webUrlInput}
                          onChange={(e) => setWebUrlInput(e.target.value)}
                          disabled={isFetchingWeb}
                          placeholder="https://… 기사나 자료가 있는 웹 주소"
                          className="flex-1 min-w-0 text-xs p-2 bg-white border border-slate-300 rounded-lg placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                        />
                        <button
                          type="submit"
                          disabled={isFetchingWeb || !webUrlInput.trim()}
                          className="px-2.5 py-2 rounded bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50 shrink-0"
                        >
                          {isFetchingWeb ? '가져오는 중...' : '가져오기'}
                        </button>
                      </form>
                    )}
                    {showWebInput && (
                      <p className="text-[10px] text-amber-900 mt-1">
                        가져온 글은 사실을 확인하는 참고 자료입니다. 문장을 그대로 옮기지 말고, 기사에 쓸 때는 출처를 밝혀 주세요. 사이트가 자동 수집을 막아 둔 곳은 가져오지 않습니다.
                      </p>
                    )}
                    <p className="text-[10px] text-slate-600 mt-1">
                      30자 이상 있으면 AI가 핵심 사실·수치·발언·확인 필요 항목으로 나눠 줍니다. 원자료에 없는 내용은 만들지 않습니다.
                    </p>

                    {organized && (
                      <div className="mt-2 p-3 rounded-lg border border-purple-200 bg-purple-50/50 space-y-2 text-[11px] text-slate-800">
                        {organized.data.summary && <p className="font-semibold leading-relaxed">{organized.data.summary}</p>}
                        <p className="text-slate-700">
                          핵심 사실 {organized.data.key_facts.length}건 · 수치 {organized.data.figures.length}건 · 발언 {organized.data.quotes.length}건 · 시간순 {organized.data.timeline.length}건 · 확인 필요 {organized.data.open_questions.length}건
                        </p>
                        {organized.data.open_questions.length > 0 && (
                          <ul className="list-disc pl-4 space-y-0.5 text-amber-900">
                            {organized.data.open_questions.slice(0, 4).map((q, i) => <li key={i}>{q}</li>)}
                          </ul>
                        )}
                        {organized.meta.truncated && (
                          <p className="text-amber-900">원자료가 길어 앞부분 약 3만 자만 정리했습니다.</p>
                        )}
                        {organized.meta.dropped > 0 && (
                          <p className="text-slate-700">원자료에서 확인되지 않은 발언·수치 {organized.meta.dropped}건은 자동으로 뺐습니다.</p>
                        )}
                        <div className="flex items-center gap-2 pt-1">
                          <button type="button" onClick={handleUseOrganized} className="px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-700 text-white font-bold cursor-pointer">
                            정리본을 취재 메모에 넣기
                          </button>
                          <button type="button" onClick={() => setOrganized(null)} className="underline text-slate-700 cursor-pointer">닫기</button>
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting || !topicInput.trim()}
                    className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-lg text-xs font-bold shadow-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span>취재 인터뷰 시작하기</span>
                  </button>
                </form>
              </div>
            ) : (
              /* 대화 말풍선 목록 */
              <>
                {conversation.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start space-x-2.5 ${
                      msg.role === 'reporter' ? 'flex-row-reverse space-x-reverse' : ''
                    }`}
                  >
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 shadow-2xs ${
                        msg.role === 'ai'
                          ? 'bg-purple-600 text-white'
                          : 'bg-slate-700 text-white'
                      }`}
                    >
                      {msg.role === 'ai' ? <Bot className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
                    </div>

                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs shadow-2xs whitespace-pre-wrap leading-relaxed ${
                        msg.role === 'ai'
                          ? 'bg-white border border-purple-100 text-slate-800 rounded-tl-xs'
                          : 'bg-purple-600 text-white rounded-tr-xs'
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </>
            )}
          </div>

          {/* 답변 입력창 및 하단 액션 */}
          {conversation.length > 0 && (
            <div className="p-3 bg-white border-t border-slate-200 space-y-2">
              <form onSubmit={handleSendAnswer} className="flex items-center space-x-2">
                <input
                  type="text"
                  value={answerInput}
                  onChange={(e) => setAnswerInput(e.target.value)}
                  placeholder="AI 질문에 대한 사실 답변을 입력하세요..."
                  disabled={isSubmitting}
                  className="flex-1 text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg placeholder:text-slate-600 font-medium focus:outline-none focus:ring-1 focus:ring-purple-500 focus:bg-white"
                />
                <button
                  type="submit"
                  disabled={isSubmitting || !answerInput.trim()}
                  className="p-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                  title="답변 전송"
                >
                  {isSubmitting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </form>

              {/* 녹음으로 답하기: 인터뷰 도중에도 녹음 받아쓰기를 쓸 수 있게 함 */}
              <div className="space-y-1.5">
                <input
                  ref={audioFileRef}
                  type="file"
                  accept={AUDIO_EXTENSIONS.map(x => `.${x}`).join(',')}
                  onChange={handleAudioFile}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={toggleAudioPanel}
                  disabled={isTranscribing}
                  className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-800 cursor-pointer disabled:opacity-50"
                >
                  {isTranscribing ? `받아 적는 중... ${sttProgress}` : '녹음 받아쓰기 (녹음으로 답하기)'}
                </button>
                {showAudioPanel && audioPanelJsx}
              </div>

              {/* 초안 정리 및 완성 버튼 */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-slate-700 font-medium">
                  {isReadyToFinalize ? '필수 사실이 충분히 수집되었습니다.' : '질문에 답변할수록 초안 완성도가 높아집니다.'}
                </span>

                <button
                  type="button"
                  onClick={handleFinalizeDraft}
                  disabled={isSubmitting}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shadow-2xs ${
                    isReadyToFinalize
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white animate-pulse'
                      : 'bg-purple-100 hover:bg-purple-200 text-purple-800'
                  }`}
                >
                  <FileCheck className="w-3.5 h-3.5" />
                  <span>지금까지 답변으로 기사 초안 만들기</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* [우측 5컬럼]: 실시간 초안 미리보기 & 본문 적용 영역 */}
        <div className={`md:col-span-5 flex flex-col h-full bg-white overflow-y-auto p-4 space-y-4 ${compact && compactView === 'chat' ? 'hidden' : ''}`}>
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h4 className="text-xs font-bold text-slate-900 flex items-center space-x-1.5">
              <FileCheck className="w-4 h-4 text-emerald-600" />
              <span>실시간 기사 초안 미리보기</span>
            </h4>

            {(draftState.lead_paragraph || draftState.body_blocks.length > 0) && (
              <button
                type="button"
                onClick={handleApplyAllDraft}
                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-md shadow-2xs cursor-pointer flex items-center space-x-1"
                title="리드와 모든 본문 문단을 에디터에 일괄 추가합니다"
              >
                <Plus className="w-3 h-3 stroke-[3]" />
                <span>전체 본문 일괄 추가</span>
              </button>
            )}
          </div>

          {/* 0. 초안 전체 수정 지시 */}
          {(draftState.lead_paragraph || draftState.body_blocks.length > 0) && (
            <div className="p-2.5 rounded-lg border border-purple-200 bg-purple-50/50 space-y-2">
              <span className="text-[11px] font-bold text-purple-900">AI에게 수정 지시 (초안 전체)</span>
              <div className="flex flex-wrap gap-1">
                {['전체를 20% 짧게', '더 쉬운 말로', '제목을 덜 자극적으로', '해설 톤으로'].map(ex => (
                  <button
                    key={ex}
                    type="button"
                    disabled={isRevising}
                    onClick={() => handleReviseDraft(ex)}
                    className="px-2 py-0.5 rounded-full border border-purple-300 bg-white text-[10px] font-semibold text-purple-800 hover:bg-purple-100 cursor-pointer disabled:opacity-50"
                  >
                    {ex}
                  </button>
                ))}
              </div>
              <form onSubmit={(e) => { e.preventDefault(); handleReviseDraft(reviseInput); }} className="flex items-center gap-1.5">
                <input
                  value={reviseInput}
                  maxLength={500}
                  onChange={(e) => setReviseInput(e.target.value)}
                  disabled={isRevising}
                  placeholder="예: 리드를 두 문장으로 줄이고 존댓말을 빼 주세요"
                  className="flex-1 min-w-0 border border-slate-300 rounded px-2 py-1.5 text-xs text-slate-800 placeholder:text-slate-500 bg-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <button
                  type="submit"
                  disabled={isRevising || !reviseInput.trim()}
                  className="px-2.5 py-1.5 rounded bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {isRevising ? '수정 중...' : '지시 보내기'}
                </button>
              </form>
              <p className="text-[10px] text-slate-600">수집된 사실 안에서만 고치며, 새 사실은 추가하지 않습니다.</p>
            </div>
          )}

          {/* 1. 5W1H 수집 현황 칩 */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold text-slate-600">5W1H 사실관계 검증 현황:</span>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              {Object.entries(draftState.five_w1h).map(([key, val]) => {
                const labelMap: Record<string, string> = {
                  who: '누가 (Who)',
                  what: '무엇을 (What)',
                  when: '언제 (When)',
                  where: '어디서 (Where)',
                  why: '왜 (Why)',
                  how: '어떻게 (How)',
                };
                const isFilled = Boolean(val);
                return (
                  <div
                    key={key}
                    className={`p-1.5 rounded border flex items-center justify-between ${
                      isFilled
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950 font-medium'
                        : 'bg-slate-50 border-amber-300 text-slate-800 font-medium'
                    }`}
                  >
                    <span className="font-semibold">{labelMap[key] || key}</span>
                    {isFilled ? (
                      <Check className="w-3.5 h-3.5 text-emerald-700 stroke-[2.5]" />
                    ) : (
                      <span className="text-[11px] font-bold text-amber-900 bg-amber-100 px-1.5 py-0.5 rounded border border-amber-400">
                        [확인 필요]
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. 제목 후보 (Title Candidates) */}
          {draftState.title_candidates.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-purple-900 flex items-center space-x-1">
                <BookmarkPlus className="w-3 h-3 text-purple-600" />
                <span>추천 제목 후보</span>
              </span>
              <div className="space-y-1">
                {draftState.title_candidates.map((t, idx) => (
                  <div
                    key={idx}
                    className="p-2 bg-purple-50/60 rounded-lg border border-purple-200/70 flex items-center justify-between gap-2 group"
                  >
                    <span className="text-xs font-bold text-slate-800 line-clamp-2">{t}</span>
                    {onApplyTitle && (
                      <button
                        type="button"
                        onClick={() => {
                          onApplyTitle(t);
                          showToast?.('기사 제목이 적용되었습니다.');
                        }}
                        className="px-2 py-0.5 bg-white hover:bg-purple-100 text-purple-700 text-[10px] font-bold rounded border border-purple-300 transition-colors shrink-0 cursor-pointer"
                      >
                        제목 적용
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 근거 표시 안내 */}
          {(draftState.lead_paragraph || draftState.body_blocks.length > 0) && (
            <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-50 border border-slate-200 text-[10px] text-slate-700">
              <div className="space-y-0.5">
                <div>
                  <span className="bg-emerald-100/70 px-1 rounded-sm">초록</span> 내가 준 자료에서 나온 문장 {evidenceSummary.supported}개 ·{' '}
                  <span className="bg-amber-200/80 px-1 rounded-sm underline decoration-dotted">노랑</span> 근거를 못 찾은 문장 {evidenceSummary.unsupported}개
                </div>
                <div className="text-slate-500">글자 비교로 찾은 참고 표시입니다. 문장에 마우스를 올리면 이유가 보입니다. 노랑은 꼭 사실을 확인해 주세요.</div>
              </div>
              <button
                type="button"
                onClick={() => setShowEvidence((v) => !v)}
                className="shrink-0 px-2 py-1 rounded border border-slate-300 bg-white font-bold hover:bg-slate-100 cursor-pointer"
              >
                {showEvidence ? '표시 끄기' : '표시 켜기'}
              </button>
            </div>
          )}

          {/* 3. 리드 문단 (Lead Paragraph) */}
          {draftState.lead_paragraph && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-blue-900">리드 문단 (Lead)</span>
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    onClick={() => setRegenTarget({ type: 'lead', index: 0 })}
                    className="text-[10px] text-slate-600 hover:text-blue-600 flex items-center space-x-0.5 cursor-pointer"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>다시 작성</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleApplySingleBlock(draftState.lead_paragraph!, 0, true)}
                    disabled={isLeadApplied}
                    className={`px-2 py-0.5 text-[10px] font-bold rounded border transition-colors cursor-pointer ${
                      isLeadApplied
                        ? 'bg-slate-100 text-slate-500 border-slate-200'
                        : 'bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100'
                    }`}
                  >
                    {isLeadApplied ? '적용됨 ✓' : '본문 삽입'}
                  </button>
                </div>
              </div>
              <p className="text-xs p-2.5 bg-blue-50/40 rounded-lg border border-blue-200/60 text-slate-800 leading-relaxed whitespace-pre-wrap">
                {renderEvidence(leadEvidence, draftState.lead_paragraph)}
              </p>
            </div>
          )}

          {/* 4. 본문 블록 목록 (Body Blocks) */}
          {draftState.body_blocks.length > 0 && (
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-slate-700">본문 문단 목록</span>
              <div className="space-y-2">
                {draftState.body_blocks.map((blockText, idx) => {
                  const isApplied = appliedBlockIndices.has(idx);
                  return (
                    <div
                      key={idx}
                      className="p-2.5 bg-slate-50/70 rounded-lg border border-slate-200 space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-[10px] text-slate-600 font-semibold">
                        <span>문단 {idx + 1}</span>
                        <div className="flex items-center space-x-1.5">
                          <button
                            type="button"
                            onClick={() => setRegenTarget({ type: 'block', index: idx })}
                            className="text-slate-600 hover:text-purple-600 flex items-center space-x-0.5 cursor-pointer"
                          >
                            <RotateCcw className="w-2.5 h-2.5" />
                            <span>수정 요청</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleApplySingleBlock(blockText, idx)}
                            disabled={isApplied}
                            className={`px-2 py-0.5 font-bold rounded border transition-colors cursor-pointer ${
                              isApplied
                                ? 'bg-slate-100 text-slate-500 border-slate-200'
                                : 'bg-white text-purple-700 border-purple-300 hover:bg-purple-50'
                            }`}
                          >
                            {isApplied ? '적용됨 ✓' : '본문 삽입'}
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">
                        {renderEvidence(blockEvidence[idx] || [], blockText)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 5. 인용구 및 주요 수치 보관함 */}
          {(draftState.quotes.length > 0 || draftState.key_figures.length > 0) && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <span className="text-[11px] font-bold text-slate-600">수집된 취재 팩트 조각:</span>
              <div className="space-y-1">
                {draftState.quotes.map((q, idx) => (
                  <div key={idx} className="p-1.5 rounded bg-slate-100 text-[11px] text-slate-700">
                    <span className="font-bold">"{q.quote}"</span>
                    <span className="text-slate-700 font-medium ml-1">— {q.speaker}</span>
                  </div>
                ))}
                {draftState.key_figures.map((kf, idx) => (
                  <div key={idx} className="p-1.5 rounded bg-slate-100 text-[11px] text-slate-700 flex justify-between">
                    <span className="font-semibold">{kf.label}</span>
                    <span className="font-bold text-purple-700">{kf.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. 섹션 재작성 피드백 모달 */}
      {regenTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-2xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h4 className="text-xs font-bold text-slate-900 flex items-center space-x-1.5">
                <RotateCcw className="w-4 h-4 text-purple-600" />
                <span>문단 수정 요청 및 피드백</span>
              </h4>
              <button
                type="button"
                onClick={() => setRegenTarget(null)}
                className="text-slate-500 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRegenerateSectionSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  어떻게 수정할까요? (사실관계 내에서만 재작성됩니다)
                </label>
                <textarea
                  rows={3}
                  value={regenFeedback}
                  onChange={(e) => setRegenFeedback(e.target.value)}
                  placeholder="예: 더 간결하고 직관적인 문장으로 다듬어줘 / 통계 수치를 문장 앞쪽에 배치해줘"
                  className="w-full text-xs p-2 bg-white border border-slate-300 rounded-lg placeholder:text-slate-600 font-medium focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-1">
                <button
                  type="button"
                  onClick={() => setRegenTarget(null)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isRegenerating || !regenFeedback.trim()}
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-lg shadow-xs cursor-pointer disabled:opacity-50 flex items-center space-x-1"
                >
                  {isRegenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>재작성 실행</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
