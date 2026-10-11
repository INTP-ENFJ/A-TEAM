/**
 * PRESS-CMS Article Block Service
 * 
 * 기사 본문 블록(`article_blocks`)의 CRUD 및 원자적 순서 재정렬(`reorder_article_blocks`),
 * TXT 파일 대량 블록 임포트(`import_article_blocks`) RPC를 전담하는 서비스 레이어입니다.
 * 
 * [원칙]
 * - 클라이언트에서 여러 UPDATE 쿼리로 position_index를 변경하지 않으며,
 *   반드시 reorder_article_blocks RPC를 사용하여 순서를 안전하게 재배열합니다.
 * - 블록 목록은 항상 position_index ASC 순서로 반환합니다.
 */

import { supabase } from '../lib/supabase';
import { ArticleBlock } from '../types';
import { IArticleBlockService } from './apiInterfaces';
import { mediaService } from './mediaService';
import { 
  DbArticleBlockRow, 
  mapArticleBlockRowToArticleBlock, 
  mapArticleBlockToBlockUpdate 
} from './mappers';

// UUID 포맷 검증 헬퍼 (PostgreSQL 22P02 에러 원천 방지)
const isValidUuid = (id: string): boolean => {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
};

class ArticleBlockService implements IArticleBlockService {
  /**
   * 특정 기사에 속한 전체 블록 조회 (position_index ASC 정렬 + 런타임 Signed URL 주입)
   */
  async getBlocksByArticleId(articleId: string): Promise<ArticleBlock[]> {
    if (!isValidUuid(articleId)) return [];

    const { data, error } = await supabase
      .from('article_blocks')
      .select('*')
      .eq('article_id', articleId)
      .order('position_index', { ascending: true });

    if (error) {
      console.error(`[ArticleBlockService.getBlocksByArticleId] Error for article ${articleId}:`, error);
      throw new Error(`블록 목록을 조회하지 못했습니다: ${error.message}`);
    }

    if (!data) return [];
    const rawBlocks = (data as DbArticleBlockRow[]).map(mapArticleBlockRowToArticleBlock);

    // 5단계: 영속 storage reference를 가진 미디어 블록에 런타임 Signed URL 주입 (DB 저장 X)
    const resolvedBlocks = await Promise.all(
      rawBlocks.map(async (block) => {
        if ((block.type === 'image' || block.type === 'video') && block.mediaUrl) {
          const runtimeUrl = await mediaService.resolveArticleBlockMediaUrl(block.mediaUrl);
          return { ...block, runtimeMediaUrl: runtimeUrl };
        }
        return block;
      })
    );

    return resolvedBlocks;
  }

  /**
   * 새 블록 생성 (기본값: paragraph)
   */
  async createBlock(
    articleId: string, 
    block: Partial<ArticleBlock>, 
    positionIndex: number
  ): Promise<ArticleBlock> {
    const insertRow: Partial<DbArticleBlockRow> = {
      article_id: articleId,
      position_index: positionIndex,
      type: block.type || 'paragraph',
      text: block.text || '',
      media_url: block.mediaUrl || null,
      caption: block.caption || null,
      credit: block.credit || null,
      media_type: block.mediaType || null,
      file_format: block.fileFormat || null,
      file_size: block.fileSize || null,
    };

    const { data, error } = await supabase
      .from('article_blocks')
      .insert(insertRow)
      .select('*')
      .single();

    if (error || !data) {
      console.error('[ArticleBlockService.createBlock] Insert error:', error);
      throw new Error(`블록 생성에 실패했습니다: ${error?.message || ''}`);
    }

    const created = mapArticleBlockRowToArticleBlock(data as DbArticleBlockRow);
    if ((created.type === 'image' || created.type === 'video') && created.mediaUrl) {
      const runtimeUrl = await mediaService.resolveArticleBlockMediaUrl(created.mediaUrl);
      return { ...created, runtimeMediaUrl: runtimeUrl };
    }
    return created;
  }

