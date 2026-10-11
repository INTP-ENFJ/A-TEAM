/**
 * 원자료(보도자료·메모·표) 정리 도우미.
 * - 파일(TXT·CSV·MD)을 읽어 글자로 바꾸고, 서버의 AI에게 "기사 쓰기 좋게" 정리를 맡긴다.
 * - AI 키는 서버가 내 계정에서 직접 꺼내 쓴다.
 */
import { supabase } from '../lib/supabase';
import { friendlyAiError } from './aiErrors';

export interface OrganizedRawData {
  summary: string;
  key_facts: string[];
  figures: { label: string; value: string }[];
  quotes: { speaker: string; quote: string }[];
  timeline: { when: string; what: string }[];
  open_questions: string[];
}

export interface OrganizeMeta {
  /** 원자료에서 확인되지 않아 걸러낸 발언·숫자 개수 */
  dropped: number;
  /** 너무 길어서 앞부분만 정리했는지 */
  truncated: boolean;
}

export const RAW_FILE_MAX_BYTES = 1024 * 1024;
export const RAW_FILE_EXTENSIONS = ['txt', 'csv', 'tsv', 'md'];

/** 파일을 글자로 읽는다. 한글 엑셀 CSV(EUC-KR)도 깨지지 않게 처리 */
export async function readRawTextFile(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!RAW_FILE_EXTENSIONS.includes(ext)) {
    throw new Error('TXT, CSV, MD 파일만 불러올 수 있습니다. 워드·PDF는 내용을 복사해서 붙여 넣어 주세요.');
  }
  if (file.size > RAW_FILE_MAX_BYTES) {
    throw new Error('파일이 너무 큽니다. 1MB 이하의 파일을 올려 주세요.');
  }
  const buf = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try {
      text = new TextDecoder('euc-kr').decode(buf);
    } catch {
      throw new Error('파일의 글자를 읽지 못했습니다. UTF-8로 저장해서 다시 올려 주세요.');
    }
  }
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error('파일에 내용이 없습니다.');
  return text;
}

export async function organizeRawData(
  text: string,
  topic: string,
): Promise<{ data: OrganizedRawData; meta: OrganizeMeta }> {
  const { data, error } = await supabase.functions.invoke('organize-raw-data', { body: { text, topic } });
  if (error) throw new Error(await friendlyAiError(error));
  if (!data || !data.success) throw new Error(data?.error || '원자료를 정리하지 못했습니다.');
  return {
    data: data.data as OrganizedRawData,
    meta: { dropped: Number(data.meta?.dropped || 0), truncated: !!data.meta?.truncated },
  };
}

/** 정리 결과를 "취재 메모" 글로 바꾼다 (AI 초안의 재료로 쓰임) */
export function formatOrganizedMemo(d: OrganizedRawData): string {
  const lines: string[] = [];
  if (d.summary) lines.push(`[요약] ${d.summary}`);
  if (d.key_facts.length) lines.push('[핵심 사실]', ...d.key_facts.map(f => `- ${f}`));
  if (d.figures.length) lines.push('[주요 수치]', ...d.figures.map(f => `- ${f.label}: ${f.value}`));
  if (d.quotes.length) lines.push('[발언]', ...d.quotes.map(q => `- "${q.quote}" (${q.speaker})`));
  if (d.timeline.length) lines.push('[시간순]', ...d.timeline.map(t => `- ${t.when}: ${t.what}`));
  if (d.open_questions.length) lines.push('[확인 필요]', ...d.open_questions.map(q => `- ${q}`));
  return lines.join('\n');
}

// ---------- 웹 주소에서 자료 가져오기 ----------
export interface WebSource {
  url: string;
  host: string;
  title: string;
  siteName: string;
  publishedAt: string;
  fetchedAt: string;
  text: string;
  chars: number;
  truncated: boolean;
}

export async function fetchWebSource(url: string): Promise<WebSource> {
  const { data, error } = await supabase.functions.invoke('fetch-web-source', { body: { url } });
  if (error) throw new Error(await friendlyAiError(error));
  if (!data || !data.success) throw new Error(data?.error || '웹 자료를 가져오지 못했습니다.');
  return data.data as WebSource;
}

/** 가져온 웹 글을 "출처가 붙은 참고 자료" 글로 바꾼다 (출처·수집일 자동 기재) */
export function formatWebMemo(w: WebSource): string {
  const day = w.fetchedAt.slice(0, 10);
  const head = [`[웹 자료] ${w.title || w.host}${w.siteName ? ` (${w.siteName})` : ''}`, `출처: ${w.url}`, `수집일: ${day}${w.publishedAt ? ` / 게시: ${w.publishedAt.slice(0, 10)}` : ''}`];
  return `${head.join('\n')}\n${w.text}`;
}

// ---------- 녹음 → 글자 ----------
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac', 'webm'];
/** Gemini·OpenAI는 파일 하나를 통째로 보내므로 10MB까지 */
export const AUDIO_MAX_BYTES = 10 * 1024 * 1024;
/** 구글 클라우드는 화면에서 1분 안팎으로 잘라 보내므로 더 긴 녹음도 가능 */
export const AUDIO_MAX_BYTES_CHUNKED = 60 * 1024 * 1024;
export const AUDIO_MAX_MINUTES_CHUNKED = 30;

