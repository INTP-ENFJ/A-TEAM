import { supabase } from '../lib/supabase';
import { DashboardSummary, DashboardTaskItem, User, UserRankCode } from '../types';
import { IDashboardService } from './apiInterfaces';
import { formatDateTime, normalizeArticleStatus } from './mappers';

/**
 * 뉴스룸 업무 대시보드(Task Dashboard) 전담 Service Layer
 * N+1 쿼리를 방지하며, RLS 정책을 준수하여 허용된 기사 및 피드백 데이터를 조회합니다.
 */
class DashboardService implements IDashboardService {
  async getDashboardTasks(currentUser: User): Promise<{
    tasks: DashboardTaskItem[];
    summary: DashboardSummary;
  }> {
    // 1. 접근 가능한 기사 목록 조회 (RLS가 안전하게 필터링)
    const { data: articles, error } = await supabase
      .from('articles')
      .select(`
        id,
        project_id,
        title,
        subtitle,
        status,
        author_id,
        updated_at,
        created_at,
        deadline_at,
        project:projects!articles_project_id_fkey(id, name),
        author:profiles!articles_author_id_fkey(id, name, department, rank, role)
      `)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[DashboardService.getDashboardTasks] Error fetching articles:', error);
      throw new Error(`대시보드 기사 목록을 불러오지 못했습니다: ${error.message}`);
    }

    if (!articles || articles.length === 0) {
      return {
        tasks: [],
        summary: {
          myDraftCount: 0,
          myChangesRequestedCount: 0,
          myInReviewCount: 0,
          myReadyCount: 0,
          myPublishedCount: 0,
          deskReviewQueueCount: 0,
          deskChangesRequestedCount: 0,
          deskReadyQueueCount: 0,
        },
      };
    }

    // 2. 수정 요청(changes_requested) 상태 기사의 사유 및 요청자 정보 벌크 조회 (N+1 방지)
    const changesArticleIds = articles
      .filter(a => normalizeArticleStatus(a.status) === 'changes_requested')
      .map(a => a.id);

    const feedbackMap = new Map<string, { reason: string; authorName: string; createdAt: string }>();

    if (changesArticleIds.length > 0) {
      // 2-1: article_feedbacks에서 최신 수정 요청 피드백 1회 조회
      const { data: fbData } = await supabase
        .from('article_feedbacks')
        .select('article_id, author_id, content, created_at')
        .in('article_id', changesArticleIds)
        .order('created_at', { ascending: false });

      // 작성자 이름은 따로 조회 (표 사이 연결 이름 문제로 400 오류가 나던 부분 방지)
      const nameOf = async (ids: string[]) => {
        const map = new Map<string, string>();
        const uniq = Array.from(new Set(ids.filter(Boolean)));
        if (uniq.length === 0) return map;
        const { data: profs } = await supabase.from('profiles').select('id, name').in('id', uniq);
        (profs || []).forEach((p: any) => map.set(p.id, p.name));
        return map;
      };
      const fbNames = await nameOf((fbData || []).map((f: any) => f.author_id));
      (fbData || []).forEach((f: any) => { f.author = { name: fbNames.get(f.author_id) }; });

      if (fbData) {
        fbData.forEach((fb: any) => {
          if (!feedbackMap.has(fb.article_id)) {
            const rawContent = fb.content || '';
            const cleaned = rawContent.replace(/^\[수정 요청 사유\]\s*/, '');
            const authorName = fb.author?.name || '데스크';
            feedbackMap.set(fb.article_id, {
              reason: cleaned,
              authorName,
              createdAt: formatDateTime(fb.created_at),
            });
          }
        });
      }

      // 2-2: article_feedbacks에 없는 경우 article_versions의 최신 '수정 요청: ' 요약으로 폴백
      const missingIds = changesArticleIds.filter(id => !feedbackMap.has(id));
      if (missingIds.length > 0) {
        const { data: verData } = await supabase
          .from('article_versions')
          .select('article_id, summary, created_at, created_by')
          .in('article_id', missingIds)
          .order('version_number', { ascending: false });
        const verNames = await nameOf((verData || []).map((v: any) => v.created_by));
        (verData || []).forEach((v: any) => { v.author = { name: verNames.get(v.created_by) }; });

        if (verData) {
          verData.forEach((v: any) => {
            if (!feedbackMap.has(v.article_id) && v.summary?.startsWith('수정 요청:')) {
              const cleaned = v.summary.replace(/^수정 요청:\s*/, '');
              const authorName = v.author?.name || '데스크';
              feedbackMap.set(v.article_id, {
                reason: cleaned,
                authorName,
                createdAt: formatDateTime(v.created_at),
              });
            }
          });
        }
      }
    }

