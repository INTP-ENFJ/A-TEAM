import { supabase } from '../lib/supabase';
import { Article } from '../types';
import { IArticleWorkflowService } from './apiInterfaces';
import { articleService } from './articleService';

/**
 * 기사 검토·승인 Workflow 전담 Service Layer
 * Supabase RPC(request_article_review, request_article_changes, approve_article)를 안전하게 캡슐화합니다.
 */
class ArticleWorkflowService implements IArticleWorkflowService {
  /**
   * 기사 작성자의 검토 요청 (DRAFT -> IN_REVIEW) 또는 재검토 요청 (CHANGES_REQUESTED -> IN_REVIEW)
   */
  async requestReview(articleId: string): Promise<Article> {
    const { error } = await supabase.rpc('request_article_review', {
      p_article_id: articleId,
    });

    if (error) {
      console.error('[ArticleWorkflowService.requestReview] RPC Error:', error);
      throw new Error(error.message || '기사 검토 요청에 실패했습니다.');
    }

    // 최신 기사 전체 객체(블록, 피드백 등)를 재조회하여 완벽 동기화
    return await articleService.getArticleById(articleId);
  }

  /**
   * 데스크의 수정 요청 (IN_REVIEW -> CHANGES_REQUESTED)
   */
  async requestChanges(articleId: string, reason: string): Promise<Article> {
    const trimmed = reason.trim();
    if (!trimmed) {
      throw new Error('수정 요청 사유를 입력해주세요.');
    }

    const { error } = await supabase.rpc('request_article_changes', {
      p_article_id: articleId,
      p_feedback: trimmed,
    });

    if (error) {
      console.error('[ArticleWorkflowService.requestChanges] RPC Error:', error);
      throw new Error(error.message || '수정 요청 처리에 실패했습니다.');
    }

    return await articleService.getArticleById(articleId);
  }

  /**
   * 데스크의 기사 승인 (IN_REVIEW -> APPROVED/ready)
   */
  async approveArticle(articleId: string): Promise<Article> {
    const { error } = await supabase.rpc('approve_article', {
      p_article_id: articleId,
    });

    if (error) {
      console.error('[ArticleWorkflowService.approveArticle] RPC Error:', error);
      throw new Error(error.message || '기사 승인 처리에 실패했습니다.');
    }

    return await articleService.getArticleById(articleId);
  }

  /**
   * 데스크의 기사 배정 및 마감시간 설정 (assign_article RPC)
   */
  async assignArticle(
    articleId: string, 
    authorId: string, 
    deadlineAt: string | null
  ): Promise<Article> {
    const { error } = await supabase.rpc('assign_article_and_deadline', {
      p_article_id: articleId,
      p_author_id: authorId,
      p_deadline_at: deadlineAt || null,
    });

    if (error) {
      console.error('[ArticleWorkflowService.assignArticle] RPC Error:', error);
      throw new Error(error.message || '기사 배정 및 마감시간 변경에 실패했습니다.');
    }

    return await articleService.getArticleById(articleId);
  }

  /**
   * 데스크의 동일 부서 소속 기자 목록 조회 (get_department_reporters RPC)
   */
  async getDepartmentReporters(): Promise<import('../types').DepartmentReporter[]> {
    const { data, error } = await supabase.rpc('get_department_reporters');

    if (error) {
      console.error('[ArticleWorkflowService.getDepartmentReporters] RPC Error:', error);
      throw new Error(error.message || '부서 기자 목록을 불러오지 못했습니다.');
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      rank: row.rank,
      role: row.role,
      department: row.department,
    }));
  }
}

export const articleWorkflowService = new ArticleWorkflowService();