  /**
   * 본문 임의 위치(targetIndex)에 미디어 블록 원자적 삽입 (DB RPC: insert_article_media_block)
   * - position_index UNIQUE 충돌을 DB 레벨에서 원천 차단하며 2단계 안전 음수 시프트 적용
   */
  async insertMediaBlockAt(
    articleId: string,
    block: Partial<ArticleBlock>,
    targetIndex: number
  ): Promise<ArticleBlock> {
    const { data, error } = await supabase.rpc('insert_article_media_block', {
      p_article_id: articleId,
      p_target_index: targetIndex,
      p_type: block.type || 'image',
      p_media_url: block.mediaUrl || '',
      p_caption: block.caption || null,
      p_credit: block.credit || null,
      p_media_type: block.mediaType || null,
      p_file_format: block.fileFormat || null,
      p_file_size: block.fileSize ? Number(block.fileSize) : null,
    });

    if (error || !data) {
      console.error('[ArticleBlockService.insertMediaBlockAt] RPC error:', error);
      throw new Error(`미디어 블록 삽입에 실패했습니다: ${error?.message || ''}`);
    }

    const created = mapArticleBlockRowToArticleBlock(data as DbArticleBlockRow);
    if ((created.type === 'image' || created.type === 'video') && created.mediaUrl) {
      const runtimeUrl = await mediaService.resolveArticleBlockMediaUrl(created.mediaUrl);
      return { ...created, runtimeMediaUrl: runtimeUrl };
    }
    return created;
  }

  /**
   * 본문 글자 중간 미디어 삽입 시: 텍스트 분할 및 미디어 원자적 삽입 (단일 트랜잭션 RPC)
   */
  async splitTextAndInsertMedia(params: {
    articleId: string;
    splitBlockId?: string;
    textBefore: string;
    textAfter: string;
    mediaType: 'image' | 'video';
    mediaUrl: string;
    caption?: string;
    credit?: string;
    fileFormat?: string;
    fileSize?: number | string;
    obsoleteBlockIds?: string[];
  }): Promise<{ success: boolean; split_block_id: string; media_block_id: string; after_block_id: string }> {
    const validSplitBlockId = (params.splitBlockId && isValidUuid(params.splitBlockId)) ? params.splitBlockId : null;
    const validObsoleteIds = (params.obsoleteBlockIds || []).filter(isValidUuid);

    const { data, error } = await supabase.rpc('split_article_text_and_insert_media', {
      p_article_id: params.articleId,
      p_split_block_id: validSplitBlockId,
      p_text_before: params.textBefore,
      p_text_after: params.textAfter,
      p_media_type: params.mediaType,
      p_media_url: params.mediaUrl,
      p_caption: params.caption || null,
      p_credit: params.credit || null,
      p_file_format: params.fileFormat || null,
      p_file_size: params.fileSize ? Number(params.fileSize) : null,
      p_obsolete_block_ids: validObsoleteIds,
    });

    if (error || !data) {
      console.error('[ArticleBlockService.splitTextAndInsertMedia] RPC error:', error);
      throw new Error(`미디어 분할 삽입에 실패했습니다: ${error?.message || ''}`);
    }

    return data;
  }

  /**
   * 여러 블록 일괄 생성 (대량 Paste 등 원자적 배치 삽입용 - 단 1회의 INSERT 트랜잭션)
   */
  async createBlocksBatch(
    articleId: string,
    blocks: Array<{ type?: 'paragraph' | 'image' | 'video' | 'quote'; text?: string; positionIndex: number }>
  ): Promise<ArticleBlock[]> {
    if (blocks.length === 0) return [];

    const insertRows = blocks.map(b => ({
      article_id: articleId,
      position_index: b.positionIndex,
      type: b.type || 'paragraph',
      text: b.text || '',
    }));

    const { data, error } = await supabase
      .from('article_blocks')
      .insert(insertRows)
      .select('*')
      .order('position_index', { ascending: true });

    if (error || !data) {
      console.error('[ArticleBlockService.createBlocksBatch] Insert error:', error);
      throw new Error(`대량 블록 일괄 생성에 실패했습니다: ${error?.message || ''}`);
    }

    return (data as DbArticleBlockRow[]).map(mapArticleBlockRowToArticleBlock);
  }

