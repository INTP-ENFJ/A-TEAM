/**
 * PRESS-CMS Project Service
 * 
 * Supabase DB의 `projects` 테이블 및 `create_project_with_initial_article` RPC를
 * 단일 진실 공급원(Single Source of Truth)으로 다루는 서비스 레이어입니다.
 * 
 * [설계 아키텍처 및 가정]
 * - RLS 정책을 준수하여 현재 세션 사용자가 접근 가능한 프로젝트 목록만 안전하게 반환합니다.
 * - 현재 UI 시스템은 "프로젝트당 대표 기사 1건" 모델을 가정하고 있습니다.
 *   DB 스키마는 향후 1개 프로젝트 내 다수 기사 확장을 허용하도록 다대일 관계를 유지하며,
 *   임의의 UNIQUE 제약조건을 강제하지 않습니다.
 */

import { supabase } from '../lib/supabase';
import { Project, ProjectVisibility } from '../types';
import { CreateProjectParams, IProjectService } from './apiInterfaces';
import { 
  DbProjectRow, 
  mapProjectRowToProject, 
  mapProjectToProjectUpdate 
} from './mappers';

class ProjectService implements IProjectService {
  /**
   * 접근 가능한 프로젝트 목록 조회
   * RLS가 owner_id = auth.uid() 이거나 shared + non-draft 인 프로젝트,
   * 또는 같은 부서 manager인 경우 ready 프로젝트를 자동으로 필터링합니다.
   */
  async getProjects(): Promise<Project[]> {
    const { data, error } = await supabase
      .from('projects')
      .select(`
        *,
        owner:profiles!projects_owner_id_fkey(name, department),
        shared_user:profiles!projects_shared_by_fkey(name),
        articles(id, status, title)
      `)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[ProjectService.getProjects] Failed to fetch projects:', error);
      throw new Error(`프로젝트 목록을 불러오는 중 오류가 발생했습니다: ${error.message}`);
    }

    if (!data) return [];
    return (data as unknown as DbProjectRow[]).map(mapProjectRowToProject);
  }

  /**
   * 특정 프로젝트 단건 조회
   */
  async getProjectById(projectId: string): Promise<Project> {
    const { data, error } = await supabase
      .from('projects')
      .select(`
        *,
        owner:profiles!projects_owner_id_fkey(name, department),
        shared_user:profiles!projects_shared_by_fkey(name),
        articles(id, status, title)
      `)
      .eq('id', projectId)
      .single();

    if (error || !data) {
      console.error(`[ProjectService.getProjectById] Project ${projectId} not found:`, error);
      throw new Error(`프로젝트를 찾을 수 없습니다: ${error?.message || ''}`);
    }

    return mapProjectRowToProject(data as unknown as DbProjectRow);
  }

  /**
   * 원자적 RPC(create_project_with_initial_article)를 사용하여
   * 프로젝트 + 초기 기사 + 첫 번째 문단 블록을 한 번에 생성합니다.
   */
  async createProject(params: CreateProjectParams): Promise<{
    projectId: string;
    articleId: string;
    initialBlockId: string;
  }> {
    const rpcParams: Record<string, any> = {
      p_name: params.name.trim(),
      p_article_title: params.articleTitle.trim(),
    };

    if (params.category && params.category.trim()) {
      rpcParams.p_category = params.category.trim();
    }
    if (params.coverageType && params.coverageType.trim()) {
      rpcParams.p_coverage_type = params.coverageType.trim();
    }
    if (params.deadline && params.deadline.trim()) {
      rpcParams.p_deadline = params.deadline.trim();
    }

    const { data, error } = await supabase.rpc('create_project_with_initial_article', rpcParams);

    if (error) {
      console.error('[ProjectService.createProject] RPC error:', error);
      throw new Error(`프로젝트 생성에 실패했습니다: ${error.message}`);
    }

    if (!data || !data[0]) {
      throw new Error('프로젝트 생성 결과 데이터가 비어 있습니다.');
    }

    const row = data[0];
    return {
      projectId: row.project_id,
      articleId: row.article_id,
      initialBlockId: row.initial_block_id,
    };
  }

  /**
   * 프로젝트 메타데이터(이름, 기사 제목 등) 수정
   */
  async updateProject(projectId: string, updates: Partial<Project>): Promise<Project> {
    const dbUpdates = mapProjectToProjectUpdate(updates);

    const { data, error } = await supabase
      .from('projects')
      .update(dbUpdates)
      .eq('id', projectId)
      .select('*')
      .single();

    if (error || !data) {
      console.error(`[ProjectService.updateProject] Error updating project ${projectId}:`, error);
      throw new Error(`프로젝트 업데이트에 실패했습니다: ${error?.message || ''}`);
    }

    return mapProjectRowToProject(data as DbProjectRow);
  }

  /**
   * 프로젝트 삭제
   * DB 외래키 CASCADE 규칙에 따라 연결된 articles 및 article_blocks도 함께 삭제됩니다.
   */
  async deleteProject(projectId: string): Promise<void> {
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId);

    if (error) {
      console.error(`[ProjectService.deleteProject] Error deleting project ${projectId}:`, error);
      throw new Error(`프로젝트 삭제에 실패했습니다: ${error.message}`);
    }
  }

  /**
   * 프로젝트 전체 공유 상태 토글
   */
  async toggleShareProject(
    projectId: string, 
    nextVisibility: ProjectVisibility
  ): Promise<Project> {
    const nowIso = new Date().toISOString();
    const { data: { session } } = await supabase.auth.getSession();
    const currentUid = session?.user?.id || null;

    const dbUpdates: Record<string, unknown> = {
      visibility: nextVisibility,
      shared_at: nextVisibility === 'shared' ? nowIso : null,
      shared_by: nextVisibility === 'shared' ? currentUid : null,
      updated_at: nowIso,
    };

    const { data, error } = await supabase
      .from('projects')
      .update(dbUpdates)
      .eq('id', projectId)
      .select(`
        *,
        owner:profiles!projects_owner_id_fkey(name, department),
        shared_user:profiles!projects_shared_by_fkey(name),
        articles(id, status, title)
      `)
      .maybeSingle();

    if (error) {
      console.error(`[ProjectService.toggleShareProject] Failed for ${projectId}:`, error);
      throw new Error(`프로젝트 공개 범위 변경에 실패했습니다: ${error.message}`);
    }

    if (!data) {
      // RLS 등으로 update 후 반환 row가 비어있는 경우 단건 조회로 보완
      return this.getProjectById(projectId);
    }

    return mapProjectRowToProject(data as unknown as DbProjectRow);
  }

  /**
   * 대시보드에서 프로젝트(기사) 상태 즉시 변경
   */
  async updateProjectStatus(projectId: string, nextStatus: string): Promise<void> {
    const { error } = await supabase
      .from('articles')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('project_id', projectId);

    if (error) {
      console.error(`[ProjectService.updateProjectStatus] Failed for ${projectId}:`, error);
      throw new Error(`상태 변경에 실패했습니다: ${error.message}`);
    }
  }
}

export const projectService = new ProjectService();
