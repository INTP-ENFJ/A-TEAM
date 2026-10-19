import React, { useEffect, useRef, useState } from 'react';
import { Mic, Upload, Copy, Download, Sparkles, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  transcribeAudioFile,
  organizeRawData,
  formatOrganizedMemo,
  STT_LANGUAGE_LABEL,
  AUDIO_EXTENSIONS,
  type SttEngine,
  type SttLanguage,
  type SttMode,
  type OrganizedRawData,
  type OrganizeMeta,
} from '../../services/rawDataService';
import { getSttKeyStatus } from '../../services/aiKey';
import {
  DIARIZE_BADGE,
  diarizeCapableModels,
  diarizeLevelOf,
  findModel,
  getSttModel,
  modelsFor,
  setSttModel,
} from '../../services/sttModels';

/**
 * 녹음 정리 화면 (왼쪽 메뉴의 [녹음 정리])
 * 1) 녹음 파일 올리기  2) 글자로 바꾸기(발표 / 인터뷰·화자 나누기)  3) 요약하기
 */

// 엔진 설명. 화자 구분 가능 여부는 엔진이 아니라 '모델'마다 달라서 services/sttModels.ts에서 관리합니다.
const ENGINES: Record<SttEngine, { label: string; hint: string; limit: string }> = {
  gemini: { label: 'Gemini', hint: '일반 AI가 듣고 받아 적습니다.', limit: '10MB까지' },
  openai: { label: 'OpenAI', hint: '받아쓰기 전용 모델을 씁니다.', limit: '10MB까지' },
  googlecloud: { label: '구글 클라우드', hint: '긴 녹음에 알맞습니다. 1분 단위로 나눠 처리합니다.', limit: '30분·60MB까지' },
};

const DRAFT_KEY = 'press_stt_draft';

interface SttViewProps {
  showToast?: (message: string) => void;
  /** 승인 대기 계정이면 true (서버에서도 막힘) */
  isReadOnly?: boolean;
}