export type SttLanguage = 'ko' | 'en' | 'ja' | 'zh';
export type SttMode = 'speech' | 'interview';
export type SttEngine = 'gemini' | 'openai' | 'googlecloud';

export const STT_LANGUAGE_LABEL: Record<SttLanguage, string> = {
  ko: '한국어',
  en: '영어',
  ja: '일본어',
  zh: '중국어',
};

export interface TranscribeOptions {
  engine: SttEngine;
  language: SttLanguage;
  mode: SttMode;
  /** 인터뷰에서 말하는 사람 수 (모르면 생략) */
  speakers?: number;
}

export interface TranscribeResult {
  text: string;
  /** 화자가 나뉘어 적혔는지 */
  diarized: boolean;
  /** 사용자에게 알려야 할 안내 */
  notes: string[];
}

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const i = result.indexOf(',');
      resolve(i >= 0 ? result.slice(i + 1) : '');
    };
    reader.onerror = () => reject(new Error('녹음 파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

// 구글 클라우드용: 녹음을 16kHz 모노 WAV 조각(약 55초)으로 자른다
const CHUNK_SECONDS = 55;
const CHUNK_RATE = 16000;

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

async function splitIntoWavChunks(file: File): Promise<Blob[]> {
  const Ctx: typeof AudioContext | undefined = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) throw new Error('이 브라우저에서는 긴 녹음을 나눌 수 없습니다. 최신 Chrome이나 Edge에서 시도해 주세요.');
  const ctx = new Ctx({ sampleRate: CHUNK_RATE });
  try {
    let decoded: AudioBuffer;
    try {
      decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    } catch {
      throw new Error('이 브라우저에서 녹음 파일을 열지 못했습니다. MP3나 WAV로 바꿔서 다시 올려 주세요.');
    }
    if (decoded.duration > AUDIO_MAX_MINUTES_CHUNKED * 60) {
      throw new Error(`녹음이 너무 깁니다. ${AUDIO_MAX_MINUTES_CHUNKED}분 이하로 나눠서 올려 주세요.`);
    }
    // 여러 채널은 하나로 합친다
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
    }
    const per = CHUNK_SECONDS * decoded.sampleRate;
    const out: Blob[] = [];
    for (let start = 0; start < mono.length; start += per) {
      out.push(encodeWav(mono.subarray(start, Math.min(mono.length, start + per)), decoded.sampleRate));
    }
    return out;
  } finally {
    void ctx.close();
  }
}

async function callTranscribe(
  fileName: string,
  blob: Blob,
  opts: TranscribeOptions,
): Promise<{ text: string; diarized: boolean; note: string | null }> {
  const audioBase64 = await fileToBase64(blob);
  const { data, error } = await supabase.functions.invoke('transcribe-audio', {
    body: {
      fileName,
      audioBase64,
      engine: opts.engine,
      language: opts.language,
      mode: opts.mode,
      speakers: opts.speakers,
    },
  });
  if (error) throw new Error(await friendlyAiError(error));
  if (!data || !data.success) throw new Error(data?.error || '녹음을 글자로 바꾸지 못했습니다.');
  return { text: String(data.data.text || ''), diarized: !!data.data.diarized, note: data.data.note || null };
}

export async function transcribeAudioFile(
  file: File,
  opts: TranscribeOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<TranscribeResult> {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!AUDIO_EXTENSIONS.includes(ext)) {
    throw new Error('MP3, M4A, WAV 같은 녹음 파일만 올릴 수 있습니다.');
  }
  const notes: string[] = [];

  if (opts.engine !== 'googlecloud') {
    if (file.size > AUDIO_MAX_BYTES) {
      throw new Error('녹음 파일이 너무 큽니다. 10MB 이하로 줄이거나, 구글 클라우드로 받아쓰기를 선택해 주세요.');
    }
    onProgress?.(0, 1);
    const r = await callTranscribe(file.name, file, opts);
    if (r.note) notes.push(r.note);
    onProgress?.(1, 1);
    return { text: r.text, diarized: r.diarized, notes };
  }

  if (file.size > AUDIO_MAX_BYTES_CHUNKED) {
    throw new Error('녹음 파일이 너무 큽니다. 60MB 이하로 줄여 주세요.');
  }
  const chunks = await splitIntoWavChunks(file);
  const texts: string[] = [];
  let anyDiarized = false;
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(i, chunks.length);
    const r = await callTranscribe(`part${i + 1}.wav`, chunks[i], opts);
    if (r.text.trim()) texts.push(r.text.trim());
    anyDiarized = anyDiarized || r.diarized;
    if (r.note && !notes.includes(r.note)) notes.push(r.note);
  }
  onProgress?.(chunks.length, chunks.length);
  if (texts.length === 0) throw new Error('녹음에서 받아 적을 말을 찾지 못했습니다.');
  if (chunks.length > 1 && opts.mode === 'interview') {
    notes.push('긴 녹음은 1분 단위로 나눠 처리해서, 화자 번호가 조각마다 다시 매겨질 수 있습니다. 내용을 보고 화자 이름을 바로잡아 주세요.');
  }
  return { text: texts.join('\n'), diarized: anyDiarized, notes };
}
