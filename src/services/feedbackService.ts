/**
 * PRESS-CMS Feedback Service
 * 
 * 기사 본문 드래그 피드백 및 데스크 피드백(`article_feedbacks`)의
 * CRUD와 앵커 데이터(block_id, selected_text, context_before, context_after 등)를
 * 전담하는 Supabase 서비스 레이어입니다.
 */

import { supabase } from '../lib/supabase';
import { ArticleFeedback, UserRankCode } from '../types';

export class FeedbackService {
  /**
   * 특정 기사에 속한 전체 피드백 조회 (작성자 프로필 결합)
   */
  async getFeedbacksByArticleId(articleId: string): Promise<ArticleFeedback[]> {
    const { data, error } = await supabase
      .from('article_feedbacks')
      .select(`
        id,
        article_id,
        block_id,
        author_id,
        content,
        created_at,
        updated_at,
        is_resolved,
        resolved_at,
        resolved_by,
        selected_text,
        context_before,
        context_after,
        start_offset,
        end_offset,
        color
      `)
      .eq('article_id', articleId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(`[FeedbackService.getFeedbacksByArticleId] Error:`, error);
      return [];
    }

    if (!data || data.length === 0) return [];

    // 작성자 ID 목록 추출
    const authorIds = Array.from(new Set(data.map(d => d.author_id).filter(Boolean)));
    const profilesMap = new Map<string, { name: string; rank: UserRankCode; roleTitle: string }>();

    if (authorIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, rank, role_title')
        .in('id', authorIds);

      if (profiles) {
        profiles.forEach(p => {
          profilesMap.set(p.id, {
            name: p.name || '익명 기자',
            rank: (p.rank as UserRankCode) || 'reporter',
            roleTitle: p.role_title || '',
          });
        });
      }
    }

    return data.map(row => {
      const author = profilesMap.get(row.author_id) || {
        name: '데스크/기자',
        rank: 'reporter' as UserRankCode,
        roleTitle: '',
      };

      const createdDate = row.created_at ? new Date(row.created_at) : new Date();
      const timeStr = `${String(createdDate.getHours()).padStart(2, '0')}:${String(createdDate.getMinutes()).padStart(2, '0')}`;

      return {
        id: row.id,
        articleId: row.article_id,
        blockId: row.block_id || undefined,
        authorId: row.author_id,
        authorName: author.name,
        authorRank: author.rank,
        authorRoleTitle: author.roleTitle,
        createdAt: timeStr,
        updatedAt: row.updated_at,
        content: row.content,
        isResolved: Boolean(row.is_resolved),
        selectedText: row.selected_text || undefined,
        contextBefore: row.context_before || undefined,
        contextAfter: row.context_after || undefined,
        startOffset: row.start_offset ?? undefined,
        endOffset: row.end_offset ?? undefined,
        color: (row.color as any) || 'emerald',
        replies: [],
      };
    });
  }

  /**
   * 새 피드백 메모 생성 (드래그 앵커 정보 영구 저장)
   */
  async createFeedback(
    articleId: string, 
    feedback: {
      content: string;
      blockId?: string;
      authorId?: string;
      selectedText?: string;
      contextBefore?: string;
      contextAfter?: string;
      startOffset?: number;
      endOffset?: number;
      color?: string;
    }
  ): Promise<ArticleFeedback> {
    const insertRow = {
      article_id: articleId,
      content: feedback.content,
      block_id: feedback.blockId || null,
      author_id: feedback.authorId || null,
      selected_text: feedback.selectedText || null,
      context_before: feedback.contextBefore || null,
      context_after: feedback.contextAfter || null,
      start_offset: feedback.startOffset ?? null,
      end_offset: feedback.endOffset ?? null,
      color: feedback.color || 'emerald',
      is_resolved: false,
    };

    const { data, error } = await supabase
      .from('article_feedbacks')
      .insert(insertRow)
      .select('*')
      .single();

    if (error || !data) {
      console.error('[FeedbackService.createFeedback] Insert error:', error);
      throw new Error(`피드백 생성에 실패했습니다: ${error?.message || ''}`);
    }

    const createdDate = new Date(data.created_at);
    const timeStr = `${String(createdDate.getHours()).padStart(2, '0')}:${String(createdDate.getMinutes()).padStart(2, '0')}`;

    return {
      id: data.id,
      articleId: data.article_id,
      blockId: data.block_id || undefined,
      authorId: data.author_id,
      authorName: '작성자',
      authorRank: 'reporter',
      authorRoleTitle: '',
      createdAt: timeStr,
      content: data.content,
      isResolved: false,
      selectedText: data.selected_text || undefined,
      contextBefore: data.context_before || undefined,
      contextAfter: data.context_after || undefined,
      startOffset: data.start_offset ?? undefined,
      endOffset: data.end_offset ?? undefined,
      color: (data.color as any) || 'emerald',
      replies: [],
    };
  }

  /**
   * 피드백 내용 수정
   */
  async updateFeedback(feedbackId: string, content: string): Promise<void> {
    const { error } = await supabase
      .from('article_feedbacks')
      .update({
        content,
        updated_at: new Date().toISOString(),
      })
      .eq('id', feedbackId);

    if (error) {
      console.error(`[FeedbackService.updateFeedback] Error:`, error);
      throw new Error(`피드백 수정 실패: ${error.message}`);
    }
  }

  /**
   * 피드백 해결 상태 토글
   */
  async toggleResolve(feedbackId: string, isResolved: boolean, resolvedBy?: string): Promise<void> {
    const { error } = await supabase
      .from('article_feedbacks')
      .update({
        is_resolved: isResolved,
        resolved_at: isResolved ? new Date().toISOString() : null,
        resolved_by: isResolved ? resolvedBy || null : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', feedbackId);

    if (error) {
      console.error(`[FeedbackService.toggleResolve] Error:`, error);
      throw new Error(`피드백 상태 변경 실패: ${error.message}`);
    }
  }

  /**
   * 피드백 삭제
   */
  async deleteFeedback(feedbackId: string): Promise<void> {
    const { error } = await supabase
      .from('article_feedbacks')
      .delete()
      .eq('id', feedbackId);

    if (error) {
      console.error(`[FeedbackService.deleteFeedback] Error:`, error);
      throw new Error(`피드백 삭제 실패: ${error.message}`);
    }
  }
}

export const feedbackService = new FeedbackService();
