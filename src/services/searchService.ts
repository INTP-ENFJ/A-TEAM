import { supabase } from '../lib/supabase';
import { 
  GlobalSearchResult, 
  SearchResultArticle, 
  SearchResultProject, 
  ArticleStatus, 
  ProjectVisibility 
} from '../types';
import { ISearchService } from './apiInterfaces';
import { formatTimeAgo } from './notificationService';
import { normalizeArticleStatus } from './mappers';

/**
 * PRESS-CMS 기사·프로젝트 통합 검색(Global Search) 전담 Service Layer
 * 클라이언트 전체 다운로드 필터링을 절대 하지 않으며,
 * Supabase DB ILIKE 쿼리와 RLS 정책을 통해 사용자가 접근 가능한 기사 및 프로젝트만 안전하게 검색합니다.
 */
class SearchService implements ISearchService {
  /**
   * 검색어를 정제하여 SQL injection 및 PostgREST 쿼리 문법 충돌을 방지합니다.
   * Supabase .or() 필터의 구분자인 쉼표(,), 따옴표, 괄호 및 ILIKE 특수문자(%, _)를 안전하게 제거하거나 이스케이프합니다.
   */
  private sanitizeSearchQuery(query: string): string {
    return query
      .trim()
      .replace(/[%_,()'"\\]/g, '') // 쿼리 문법 및 와일드카드 문자 정제
      .slice(0, 50);              // 비정상적으로 긴 쿼리 차단
  }

  async search(rawQuery: string): Promise<GlobalSearchResult> {
    const cleanQuery = this.sanitizeSearchQuery(rawQuery);

    // 0~1글자 검색어는 DB 요청을 수행하지 않음
    if (!cleanQuery || cleanQuery.length < 2) {
      return {
        articles: [],
        projects: [],
        totalCount: 0,
      };
    }

    try {
      // 기사(최대 10건) 및 프로젝트(최대 5건) 병렬 조회 (단일 왕복)
      const [articlesResult, projectsResult] = await Promise.all([
        supabase
          .from('articles')
          .select(`
            id,
            project_id,
            title,
            subtitle,
            category,
            tags,
            status,
            updated_at,
            project:projects!articles_project_id_fkey(name),
            author:profiles!articles_author_id_fkey(name, department)
          `)
          .or(`title.ilike.%${cleanQuery}%,subtitle.ilike.%${cleanQuery}%,category.ilike.%${cleanQuery}%`)
          .order('updated_at', { ascending: false })
          .limit(10),

        supabase
          .from('projects')
          .select(`
            id,
            name,
            article_title,
            visibility,
            updated_at,
            owner:profiles!projects_owner_id_fkey(name, department)
          `)
          .or(`name.ilike.%${cleanQuery}%,article_title.ilike.%${cleanQuery}%`)
          .order('updated_at', { ascending: false })
          .limit(5),
      ]);

      if (articlesResult.error) {
        console.error('[SearchService.search] Articles search error:', articlesResult.error);
      }
      if (projectsResult.error) {
        console.error('[SearchService.search] Projects search error:', projectsResult.error);
      }

      // 기사 결과 매핑
      const articles: SearchResultArticle[] = (articlesResult.data || []).map((row: any) => {
        const projectData = Array.isArray(row.project) ? row.project[0] : row.project;
        const authorData = Array.isArray(row.author) ? row.author[0] : row.author;

        return {
          id: row.id,
          projectId: row.project_id,
          projectName: projectData?.name || '프로젝트',
          title: row.title || '제목 없음',
          subtitle: row.subtitle || undefined,
          category: row.category || undefined,
          tags: Array.isArray(row.tags) ? row.tags : [],
          status: normalizeArticleStatus(row.status) as ArticleStatus,
          authorName: authorData?.name || undefined,
          authorDepartment: authorData?.department || undefined,
          updatedAt: row.updated_at,
          updatedAtFormatted: formatTimeAgo(row.updated_at),
        };
      });

      // 프로젝트 결과 매핑
      const projects: SearchResultProject[] = (projectsResult.data || []).map((row: any) => {
        const ownerData = Array.isArray(row.owner) ? row.owner[0] : row.owner;

        return {
          id: row.id,
          name: row.name,
          articleTitle: row.article_title || undefined,
          visibility: (row.visibility as ProjectVisibility) || 'private',
          ownerName: ownerData?.name || undefined,
          ownerDepartment: ownerData?.department || undefined,
          updatedAt: row.updated_at,
          updatedAtFormatted: formatTimeAgo(row.updated_at),
        };
      });

      return {
        articles,
        projects,
        totalCount: articles.length + projects.length,
      };
    } catch (err) {
      console.error('[SearchService.search] Unexpected search error:', err);
      throw new Error('통합 검색 처리 중 오류가 발생했습니다.');
    }
  }
}

export const searchService = new SearchService();
