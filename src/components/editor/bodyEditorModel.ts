import type { JSONContent } from '@tiptap/react';
import type { ArticleBlock, MediaItem } from '../../types';
import { parseCrop, formatCrop } from '../common/mediaCrop';

/**
 * 기사 본문 블록(DB 저장 구조) <-> 새 본문 편집기(TipTap 문서) 변환기.
 * - 문단 블록  → 편집기의 문단(paragraph)
 * - 사진/영상/인용구 블록 → 편집기의 "미디어 덩어리"(mediaBlock)
 * 저장 구조(DB)는 그대로 두고, 화면에서만 하나의 연속된 문서처럼 보이게 한다.
 */

export const MEDIA_NODE_NAME = 'mediaBlock';

/** 사진 블록 text 칸의 `focus:x,y,z` → 편집기 속성 문자열(`x,y,z`). 자르기 값이 없으면 null */
export function parseFocus(text: string | null | undefined): string | null {
  const c = parseCrop(text);
  return c ? formatCrop(c) : null;
}

/** 편집기 문서에서 다시 꺼낸 블록 초안 (아직 DB에 저장된 것이 아님) */
export interface BodyBlockDraft {
  /** 기존 DB 블록 ID. 새로 생긴 문단이면 undefined */
  id?: string;
  type: 'paragraph' | 'image' | 'video' | 'quote';
  text?: string;
  mediaUrl?: string;
  runtimeMediaUrl?: string;
  caption?: string;
  credit?: string;
  mediaType?: 'image' | 'video';
  fileFormat?: string;
  fileSize?: string;
}

function textToInline(text: string): JSONContent[] {
  const lines = text.split('\n');
  const out: JSONContent[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push({ type: 'hardBreak' });
    if (line.length > 0) out.push({ type: 'text', text: line });
  });
  return out;
}

/** 문단 한 개의 편집기 문서 조각 (줄바꿈 포함 글 → 문단) */
export function paragraphJson(text: string, blockId?: string): JSONContent {
  const inline = textToInline(text);
  return {
    type: 'paragraph',
    ...(blockId ? { attrs: { blockId } } : {}),
    ...(inline.length > 0 ? { content: inline } : {}),
  };
}

/** 편집기에 새로 넣을 사진/영상 덩어리의 속성 */
export interface BodyMediaAttrs {
  blockType: 'image' | 'video';
  mediaUrl: string | null;
  runtimeMediaUrl: string | null;
  caption: string;
  credit: string;
  focus?: string | null;
  mediaType: 'image' | 'video';
  fileFormat: string | null;
  fileSize: string | null;
}

/** 미디어 라이브러리 항목 → 편집기 사진/영상 덩어리 속성 (DB에는 영구 저장 경로를 기록) */
export function mediaItemToBodyAttrs(media: MediaItem): BodyMediaAttrs {
  const type = media.type === 'video' ? 'video' : 'image';
  return {
    blockType: type,
    mediaUrl: media.storagePath || media.url || null,
    runtimeMediaUrl: media.url || null,
    caption: media.caption || media.captionSuggestion || `▲ ${media.title}`,
    credit: media.credit || '기자 본인 촬영',
    mediaType: type,
    fileFormat: media.format ?? null,
    fileSize: media.fileSize ?? null,
  };
}

export function blocksToDoc(blocks: ArticleBlock[]): JSONContent {
  const content: JSONContent[] = blocks.map((b): JSONContent => {
    if (b.type === 'image' || b.type === 'video' || b.type === 'quote') {
      return {
        type: MEDIA_NODE_NAME,
        attrs: {
          blockId: b.id,
          blockType: b.type,
          mediaUrl: b.mediaUrl ?? null,
          runtimeMediaUrl: b.runtimeMediaUrl ?? null,
          caption: b.caption ?? '',
          credit: b.credit ?? '',
          text: b.type === 'quote' ? (b.text ?? '') : '',
          focus: b.type === 'quote' ? null : parseFocus(b.text),
          mediaType: b.mediaType ?? null,
          fileFormat: b.fileFormat ?? null,
          fileSize: b.fileSize ?? null,
        },
      };
    }
    // paragraph, heading 등 글 블록은 모두 문단으로 보여준다.
    const inline = textToInline(b.text ?? '');
    return {
      type: 'paragraph',
      attrs: { blockId: b.id },
      ...(inline.length > 0 ? { content: inline } : {}),
    };
  });

  // 문서가 완전히 비어 있으면 빈 문단 하나를 둔다 (커서를 놓을 자리)
  if (content.length === 0) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}

function inlineToText(nodes: JSONContent[] | undefined): string {
  if (!nodes) return '';
  return nodes
    .map(n => {
      if (n.type === 'hardBreak') return '\n';
      if (n.type === 'text') return n.text ?? '';
      return '';
    })
    .join('');
}

export function docToBlocks(doc: JSONContent): BodyBlockDraft[] {
  const seenIds = new Set<string>();
  const claimId = (raw: unknown): string | undefined => {
    // Enter로 문단을 나누면 같은 ID가 복사되므로, 처음 나온 하나만 ID를 유지한다.
    if (typeof raw !== 'string' || raw.length === 0 || seenIds.has(raw)) return undefined;
    seenIds.add(raw);
    return raw;
  };

  const result: BodyBlockDraft[] = [];
  for (const node of doc.content ?? []) {
    if (node.type === MEDIA_NODE_NAME) {
      const a = node.attrs ?? {};
      const type = a.blockType === 'video' ? 'video' : a.blockType === 'quote' ? 'quote' : 'image';
      result.push({
        id: claimId(a.blockId),
        type,
        text: type === 'quote' ? (a.text ?? '') : (a.focus ? `focus:${a.focus}` : undefined),
        mediaUrl: a.mediaUrl ?? undefined,
        runtimeMediaUrl: a.runtimeMediaUrl ?? undefined,
        caption: a.caption ?? '',
        credit: a.credit ?? '',
        mediaType: a.mediaType ?? undefined,
        fileFormat: a.fileFormat ?? undefined,
        fileSize: a.fileSize ?? undefined,
      });
    } else if (node.type === 'paragraph') {
      result.push({
        id: claimId(node.attrs?.blockId),
        type: 'paragraph',
        text: inlineToText(node.content),
      });
    }
  }
  return result;
}