  /**
   * 특정 블록 업데이트 (텍스트, 캡션, 미디어 등)
   * [보호] 임시 ID(blk_p_...)는 DB에 아직 없으므로 22P02 에러 방지를 위해 UPDATE 생략
   */
  async updateBlock(blockId: string, updates: Partial<ArticleBlock>): Promise<ArticleBlock> {
    if (!isValidUuid(blockId)) {
      // 아직 DB INSERT 이전인 임시 블록의 경우 메모리 객체 반환
      return {
        id: blockId,
        type: updates.type || 'paragraph',
        text: updates.text || '',
      };
    }

    const dbUpdates = mapArticleBlockToBlockUpdate(updates);

    const { data, error } = await supabase
      .from('article_blocks')
      .update(dbUpdates)
      .eq('id', blockId)
      .select('*')
      .single();

    if (error || !data) {
      console.error(`[ArticleBlockService.updateBlock] Update error for ${blockId}:`, error);
      throw new Error(`블록 저장에 실패했습니다: ${error?.message || ''}`);
    }

    return mapArticleBlockRowToArticleBlock(data as DbArticleBlockRow);
  }

  /**
   * 특정 블록 삭제
   * [보호] 임시 ID(blk_p_...)는 DB에 없으므로 DELETE 생략
   */
  async deleteBlock(blockId: string): Promise<void> {
    if (!isValidUuid(blockId)) {
      return;
    }

    const { error } = await supabase
      .from('article_blocks')
      .delete()
      .eq('id', blockId);

    if (error) {
      console.error(`[ArticleBlockService.deleteBlock] Delete error for ${blockId}:`, error);
      throw new Error(`블록 삭제에 실패했습니다: ${error.message}`);
    }
  }

  /**
   * 원자적 RPC(reorder_article_blocks)를 통한 블록 전체 순서 재정렬
   * [보호] 유효한 UUID 블록들만 선별하여 RPC 호출 (22P02 방어)
   */
  async reorderBlocks(articleId: string, blockIds: string[]): Promise<void> {
    if (!isValidUuid(articleId)) return;
    const validBlockIds = blockIds.filter(isValidUuid);
    if (validBlockIds.length === 0) return;

    const { error } = await supabase.rpc('reorder_article_blocks', {
      p_article_id: articleId,
      p_block_ids: validBlockIds,
    });

    if (error) {
      console.error(`[ArticleBlockService.reorderBlocks] RPC error for article ${articleId}:`, error);
      throw new Error(`블록 순서 저장에 실패했습니다: ${error.message}`);
    }
  }

  /**
   * 원자적 RPC(import_article_blocks)를 통한 TXT 문단 일괄 삽입
   */
  async importTextBlocks(
    articleId: string, 
    paragraphs: string[], 
    replaceExisting: boolean = false
  ): Promise<string[]> {
    const { data, error } = await supabase.rpc('import_article_blocks', {
      p_article_id: articleId,
      p_mode: replaceExisting ? 'replace' : 'append',
      p_paragraphs: paragraphs,
    });

    if (error) {
      console.error(`[ArticleBlockService.importTextBlocks] RPC error for article ${articleId}:`, error);
      throw new Error(`문단 임포트에 실패했습니다: ${error.message}`);
    }

    if (!data) return [];
    return (data as Array<{ id: string }>).map(r => r.id);
  }
}

export const articleBlockService = new ArticleBlockService();
