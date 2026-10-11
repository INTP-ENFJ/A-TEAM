/**
 * PRESS-CMS Article Service
 * 
 * Supabase DB `articles` 테이블의 메타데이터/상태 관리 및
 * 전용 보안 RPC(`publish_article`)를 통한 안전한 최종 출고를 전담합니다.
 * 
 * [보안 원칙]
 * - 일반 기사 수정: articles UPDATE RLS 준수 (작성자/소유자만 수정 가능).
 * - 기사 출고: 일반 update 쿼리로 'published'를 변경하지 않고,
 *   반드시 보안 경계가 설정된 `publish_article` RPC를 통해서만 출고를 진행합니다.
 * - 제목(title)은 깨끗한 문자열만 저장하며, exclusive / urgent boolean 플래그가 단일 진실 공급원입니다.
 */

import { supabase } from '../lib/supabase';
import { Article, ArticleBlock, PublishPreflightResult } from '../types';
import { IArticleService } from './apiInterfaces';
import { articleBlockService } from './articleBlockService';
import { 
  DbArticleRow, 
  DbProjectRow, 
  mapArticleRowToArticle, 
  mapArticleToArticleUpdate,
  mapArticleToContentOnlyUpdate
} from './mappers';

export class ArticleConflictError extends Error {
  public serverUpdatedAt?: string;
  public serverTitle?: string;

  constructor(message: string, serverUpdatedAt?: string, serverTitle?: string) {
    super(message);
    this.name = 'ArticleConflictError';
    this.serverUpdatedAt = serverUpdatedAt;
    this.serverTitle = serverTitle;
  }
}

class ArticleService implements IArticleService {
  /**
   * 프로젝트 ID로 기사 단건 및 하위 블록 조회
   * (현재 프로젝트당 대표 기사 1건 모델)
   */
  async getArticleByProjectId(projectId: string): Promise<Article> {
    // 1. 부모 프로젝트 정보 조회
    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (projectError || !projectData) {
      console.error(`[ArticleService.getArticleByProjectId] Project not found: ${projectId}`, projectError);
      throw new Error(`프로젝트 정보를 조회할 수 없습니다: ${projectError?.message || ''}`);
    }

    const projectRow = projectData as DbProjectRow;

    // 2. 프로젝트에 속한 기사 조회
    const { data: articleData, error: articleError } = await supabase
      .from('articles')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (articleError || !articleData) {
      console.error(`[ArticleService.getArticleByProjectId] Article not found for project: ${projectId}`, articleError);
      throw new Error(`기사 정보를 조회할 수 없습니다: ${articleError?.message || ''}`);
    }

    const articleRow = articleData as DbArticleRow;

    // 3. 하위 블록 목록 조회 (position_index ASC)
    const blocks: ArticleBlock[] = await articleBlockService.getBlocksByArticleId(articleRow.id);

    return mapArticleRowToArticle(articleRow, blocks, {
      name: projectRow.name,
      reporter: projectRow.owner?.name,
      desk: projectRow.owner?.department || '정치부',
      visibility: projectRow.visibility as any,
    });
  }

  /**
   * 기사 ID로 기사 단건 및 하위 블록 조회
   */
  async getArticleById(articleId: string): Promise<Article> {
    const { data: articleData, error: articleError } = await supabase
      .from('articles')
      .select('*')
      .eq('id', articleId)
      .single();

    if (articleError || !articleData) {
      console.error(`[ArticleService.getArticleById] Article not found: ${articleId}`, articleError);
      throw new Error(`기사 정보를 조회할 수 없습니다: ${articleError?.message || ''}`);
    }

    const articleRow = articleData as DbArticleRow;

    // 부모 프로젝트 정보 조회 (owner profiles 포함)
    const { data: projectData } = await supabase
      .from('projects')
      .select('*, owner:profiles!projects_owner_id_fkey(name, department)')
      .eq('id', articleRow.project_id)
      .single();

    const projectRow = projectData as DbProjectRow | null;

    // 하위 블록 목록 조회
    const blocks: ArticleBlock[] = await articleBlockService.getBlocksByArticleId(articleId);

    return mapArticleRowToArticle(articleRow, blocks, projectRow ? {
      name: projectRow.name,
      reporter: projectRow.owner?.name,
      desk: projectRow.owner?.department || '정치부',
      visibility: projectRow.visibility as any,
    } : undefined);
  }

