/**
 * PRESS-CMS 본문 동기화 서비스 (새 본문 편집기 ↔ article_blocks)
 *
 * 새 편집기는 본문 전체를 하나의 문서로 다룬다. 이 서비스는 편집기에서 나온 "블록 초안 목록"을
 * DB(article_blocks)의 현재 상태와 비교해서
 *   1) 사라진 블록 삭제  2) 바뀐 블록 수정  3) 새 블록 생성  4) 순서 정리(reorder_article_blocks RPC)
 * 만 골라서 수행한다. DB 구조는 바꾸지 않고 기존 articleBlockService 기능만 재사용한다.
 */

import { ArticleBlock } from '../types';
import type { BodyBlockDraft } from '../components/editor/bodyEditorModel';
import { articleBlockService } from './articleBlockService';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRealBlockId = (id: unknown): id is string => typeof id === 'string' && UUID_RE.test(id);

interface BlockSnapshot {
  type: ArticleBlock['type'];
  text: string;
  caption: string;
  credit: string;
}

/** 이 기사에 대해 "DB에 지금 이렇게 저장되어 있다"고 알고 있는 상태 */
export interface BodySyncState {
  articleId: string;
  known: Map<string, BlockSnapshot>;
  order: string[];
}

const snap = (b: { type: ArticleBlock['type']; text?: string; caption?: string; credit?: string }): BlockSnapshot => ({
  type: b.type,
  text: b.text ?? '',
  caption: b.caption ?? '',
  credit: b.credit ?? '',
});

export function createBodySyncState(articleId: string, blocks: ArticleBlock[]): BodySyncState {
  const known = new Map<string, BlockSnapshot>();
  const order: string[] = [];
  for (const b of blocks) {
    if (isRealBlockId(b.id)) {
      known.set(b.id, snap(b));
      order.push(b.id);
    }
  }
  return { articleId, known, order };
}

/** 화면 글자 수 계산 (기존 편집기와 같은 규칙: 제목 + 부제 + 문단/인용구 글자) */
export function calcBodyCharCount(blocks: ArticleBlock[], title: string, subtitle?: string): number {
  let count = title.length + (subtitle || '').length;
  blocks.forEach(b => {
    if ((b.type === 'paragraph' || b.type === 'quote') && b.text) count += b.text.length;
  });
  return count;
}

export interface BodySyncResult {
  /** drafts 와 같은 순서의 실제 DB 블록 ID */
  ids: string[];
  /** 화면 상태(article.blocks)에 반영할 새 블록 목록 */
  blocks: ArticleBlock[];
}

export async function syncBodyDrafts(
  state: BodySyncState,
  drafts: BodyBlockDraft[]
): Promise<BodySyncResult> {
  const { articleId, known } = state;

  // 0. 초안의 ID 중 "DB에 있다고 알고 있는" 것만 인정한다. 나머지는 새 블록으로 본다.
  const seen = new Set<string>();
  const effIds: (string | undefined)[] = drafts.map(d => {
    if (d.id && isRealBlockId(d.id) && known.has(d.id) && !seen.has(d.id)) {
      seen.add(d.id);
      return d.id;
    }
    return undefined;
  });

  // 1. 삭제: 알고 있던 블록 중 문서에서 사라진 것
  const toDelete = Array.from(known.keys()).filter(id => !seen.has(id));
  for (const id of toDelete) {
    await articleBlockService.deleteBlock(id);
    known.delete(id);
    state.order = state.order.filter(x => x !== id);
  }

  // 2. 수정: 내용이 달라진 기존 블록
  for (let i = 0; i < drafts.length; i++) {
    const id = effIds[i];
    if (!id) continue;
    const d = drafts[i];
    const prev = known.get(id)!;
    const next = snap({ type: d.type, text: d.text, caption: d.caption, credit: d.credit });
    const updates: Partial<ArticleBlock> = {};
    if (d.type === 'paragraph') {
      if (prev.text !== next.text) updates.text = next.text;
    } else if (d.type === 'quote') {
      if (prev.text !== next.text) updates.text = next.text;
      if (prev.caption !== next.caption) updates.caption = next.caption;
    } else {
      if (prev.caption !== next.caption) updates.caption = next.caption;
      if (prev.credit !== next.credit) updates.credit = next.credit;
      // 사진 보이는 위치(focus) 기록
      if (prev.text !== next.text) updates.text = next.text;
    }
    if (Object.keys(updates).length > 0) {
      await articleBlockService.updateBlock(id, updates);
      known.set(id, { ...prev, ...next });
    }
  }

  // 3. 생성: ID가 없는 새 블록 (기존 블록 번호와 겹치지 않는 큰 임시 번호로 넣고, 4단계에서 정리)
  const newIdx: number[] = [];
  drafts.forEach((_, i) => { if (!effIds[i]) newIdx.push(i); });
  const finalIds: string[] = new Array(drafts.length);
  effIds.forEach((id, i) => { if (id) finalIds[i] = id; });

  if (newIdx.length > 0) {
    const tempBase = 1000000 + (Date.now() % 1000000) * 100;
    const paragraphIdx = newIdx.filter(i => drafts[i].type === 'paragraph');
    const otherIdx = newIdx.filter(i => drafts[i].type !== 'paragraph');

    if (paragraphIdx.length > 0) {
      const created = await articleBlockService.createBlocksBatch(
        articleId,
        paragraphIdx.map((di, k) => ({ type: 'paragraph' as const, text: drafts[di].text ?? '', positionIndex: tempBase + k }))
      );
      paragraphIdx.forEach((di, k) => {
        const row = created[k];
        finalIds[di] = row.id;
        known.set(row.id, snap({ type: 'paragraph', text: drafts[di].text }));
        state.order.push(row.id);
      });
    }
    for (let k = 0; k < otherIdx.length; k++) {
      const di = otherIdx[k];
      const d = drafts[di];
      const row = await articleBlockService.createBlock(
        articleId,
        {
          type: d.type,
          text: d.text,
          mediaUrl: d.mediaUrl,
          caption: d.caption,
          credit: d.credit,
          mediaType: d.mediaType,
          fileFormat: d.fileFormat,
          fileSize: d.fileSize,
        },
        tempBase + 5000 + k
      );
      finalIds[di] = row.id;
      known.set(row.id, snap({ type: d.type, text: d.text, caption: d.caption, credit: d.credit }));
      state.order.push(row.id);
    }
  }

  // 4. 순서 정리: 새 블록이 생겼거나 순서가 바뀐 경우에만 한 번에 정리
  const sameOrder =
    newIdx.length === 0 &&
    finalIds.length === state.order.length &&
    finalIds.every((id, i) => id === state.order[i]);
  if (!sameOrder && finalIds.length > 0) {
    await articleBlockService.reorderBlocks(articleId, finalIds);
  }
  state.order = [...finalIds];

  // 5. 화면 상태에 반영할 블록 목록
  const blocks: ArticleBlock[] = drafts.map((d, i) => ({
    id: finalIds[i],
    articleId,
    type: d.type,
    text: d.type === 'paragraph' || d.type === 'quote' ? d.text ?? '' : d.text,
    mediaUrl: d.mediaUrl,
    runtimeMediaUrl: d.runtimeMediaUrl,
    caption: d.caption,
    credit: d.credit,
    mediaType: d.mediaType,
    fileFormat: d.fileFormat,
    fileSize: d.fileSize,
  }));

  return { ids: finalIds, blocks };
}