export const SttView: React.FC<SttViewProps> = ({ showToast, isReadOnly }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<SttLanguage>('ko');
  const [mode, setMode] = useState<SttMode>('interview');
  const [speakers, setSpeakers] = useState('');
  const [engine, setEngine] = useState<SttEngine>('gemini');
  const [model, setModel] = useState<string | undefined>(undefined);
  const [keys, setKeys] = useState<Record<SttEngine, boolean> | null>(null);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [diarized, setDiarized] = useState(false);
  const [ranMode, setRanMode] = useState<SttMode | null>(null);
  const [speakerNames, setSpeakerNames] = useState<{ current: string; input: string }[]>([]);

  const [topic, setTopic] = useState('');
  const [summary, setSummary] = useState<OrganizedRawData | null>(null);
  const [summaryMeta, setSummaryMeta] = useState<OrganizeMeta | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  // 이전에 작업하던 내용 복원 (다른 화면에 다녀와도 사라지지 않게, 이 브라우저 탭에서만)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (typeof d.text === 'string') setText(d.text);
        if (typeof d.topic === 'string') setTopic(d.topic);
        if (d.summary) setSummary(d.summary);
        if (typeof d.diarized === 'boolean') setDiarized(d.diarized);
        if (d.ranMode) setRanMode(d.ranMode);
      }
    } catch { /* 저장소를 못 쓰면 그냥 새로 시작 */ }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ text, topic, summary, diarized, ranMode }));
    } catch { /* 무시 */ }
  }, [text, topic, summary, diarized, ranMode]);

  // 등록된 키 확인 → 키가 있는 엔진을 먼저 고름
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const st = await getSttKeyStatus();
        if (!alive) return;
        setKeys({ gemini: st.gemini, openai: st.openai, googlecloud: st.googlecloud });
        const order: SttEngine[] = [];
        if (st.active === 'gemini' || st.active === 'openai') order.push(st.active);
        order.push('gemini', 'openai', 'googlecloud');
        const pick = order.find(e => st[e]);
        if (pick) setEngine(pick);
      } catch {
        if (alive) setKeys(null);
      }
    })();
    return () => { alive = false; };
  }, []);

  // 엔진·방식이 바뀌면 그 조합에서 저장해 둔 모델을 불러옴
  useEffect(() => {
    setModel(getSttModel(engine, mode));
  }, [engine, mode]);

  const changeModel = (id: string) => {
    setModel(id);
    setSttModel(engine, mode, id);
  };

  const pickFile = (f: File | undefined | null) => {
    if (!f) return;
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!AUDIO_EXTENSIONS.includes(ext)) {
      setError('MP3, M4A, WAV, AAC, OGG, FLAC, WEBM 녹음 파일만 올릴 수 있습니다.');
      return;
    }
    setError('');
    setFile(f);
    if (!topic.trim()) setTopic(f.name.replace(/\.[^.]+$/, ''));
  };

  const keyMissing = !!keys && !keys[engine];
  const needsDiarize = mode === 'interview';
  const level = diarizeLevelOf(engine, model);
  const modelCannotDiarize = needsDiarize && level === 'none';
  // 화자를 나눌 수 있는 (엔진, 모델) 조합. 키가 있는 엔진만
  const capableChoices: { engine: SttEngine; model?: string; label: string }[] = [];
  (['gemini', 'openai'] as SttEngine[]).forEach(e => {
    if (keys && !keys[e]) return;
    diarizeCapableModels(e).forEach(m => capableChoices.push({ engine: e, model: m.id, label: `${ENGINES[e].label} · ${m.label}` }));
  });
  if (!keys || keys.googlecloud) capableChoices.push({ engine: 'googlecloud', label: ENGINES.googlecloud.label });

  const runTranscribe = async (useEngine: SttEngine = engine, useModel: string | undefined = model) => {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    setNotes([]);
    setProgress('');
    setSummary(null);
    setSummaryMeta(null);
    setSummaryError('');
    try {
      const n = Number(speakers);
      const res = await transcribeAudioFile(
        file,
        {
          engine: useEngine,
          language,
          mode,
          model: useModel,
          speakers: mode === 'interview' && Number.isInteger(n) && n >= 2 && n <= 6 ? n : undefined,
        },
        (done, total) => setProgress(total > 1 ? `${done}/${total} 조각 처리` : ''),
      );
      setEngine(useEngine);
      setModel(useModel);
      setText(res.text);
      setNotes(res.notes);
      setDiarized(res.diarized);
      setRanMode(mode);
      if (res.diarized) {
        const found = Array.from(new Set(Array.from(res.text.matchAll(/^(화자\d+):/gm)).map(m => m[1])));
        setSpeakerNames(found.map(c => ({ current: c, input: '' })));
      } else {
        setSpeakerNames([]);
      }
      showToast?.('받아쓰기가 끝났습니다. 잘못 들은 곳이 없는지 확인해 주세요.');
    } catch (e: any) {
      setError(e?.message || '녹음을 글자로 바꾸지 못했습니다.');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const applySpeakerNames = () => {
    let next = text;
    const names = speakerNames.map(sp => {
      const name = sp.input.trim().replace(/[:\n\r]/g, '').slice(0, 20);
      if (!name || name === sp.current) return sp;
      const escaped = sp.current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      next = next.replace(new RegExp(`^${escaped}:`, 'gm'), `${name}:`);
      return { current: name, input: '' };
    });
    setText(next);
    setSpeakerNames(names);
    setSummary(null);
  };

  const runSummary = async () => {
    if (!text.trim() || summaryBusy) return;
    setSummaryBusy(true);
    setSummaryError('');
    try {
      const r = await organizeRawData(text, topic.trim() || '녹음 내용');
      setSummary(r.data);
      setSummaryMeta(r.meta);
    } catch (e: any) {
      setSummaryError(e?.message || '요약하지 못했습니다.');
    } finally {
      setSummaryBusy(false);
    }
  };

  const copy = async (value: string, okMsg: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast?.(okMsg);
    } catch {
      showToast?.('복사하지 못했습니다. 직접 선택해서 복사해 주세요.');
    }
  };

  const download = (value: string, name: string) => {
    const url = URL.createObjectURL(new Blob([value], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const baseName = (topic.trim() || 'recording').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  const interviewNotSplit = ranMode === 'interview' && !!text && !diarized;
  const inputCls = 'mt-0.5 w-full text-xs p-1.5 bg-white border border-slate-300 rounded cursor-pointer text-slate-800';

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 text-slate-800 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <Mic className="w-5 h-5 text-blue-600" />
            녹음 정리
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            녹음 파일을 올리면 글자로 바꾸고, 핵심만 요약해 드립니다. 발표는 한 사람의 말로, 인터뷰는 말한 사람별로 나눠 적습니다.
          </p>
        </div>

        {isReadOnly && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-sm text-amber-900 font-semibold">
            인사부 승인 후에 사용할 수 있습니다.
          </div>
        )}

        {/* 1. 파일 올리기와 옵션 */}
        <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 shadow-xs">
          <h2 className="text-sm font-bold text-slate-900">1. 녹음 파일 올리기</h2>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
            onClick={() => fileRef.current?.click()}
            className={`cursor-pointer rounded-lg border-2 border-dashed p-5 text-center text-sm transition-colors ${
              dragOver ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'
            }`}
          >
            <Upload className="w-5 h-5 mx-auto text-slate-500 mb-1" />
            {file ? (
              <span className="font-bold text-slate-900">{file.name} <span className="font-normal text-slate-600">({file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))}KB` : `${(file.size / 1024 / 1024).toFixed(1)}MB`})</span></span>
            ) : (
              <span className="text-slate-700">여기에 녹음 파일을 끌어다 놓거나 눌러서 고르세요 (MP3, M4A, WAV, OGG 등)</span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept={AUDIO_EXTENSIONS.map(e => `.${e}`).join(',')}
              className="hidden"
              onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <label className="text-[12px] font-bold text-slate-700">
              말하는 언어
              <select value={language} onChange={(e) => setLanguage(e.target.value as SttLanguage)} className={inputCls}>
                {(Object.keys(STT_LANGUAGE_LABEL) as SttLanguage[]).map(l => <option key={l} value={l}>{STT_LANGUAGE_LABEL[l]}</option>)}
              </select>
            </label>
            <label className="text-[12px] font-bold text-slate-700">
              받아쓰기 방식
              <select value={mode} onChange={(e) => setMode(e.target.value as SttMode)} className={inputCls}>
                <option value="interview">인터뷰 (화자 나누기)</option>
                <option value="speech">발표·강연 (한 사람)</option>
              </select>
            </label>
            <label className="text-[12px] font-bold text-slate-700">
              받아쓰기 엔진
              <select value={engine} onChange={(e) => setEngine(e.target.value as SttEngine)} className={inputCls}>
                {(Object.keys(ENGINES) as SttEngine[]).map(e => (
                  <option key={e} value={e}>{ENGINES[e].label}{keys && !keys[e] ? ' (키 없음)' : ''}</option>
                ))}
              </select>
            </label>
            {engine !== 'googlecloud' && (
              <label className="text-[12px] font-bold text-slate-700">
                받아쓰기 모델
                <select value={model || ''} onChange={(e) => changeModel(e.target.value)} className={inputCls}>
                  {modelsFor(engine).map(m => (
                    <option key={m.id} value={m.id}>{m.label}{mode === 'interview' && m.diarize === 'none' ? ' (화자 구분 불가)' : ''}</option>
                  ))}
                </select>
              </label>
            )}
            {mode === 'interview' && (
              <label className="text-[12px] font-bold text-slate-700">
                말하는 사람 수 (선택)
                <select value={speakers} onChange={(e) => setSpeakers(e.target.value)} className={inputCls}>
                  <option value="">모름</option>
                  {[2, 3, 4, 5, 6].map(n => <option key={n} value={String(n)}>{n}명</option>)}
                </select>
              </label>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            {needsDiarize && (
              <span className={`px-2 py-0.5 rounded-full border font-bold ${DIARIZE_BADGE[level].cls}`}>
                {DIARIZE_BADGE[level].text}
              </span>
            )}
            <span className="text-slate-600">
              {findModel(engine, model)?.note || ENGINES[engine].hint} ({ENGINES[engine].limit})
            </span>
          </div>

          {modelCannotDiarize && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-[13px] text-amber-900 space-y-1.5">
              <p className="font-bold flex items-center gap-1"><AlertTriangle className="w-4 h-4" />이 모델은 말한 사람을 나누지 못합니다. 이대로 하면 한 덩어리로 적힙니다.</p>
              <div className="flex flex-wrap gap-1.5">
                {capableChoices.length === 0 && <span>화자 구분이 되는 엔진의 키를 환경설정에서 먼저 등록해 주세요.</span>}
                {capableChoices.map(c => (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => { setEngine(c.engine); if (c.model) { setSttModel(c.engine, mode, c.model); setModel(c.model); } }}
                    className="px-2 py-1 rounded bg-white border border-amber-400 font-bold hover:bg-amber-100 cursor-pointer"
                  >
                    {c.label}(으)로 바꾸기
                  </button>
                ))}
              </div>
              <p className="text-[12px]">그대로 진행해도 됩니다. 이때는 화자 구분 없이 글만 적힙니다.</p>
            </div>
          )}

          {keyMissing && (
            <p className="text-[13px] text-red-700 font-bold">이 엔진의 키가 등록되어 있지 않습니다. 환경설정 → AI 서비스 설정에서 먼저 등록해 주세요.</p>
          )}
          {error && <p className="text-[13px] text-red-700 font-bold">{error}</p>}

          <button
            type="button"
            onClick={() => void runTranscribe()}
            disabled={!file || busy || keyMissing || isReadOnly}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? `글자로 바꾸는 중... ${progress}` : '글자로 바꾸기 시작'}
          </button>
          {busy && <p className="text-[12px] text-slate-600">길면 몇 분 걸릴 수 있어요. 이 화면을 닫지 말아 주세요.</p>}
        </section>

        {/* 2. 받아쓴 글 */}
        <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900">2. 받아쓴 글 (직접 고칠 수 있습니다)</h2>
            <div className="flex gap-1.5">
              <button type="button" disabled={!text} onClick={() => void copy(text, '받아쓴 글을 복사했습니다.')} className="flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer disabled:opacity-50">
                <Copy className="w-3.5 h-3.5" />복사
              </button>
              <button type="button" disabled={!text} onClick={() => download(text, `${baseName}_받아쓰기.txt`)} className="flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer disabled:opacity-50">
                <Download className="w-3.5 h-3.5" />TXT로 받기
              </button>
            </div>
          </div>

          {notes.map((n, i) => <p key={i} className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">{n}</p>)}

          {interviewNotSplit && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-[13px] text-amber-900 space-y-1.5">
              <p className="font-bold flex items-center gap-1"><AlertTriangle className="w-4 h-4" />화자가 나뉘지 않았습니다. 화자 구분이 되는 모델로 다시 해 볼 수 있어요.</p>
              <div className="flex flex-wrap gap-1.5">
                {capableChoices.filter(c => !(c.engine === engine && (c.model ?? undefined) === (model ?? undefined))).map(c => (
                  <button key={c.label} type="button" disabled={busy || !file} onClick={() => void runTranscribe(c.engine, c.model)} className="flex items-center gap-1 px-2 py-1 rounded bg-white border border-amber-400 font-bold hover:bg-amber-100 cursor-pointer disabled:opacity-50">
                    <RefreshCw className="w-3.5 h-3.5" />{c.label}(으)로 다시
                  </button>
                ))}
                {!file && <span>(다시 하려면 녹음 파일을 다시 골라 주세요)</span>}
              </div>
            </div>
          )}

          {speakerNames.length > 0 && (
            <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 space-y-1.5">
              <p className="text-[12px] font-bold text-blue-900">화자 이름 바꾸기 (예: 화자1 → 박민수 국장)</p>
              <div className="flex flex-wrap items-center gap-2">
                {speakerNames.map((sp, i) => (
                  <label key={sp.current} className="flex items-center gap-1 text-[12px] text-slate-700">
                    <span className="font-bold">{sp.current}</span>
                    <input
                      value={sp.input}
                      onChange={(e) => setSpeakerNames(prev => prev.map((x, j) => (j === i ? { ...x, input: e.target.value } : x)))}
                      placeholder="이름"
                      className="w-28 text-xs p-1 border border-slate-300 rounded bg-white text-slate-800"
                    />
                  </label>
                ))}
                <button type="button" onClick={applySpeakerNames} className="px-2.5 py-1 rounded bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 cursor-pointer">이름 바꾸기</button>
              </div>
            </div>
          )}

          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setSummary(null); }}
            rows={12}
            placeholder="녹음을 글자로 바꾸면 여기에 나옵니다. 이미 가진 글을 붙여 넣어 요약만 할 수도 있어요."
            className="w-full text-sm leading-6 p-3 border border-slate-300 rounded-lg bg-white text-slate-800 placeholder:text-slate-500"
          />
        </section>

        {/* 3. 요약 */}
        <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 shadow-xs">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900">3. 요약하기</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="무엇에 대한 녹음인가요? (선택)"
                className="w-56 text-xs p-1.5 border border-slate-300 rounded bg-white text-slate-800 placeholder:text-slate-500"
              />
              <button
                type="button"
                onClick={() => void runSummary()}
                disabled={!text.trim() || summaryBusy || isReadOnly}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />{summaryBusy ? '요약 중...' : '요약하기'}
              </button>
            </div>
          </div>
          {summaryError && <p className="text-[13px] text-red-700 font-bold">{summaryError}</p>}

          {summary && (
            <div className="space-y-3 text-sm">
              {summaryMeta && (summaryMeta.dropped > 0 || summaryMeta.truncated) && (
                <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                  {summaryMeta.dropped > 0 && `녹음에서 확인되지 않은 발언·숫자 ${summaryMeta.dropped}개는 걸러냈습니다. `}
                  {summaryMeta.truncated && '글이 너무 길어 앞부분만 요약했습니다.'}
                </p>
              )}
              {summary.summary && (
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                  <p className="text-[12px] font-bold text-blue-900 mb-1">한눈에 보기</p>
                  <p className="text-slate-800 leading-6">{summary.summary}</p>
                </div>
              )}
              {summary.key_facts.length > 0 && (
                <div>
                  <p className="text-[12px] font-bold text-slate-700 mb-1">핵심 내용</p>
                  <ul className="list-disc pl-5 space-y-0.5 text-slate-800">{summary.key_facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
                </div>
              )}
              {summary.quotes.length > 0 && (
                <div>
                  <p className="text-[12px] font-bold text-slate-700 mb-1">기사에 쓸 만한 발언</p>
                  <ul className="space-y-1">{summary.quotes.map((q, i) => (
                    <li key={i} className="pl-3 border-l-4 border-slate-300 text-slate-800">"{q.quote}" <span className="text-slate-600">— {q.speaker}</span></li>
                  ))}</ul>
                </div>
              )}
              {summary.figures.length > 0 && (
                <div>
                  <p className="text-[12px] font-bold text-slate-700 mb-1">숫자·날짜</p>
                  <ul className="list-disc pl-5 text-slate-800">{summary.figures.map((f, i) => <li key={i}>{f.label}: <b>{f.value}</b></li>)}</ul>
                </div>
              )}
              {summary.timeline.length > 0 && (
                <div>
                  <p className="text-[12px] font-bold text-slate-700 mb-1">시간 순서</p>
                  <ul className="list-disc pl-5 text-slate-800">{summary.timeline.map((t, i) => <li key={i}><b>{t.when}</b> {t.what}</li>)}</ul>
                </div>
              )}
              {summary.open_questions.length > 0 && (
                <div>
                  <p className="text-[12px] font-bold text-amber-800 mb-1">더 확인할 것</p>
                  <ul className="list-disc pl-5 text-slate-800">{summary.open_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button type="button" onClick={() => void copy(formatOrganizedMemo(summary), '요약을 복사했습니다. AI 초안의 취재 메모에 붙여 넣을 수 있어요.')} className="flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer">
                  <Copy className="w-3.5 h-3.5" />요약 복사
                </button>
                <button type="button" onClick={() => download(formatOrganizedMemo(summary), `${baseName}_요약.txt`)} className="flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer">
                  <Download className="w-3.5 h-3.5" />TXT로 받기
                </button>
              </div>
              <p className="text-[12px] text-slate-600 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />요약은 받아쓴 글에 있는 내용만 담습니다. 기사에 쓰기 전에 꼭 확인해 주세요.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