  /**
   * 기사 메타데이터(제목, 부제, 카테고리, 태그, 상태, 단독/속보 등) 수정
   * 
   * [주의] 최종 출고('published')는 이 메서드로 수행하지 않고 publishArticle() RPC를 호출해야 합니다.
   */
  async updateArticle(
    articleId: string, 
    updates: Partial<Article>,
    options?: { expectedUpdatedAt?: string; contentOnly?: boolean }
  ): Promise<Article> {
    // 1. contentOnly 기본값 true: status, author_id, deadline_at 등 워크플로우/배정 필드 누출 방지
    const dbUpdates = (options?.contentOnly === false)
      ? mapArticleToArticleUpdate(updates)
      : mapArticleToContentOnlyUpdate(updates);

    // 2. Optimistic Concurrency 검증: 다른 사용자가 먼저 수정한 경우 감지
    if (options?.expectedUpdatedAt) {
      const { data: currentData } = await supabase
        .from('articles')
        .select('updated_at, title')
        .eq('id', articleId)
        .maybeSingle();

      if (currentData && currentData.updated_at && currentData.updated_at !== options.expectedUpdatedAt) {
        console.warn(`[ArticleService.updateArticle] Concurrency conflict detected on article ${articleId}. Server: ${currentData.updated_at}, Expected: ${options.expectedUpdatedAt}`);
        throw new ArticleConflictError(
          '다른 사용자가 이 기사를 수정했습니다. 현재 작성 내용을 덮어쓰지 않도록 저장을 중단했습니다.',
          currentData.updated_at,
          currentData.title
        );
      }
    }

    const { data, error } = await supabase
      .from('articles')
      .update(dbUpdates)
      .eq('id', articleId)
      .select('*')
      .single();

    if (error || !data) {
      console.error(`[ArticleService.updateArticle] Failed for article ${articleId}:`, error);
      throw new Error(`기사 저장에 실패했습니다: ${error?.message || ''}`);
    }

    // 프로젝트의 article_title 및 char_count 동기화 (제목이 변경된 경우)
    if (updates.title !== undefined || updates.charCount !== undefined) {
      const projUpdates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (updates.title !== undefined) projUpdates.article_title = updates.title;
      if (updates.charCount !== undefined) projUpdates.char_count = updates.charCount;

      const articleRow = data as DbArticleRow;
      await supabase
        .from('projects')
        .update(projUpdates)
        .eq('id', articleRow.project_id);
    }

    // 기존 블록을 유지한 상태로 매핑
    return mapArticleRowToArticle(data as DbArticleRow, updates.blocks || []);
  }

  /**
   * 원자적 보안 RPC(publish_article)를 통한 안전한 최종 기사 출고
   */
  async publishArticle(
    articleId: string, 
    channels: string[]
  ): Promise<{ success: boolean; publishedAt: string }> {
    const { data, error } = await supabase.rpc('publish_article', {
      p_article_id: articleId,
      p_channels: channels,
    });

    if (error) {
      console.error(`[ArticleService.publishArticle] RPC error for article ${articleId}:`, error);
      throw new Error(`기사 출고에 실패했습니다: ${error.message}`);
    }

    if (!data) {
      throw new Error('출고 결과 데이터가 비어 있습니다.');
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      success: row?.status === 'published',
      publishedAt: row?.updated_at || new Date().toISOString(),
    };
  }

  /**
   * 전용 RPC(validate_article_for_publish)를 통한 출고 전 사전 종합 검증
   */
  async validatePublishPreflight(
    articleId: string,
    channels?: string[]
  ): Promise<PublishPreflightResult> {
    const { data, error } = await supabase.rpc('validate_article_for_publish', {
      p_article_id: articleId,
      p_channels: channels && channels.length > 0 ? channels : null,
    });

    if (error) {
      console.error(`[ArticleService.validatePublishPreflight] RPC error for article ${articleId}:`, error);
      throw new Error(`출고 사전 검증에 실패했습니다: ${error.message}`);
    }

    return data as PublishPreflightResult;
  }

  /**
   * 기사 상태 직접 변경 (에디터 및 대시보드 상태 동기화)
   */
  async updateArticleStatus(articleId: string, status: string): Promise<void> {
    const { error } = await supabase
      .from('articles')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', articleId);

    if (error) {
      console.error(`[ArticleService.updateArticleStatus] Failed for article ${articleId}:`, error);
      throw new Error(`기사 상태 변경에 실패했습니다: ${error.message}`);
    }
  }
}

export const articleService = new ArticleService();