    const now = new Date();
    const nowTime = now.getTime();
    const urgentThresholdMs = 24 * 60 * 60 * 1000; // 24시간

    // 3. DashboardTaskItem 매핑
    const rawTasks: DashboardTaskItem[] = articles.map((row: any) => {
      const normStatus = normalizeArticleStatus(row.status);
      const fb = feedbackMap.get(row.id);
      const deadlineAt = row.deadline_at || null;

      let isOverdue = false;
      let isUrgentDeadline = false;
      let deadlineFormatted: string | undefined = undefined;

      if (deadlineAt) {
        const dDate = new Date(deadlineAt);
        const dTime = dDate.getTime();
        if (!isNaN(dTime)) {
          const month = dDate.getMonth() + 1;
          const day = dDate.getDate();
          const hours = String(dDate.getHours()).padStart(2, '0');
          const minutes = String(dDate.getMinutes()).padStart(2, '0');
          deadlineFormatted = `${month}월 ${day}일 ${hours}:${minutes}`;

          // 마감 초과: 마감시간 지남 & 미출고 상태
          if (dTime < nowTime && normStatus !== 'published') {
            isOverdue = true;
          } else if (dTime >= nowTime && dTime - nowTime <= urgentThresholdMs && normStatus !== 'published') {
            // 마감 임박: 24시간 이내 & 미출고 상태
            isUrgentDeadline = true;
          }
        }
      }

      return {
        id: row.id,
        articleId: row.id,
        projectId: row.project_id || row.project?.id || '',
        projectName: row.project?.name || '프로젝트 없음',
        title: row.title || '제목 없음',
        subtitle: row.subtitle || undefined,
        status: normStatus,
        authorId: row.author_id,
        authorName: row.author?.name || '기자',
        authorEmail: row.author?.email,
        authorRank: (row.author?.rank as UserRankCode) || 'reporter',
        department: row.author?.department,
        updatedAt: row.updated_at,
        updatedAtFormatted: formatDateTime(row.updated_at),
        changesReason: fb?.reason,
        changesRequestedBy: fb?.authorName,
        changesRequestedAt: fb?.createdAt,
        deadlineAt,
        deadlineFormatted,
        isOverdue,
        isUrgentDeadline,
      };
    });

    // 업무 우선순위 정렬: 마감 초과(1) -> 마감 임박(2) -> 수정 요청(3) -> 최신 업데이트(4)
    const getTaskPriorityWeight = (t: DashboardTaskItem) => {
      if (t.isOverdue) return 4;
      if (t.isUrgentDeadline) return 3;
      if (t.status === 'changes_requested') return 2;
      return 1;
    };

    const tasks = [...rawTasks].sort((a, b) => {
      const weightA = getTaskPriorityWeight(a);
      const weightB = getTaskPriorityWeight(b);
      if (weightA !== weightB) {
        return weightB - weightA;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    // 4. 통계 계산
    const isUserAuthor = (t: DashboardTaskItem) => t.authorId === currentUser.id;

    const summary: DashboardSummary = {
      myDraftCount: tasks.filter(t => isUserAuthor(t) && t.status === 'draft').length,
      myChangesRequestedCount: tasks.filter(t => isUserAuthor(t) && t.status === 'changes_requested').length,
      myInReviewCount: tasks.filter(t => isUserAuthor(t) && t.status === 'review').length,
      myReadyCount: tasks.filter(t => isUserAuthor(t) && t.status === 'ready').length,
      myPublishedCount: tasks.filter(t => isUserAuthor(t) && t.status === 'published').length,
      deskReviewQueueCount: tasks.filter(t => t.status === 'review').length,
      deskChangesRequestedCount: tasks.filter(t => t.status === 'changes_requested').length,
      deskReadyQueueCount: tasks.filter(t => t.status === 'ready').length,
      urgentDeadlineCount: tasks.filter(t => t.isUrgentDeadline).length,
      overdueCount: tasks.filter(t => t.isOverdue).length,
    };

    return { tasks, summary };
  }
}

export const dashboardService = new DashboardService();
