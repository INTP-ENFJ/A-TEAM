/**
 * AI 이미지 만들기 도우미. 설명글 → 서버가 내 AI 키로 이미지를 만들어 돌려준다 (저장은 하지 않음).
 */
import { supabase } from '../lib/supabase';
import { friendlyAiError } from './aiErrors';

export type AiImageStyle = 'illustration' | 'flat' | 'photolike';

export const AI_IMAGE_STYLES: { value: AiImageStyle; label: string }[] = [
  { value: 'illustration', label: '일러스트' },
  { value: 'flat', label: '단순 그래픽' },
  { value: 'photolike', label: '사진 느낌' },
];

export interface GeneratedImage {
  file: File;
  previewUrl: string;
  model: string;
  provider: string;
}

function base64ToFile(base64: string, mimeType: string, name: string): File {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mimeType });
}

export async function generateAiImage(prompt: string, style: AiImageStyle): Promise<GeneratedImage> {
  const { data, error } = await supabase.functions.invoke('generate-image', { body: { prompt, style } });
  if (error) throw new Error(await friendlyAiError(error));
  if (!data || !data.success) throw new Error(data?.error || '이미지를 만들지 못했습니다.');
  const d = data.data as { mimeType: string; base64: string; model: string; provider: string };
  const ext = d.mimeType.includes('jpeg') ? 'jpg' : d.mimeType.includes('webp') ? 'webp' : 'png';
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const file = base64ToFile(d.base64, d.mimeType, `ai-image-${stamp}.${ext}`);
  return { file, previewUrl: URL.createObjectURL(file), model: d.model, provider: d.provider };
}
