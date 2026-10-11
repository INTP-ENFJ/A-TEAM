import React, { useState, useRef, useEffect } from 'react';
import { VisibilityPicker } from '../common/VisibilityPicker';
import { createPortal } from 'react-dom';
import {
  Plus,
  Search,
  MoreVertical,
  ExternalLink,
  Edit3,
  Copy,
  Trash2,
  Clock,
  Calendar,
  User as UserIcon,
  CheckCircle2,
  X,
  FolderKanban,
  Globe,
  Lock,
  Share2,
  ListTodo,
  FolderGit2,
  RotateCw
} from 'lucide-react';
import { Project, ProjectStatus, User, DashboardTaskItem, DashboardSummary, isDeskUser, ProjectVisibility } from '../../types';
import { ArticleStatusBadge } from '../common/ArticleStatusBadge';
import { dashboardService } from '../../services/dashboardService';
import { TaskDashboardView } from './TaskDashboardView';

interface ProjectDashboardProps {
  projects: Project[];
  isLoadingProjects?: boolean;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (newProject: Partial<Project>) => void;
  onRenameProject?: (projectId: string, newName: string, newArticleTitle?: string) => void;
  onDuplicateProject?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  onToggleShareProject?: (projectId: string) => void;
  onChangeStatus?: (projectId: string, newStatus: string) => void;
  onChangeVisibility?: (projectId: string, nextVisibility: ProjectVisibility) => void;
  currentUser: User;
}

export const ProjectDashboard: React.FC<ProjectDashboardProps> = ({
  projects,
  isLoadingProjects = false,
  onSelectProject,
  onCreateProject,
  onRenameProject,
  onDuplicateProject,
  onDeleteProject,
  onToggleShareProject,
  onChangeStatus,
  onChangeVisibility,
  currentUser,
}) => {
  // View state: 'tasks' (뉴스룸 업무 큐) vs 'projects' (프로젝트 관리)
  // 마지막으로 보던 화면을 기억 (편집기에서 돌아오면 '프로젝트 관리'로 열림)
  const DASHBOARD_VIEW_KEY = 'press-cms-dashboard-view';
  const [activeView, setActiveViewState] = useState<'tasks' | 'projects'>(() => {
    try { return window.sessionStorage.getItem(DASHBOARD_VIEW_KEY) === 'projects' ? 'projects' : 'tasks'; } catch { return 'tasks'; }
  });
  const setActiveView = (v: 'tasks' | 'projects') => {
    setActiveViewState(v);
    try { window.sessionStorage.setItem(DASHBOARD_VIEW_KEY, v); } catch { /* 무시 */ }
  };
  const [tasks, setTasks] = useState<DashboardTaskItem[]>([]);
  const [summary, setSummary] = useState<DashboardSummary>({
    myDraftCount: 0,
    myChangesRequestedCount: 0,
    myInReviewCount: 0,
    myReadyCount: 0,
    myPublishedCount: 0,
    deskReviewQueueCount: 0,
    deskChangesRequestedCount: 0,
    deskReadyQueueCount: 0,
  });
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);

  // Filter states
  const [activeTab, setActiveTab] = useState<'my' | 'all' | 'review_queue'>('my');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'review' | 'ready'>('all');

  // Load Dashboard Tasks (silent=true 이면 로딩 표시 없이 조용히 갱신하고, 내용이 달라졌을 때만 화면을 바꾼다)
  const lastTasksJsonRef = useRef<string>('');
  const loadDashboardTasks = React.useCallback(async (silent = false) => {
    try {
      if (!silent) setIsLoadingTasks(true);
      const res = await dashboardService.getDashboardTasks(currentUser);
      const json = JSON.stringify(res);
      if (json !== lastTasksJsonRef.current) {
        lastTasksJsonRef.current = json;
        setTasks(res.tasks);
        setSummary(res.summary);
      }
    } catch (err) {
      console.error('[ProjectDashboard] loadDashboardTasks error:', err);
    } finally {
      if (!silent) setIsLoadingTasks(false);
    }
  }, [currentUser]);

  useEffect(() => {
    loadDashboardTasks();
  }, [loadDashboardTasks, projects]);

  // 다른 사람이 검토 요청·수정 요청을 했을 때 새로고침 없이 반영: 20초마다, 그리고 이 창으로 돌아왔을 때 조용히 다시 불러온다
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') loadDashboardTasks(true);
    };
    const timer = window.setInterval(refresh, 20000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [loadDashboardTasks]);

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  // Form states for Create Modal
  const [newProjectName, setNewProjectName] = useState('');
  const [newArticleTitle, setNewArticleTitle] = useState('');
  const [newReporterName, setNewReporterName] = useState(currentUser.name);

  // Form states for Rename Modal
  const [renameName, setRenameName] = useState('');
  const [renameTitle, setRenameTitle] = useState('');

  // Active dropdown menu for More Menu (Portal Position)
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Update reporter name if currentUser changes
  useEffect(() => {
    setNewReporterName(currentUser.name);
  }, [currentUser]);

  // Close more menu on click outside, scroll, resize, or escape key
  useEffect(() => {
    if (!activeMenuId) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenuId(null);
        setMenuPosition(null);
      }
    };

    const handleScrollOrResize = () => {
      setActiveMenuId(null);
      setMenuPosition(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveMenuId(null);
        setMenuPosition(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeMenuId]);

  // Normalizer for Status (draft, review, ready)
  const normalizeStatus = (status: ProjectStatus): 'draft' | 'review' | 'ready' => {
    if (status === 'Draft' || status === 'draft') return 'draft';
    if (status === 'Reviewing' || status === 'review' || status === 'proofread' || status === 'changes_requested') return 'review';
    if (status === 'Ready' || status === 'ready' || status === 'published') return 'ready';
    return 'draft';
  };

  // Status Badge Component using unified ArticleStatusBadge
  const renderStatusBadge = (rawStatus: ProjectStatus) => {
    return (
      <ArticleStatusBadge
        status={rawStatus}
        size="md"
        showDot={true}
        displayMode="both"
      />
    );
  };

  // 대시보드 인라인 기사 상태 선택
  const renderStatusSelector = (projectId: string, rawStatus: ProjectStatus) => {
    const normalizedValue = rawStatus === 'Draft' ? 'draft' : (rawStatus === 'Ready' ? 'ready' : (rawStatus === 'Reviewing' ? 'review' : rawStatus));
    return (
      <div className="inline-flex items-center" onClick={(e) => e.stopPropagation()}>
        <select
          value={normalizedValue}
          onChange={(e) => {
            if (onChangeStatus) {
              onChangeStatus(projectId, e.target.value);
            }
          }}
          className="text-[11px] font-semibold bg-white hover:bg-slate-50 border border-slate-300 rounded px-2 py-1 text-slate-800 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-2xs"
          title="기사 상태 직접 변경"
        >
          <option value="draft">초안</option>
          <option value="review">검토 대기</option>
          <option value="changes_requested">수정 요청</option>
          <option value="ready">출고 대기</option>
          <option value="published">출고 완료</option>
        </select>
      </div>
    );
  };

  // 대시보드 인라인 3단계 공개 범위 선택
  const renderVisibilitySelector = (projectId: string, visibility?: ProjectVisibility) => {
    return (
      <VisibilityPicker
        compact
        value={visibility}
        onChange={(nextVis) => {
          if (onChangeVisibility) {
            onChangeVisibility(projectId, nextVis);
          } else if (onToggleShareProject) {
            onToggleShareProject(projectId);
          }
        }}
      />
    );
  };

  // Visibility Toggle Badge Component (draft 상태에서는 노출 금지)
  const renderVisibilityBadge = (projectId: string, visibility?: 'private' | 'shared', status?: ProjectStatus) => {
    // draft 상태인 프로젝트는 전체 공유 버튼을 노출하지 않음
    if (status && normalizeStatus(status) === 'draft') {
      return (
        <span 
          className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200 select-none whitespace-nowrap shrink-0"
          title="초안 작성 중에는 전체 공유가 불가능합니다."
        >
          <Lock className="w-3 h-3 text-slate-400" />
          <span>초안(비공개)</span>
        </span>
      );
    }

    const isShared = visibility === 'shared';
    return (
      <button
        id={`btn-toggle-share-row-${projectId}`}
        type="button"
        onClick={(e) => {
          e.stopPropagation(); // 프로젝트 행 클릭 이벤트(에디터 이동) 방지
          if (onToggleShareProject) {
            onToggleShareProject(projectId);
          }
        }}
        className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all cursor-pointer shadow-2xs whitespace-nowrap shrink-0 ${isShared
            ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
            : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
          }`}
        title={isShared ? '전체 프로젝트에 공유된 상태 (클릭 시 비공개로 전환)' : '내 프로젝트에만 저장된 비공개 상태 (클릭 시 전체 프로젝트에 공유)'}
      >
        {isShared ? (
          <Globe className="w-3 h-3 text-blue-600" />
        ) : (
          <Lock className="w-3 h-3 text-slate-500" />
        )}
        <span>{isShared ? '전체 공유' : '비공개'}</span>
      </button>
    );
  };

  // 4단계: 데스크 권한(부장, 차장, 데스크) 여부 및 검토 큐
  const isDesk = isDeskUser(currentUser);
  const isManager = currentUser.rank === 'manager';

  // 출고 대기 검토 Queue: 기사 상태가 ready(출고 대기)인 프로젝트
  // (공유 설정과 분리: 미공개/같은 부서/전체 공유 및 작성자 본인 여부와 무관하게 ready 상태면 모두 검토 대상)
  const reviewQueueProjects = projects.filter(p =>
    normalizeStatus(p.status) === 'ready'
  );
  const reviewQueueCount = reviewQueueProjects.length;

  // 1. Filter by Tab (내 프로젝트 vs 전체 프로젝트 vs 출고 대기 검토)
  const tabFilteredProjects = projects.filter(p => {
    if (activeTab === 'review_queue') {
      return normalizeStatus(p.status) === 'ready';
    }
    if (activeTab === 'my') {
      // 내 프로젝트: 실제 Supabase DB ownerId를 유일한 기준으로 판별
      return p.ownerId === currentUser.id;
    }
    // 전체 프로젝트: visibility === 'shared' AND status !== 'draft' (초안 작성 단계는 절대 노출하지 않음)
    const isShared = p.visibility === 'shared';
    const isNotDraft = normalizeStatus(p.status) !== 'draft';
    return isShared && isNotDraft;
  });

  // Tab Counts Calculation
  const myProjectsCount = projects.filter(p => p.ownerId === currentUser.id).length;

  const allProjectsCount = projects.filter(p =>
    p.visibility === 'shared' && normalizeStatus(p.status) !== 'draft'
  ).length;

  // 2. Filter by Search Query & Status
  const searchFilteredProjects = tabFilteredProjects.filter(p => {
    if (statusFilter !== 'all' && normalizeStatus(p.status) !== statusFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = p.name.toLowerCase().includes(q);
      const matchTitle = p.articleTitle.toLowerCase().includes(q);
      const matchReporter = p.reporter.toLowerCase().includes(q);
      return matchName || matchTitle || matchReporter;
    }
    return true;
  });

  // 3. Sort by Most Recently Modified (최근 수정한 프로젝트가 위에 표시되도록 한다)
  const sortedProjects = [...searchFilteredProjects].sort((a, b) => {
    // If updatedAtTimestamp exists, use it
    if (a.updatedAtTimestamp && b.updatedAtTimestamp) {
      return b.updatedAtTimestamp - a.updatedAtTimestamp;
    }
    // Fallback: parse string date or compare
    const timeA = new Date(a.updatedAt).getTime() || 0;
    const timeB = new Date(b.updatedAt).getTime() || 0;
    return timeB - timeA;
  });

  // Handle Create Submit
  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || !newArticleTitle.trim()) return;

    onCreateProject({
      name: newProjectName.trim(),
      articleTitle: newArticleTitle.trim(),
      reporter: newReporterName.trim() || currentUser.name,
      desk: currentUser.department || '정치부',
      status: 'draft',
    });

    setIsCreateModalOpen(false);
    setNewProjectName('');
    setNewArticleTitle('');
  };

  // Open Rename Modal
  const handleOpenRename = (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveMenuId(null);
    setRenameTarget(p);
    setRenameName(p.name);
    setRenameTitle(p.articleTitle);
  };

  // Submit Rename
  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !renameName.trim()) return;

    if (onRenameProject) {
      onRenameProject(renameTarget.id, renameName.trim(), renameTitle.trim());
    }
    setRenameTarget(null);
  };

  // Handle Duplicate
  const handleDuplicate = (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveMenuId(null);
    if (onDuplicateProject) {
      onDuplicateProject(p.id);
    }
  };

  // Handle Delete
  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    if (onDeleteProject) {
      onDeleteProject(deleteTarget.id);
    }
    setDeleteTarget(null);
  };

  return (
    <div
      id="project-dashboard-view"
      className="flex-1 relative overflow-y-auto select-none border-none outline-none"
    >
      {/* Edge-to-Edge Background: back.png 이미지 + 하얀색 블러 (순수 화이트 블러만 적용) */}
      <div
        aria-hidden="true"
        className="sticky top-0 left-0 w-full h-screen -mb-[100vh] pointer-events-none overflow-hidden select-none z-0"
        style={{ transform: 'translateZ(0)', willChange: 'transform' }}
      >
        {/* 3:4 Cover Background Image (좌우 꽉 참, Aspect Ratio 유지, Bottom Center 정렬) */}
        <img
          src="/img/back.png"
          alt=""
          loading="eager"
          fetchPriority="high"
          className="absolute inset-0 w-full h-full object-cover object-bottom pointer-events-none select-none"
        />

        {/* Pure White Frosted Blur Layer (자연스럽게 비치는 은은한 하얀색 블러) */}
        <div className="absolute inset-0 bg-white/55 backdrop-blur-sm pointer-events-none" />
      </div>

      {/* Layer 5: Dashboard Content Surface (가독성 개선: max-w-[1560px] 확장) */}
      <div className="relative z-10 max-w-[1560px] mx-auto p-4 md:p-6 space-y-6">

        {/* 1. DASHBOARD HEADER & VIEW NAVIGATION */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-300/80 pb-5">
          <div className="space-y-2.5">
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight whitespace-nowrap">
                {activeView === 'tasks' ? '뉴스룸 업무 대시보드' : (activeTab === 'review_queue' ? '출고 대기 기사 검토' : activeTab === 'all' ? '전체 프로젝트' : '내 프로젝트')}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200 font-mono whitespace-nowrap">
                {currentUser.name} {currentUser.roleTitle || currentUser.rank} ({currentUser.department})
              </span>
              {isManager && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300">
                  데스크 권한
                </span>
              )}
            </div>

            {/* View Switcher: 업무 대시보드 (Tasks) vs 프로젝트 관리 (Projects) */}
            <div className="flex items-center space-x-2 pt-0.5">
              <button
                id="btn-view-tasks"
                type="button"
                onClick={() => setActiveView('tasks')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer shadow-2xs ${
                  activeView === 'tasks'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white/85 text-slate-700 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                <ListTodo className="w-3.5 h-3.5" />
                <span>업무 대시보드</span>
                {/* 중요 알림 뱃지: 기자는 수정요청, 데스크는 검토요청 */}
                {(isManager ? summary.deskReviewQueueCount > 0 : summary.myChangesRequestedCount > 0) && (
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    activeView === 'tasks' ? 'bg-amber-400 text-slate-950' : 'bg-red-500 text-white'
                  }`}>
                    {isManager ? summary.deskReviewQueueCount : summary.myChangesRequestedCount}
                  </span>
                )}
              </button>

              <button
                id="btn-view-projects"
                type="button"
                onClick={() => setActiveView('projects')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer shadow-2xs ${
                  activeView === 'projects'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white/85 text-slate-700 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                <FolderGit2 className="w-3.5 h-3.5" />
                <span>프로젝트 관리</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-semibold ${
                  activeView === 'projects' ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-600'
                }`}>
                  {projects.length}
                </span>
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* 새로고침 Button */}
            <button
              id="btn-refresh-dashboard"
              type="button"
              onClick={() => {
                loadDashboardTasks();
              }}
              title="업무 대시보드 새로고침"
              className="p-2 text-slate-600 hover:text-slate-900 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors cursor-pointer shrink-0"
            >
              <RotateCw className={`w-4 h-4 ${isLoadingTasks ? 'animate-spin text-blue-600' : ''}`} />
            </button>

            {/* [+ 새 프로젝트] Button */}
            <button
              id="btn-new-project-header"
              type="button"
              onClick={() => {
                setNewProjectName('');
                setNewArticleTitle('');
                setNewReporterName(currentUser.name);
                setIsCreateModalOpen(true);
              }}
              style={{ background: 'var(--grad-button)' }}
              className="flex items-center space-x-2 px-3.5 py-2 text-white rounded-md text-xs font-bold shadow-xs hover:opacity-95 active:opacity-90 transition-all cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>새 프로젝트</span>
            </button>
          </div>
        </div>

        {/* 2. MAIN BODY: TASK DASHBOARD OR PROJECT MANAGEMENT */}
        {activeView === 'tasks' ? (
          <TaskDashboardView
            tasks={tasks}
            summary={summary}
            currentUser={currentUser}
            isLoading={isLoadingTasks}
            onSelectProject={onSelectProject}
            onRefresh={loadDashboardTasks}
          />
        ) : (
          <>
            {/* 3. CONTROLS: TABS & SEARCH / FILTER */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
          {/* User scope tabs: 내 프로젝트 vs 전체 프로젝트 vs (부장) 출고 대기 검토 */}
          <div className="flex items-center space-x-1 bg-white/85 backdrop-blur-md p-1 rounded-md border border-slate-300/80 shadow-xs">
            <button
              id="tab-my-projects"
              type="button"
              onClick={() => setActiveTab('my')}
              className={`px-3.5 py-1.5 rounded text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${activeTab === 'my'
                  ? 'bg-slate-900 text-white font-bold shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
            >
              내 프로젝트 ({myProjectsCount})
            </button>
            <button
              id="tab-all-projects"
              type="button"
              onClick={() => setActiveTab('all')}
              className={`px-3.5 py-1.5 rounded text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${activeTab === 'all'
                  ? 'bg-slate-900 text-white font-bold shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
            >
              전체 프로젝트 ({allProjectsCount})
            </button>
            {isDesk && (
              <button
                id="tab-review-queue"
                type="button"
                onClick={() => setActiveTab('review_queue')}
                className={`px-3.5 py-1.5 rounded text-xs font-semibold transition-all cursor-pointer whitespace-nowrap flex items-center space-x-1.5 ${activeTab === 'review_queue'
                    ? 'bg-purple-700 text-white font-bold shadow-xs'
                    : 'text-purple-700 hover:bg-purple-50'
                  }`}
              >
                <span>출고 대기 검토</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  activeTab === 'review_queue' ? 'bg-purple-950 text-white' : 'bg-purple-100 text-purple-800'
                }`}>
                  {reviewQueueCount}
                </span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter */}
            <div className="flex items-center space-x-1 bg-white/85 backdrop-blur-md p-1 rounded-md border border-slate-300/80 shadow-xs">
              <span className="text-[11px] text-slate-500 font-semibold px-1.5 whitespace-nowrap">상태:</span>
              {[
                { key: 'all' as const, label: '전체' },
                { key: 'draft' as const, label: '초안' },
                { key: 'review' as const, label: '검토 중' },
                { key: 'ready' as const, label: '출고 대기' },
              ].map(opt => (
                <button
                  key={opt.key}
                  id={`filter-status-${opt.key}`}
                  type="button"
                  onClick={() => setStatusFilter(opt.key)}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-all cursor-pointer whitespace-nowrap ${statusFilter === opt.key
                      ? 'bg-slate-900 text-white font-bold shadow-xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Search Box */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="input-project-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="프로젝트명, 기사 제목, 기자 검색..."
                className="w-full pl-8 pr-7 py-1.5 bg-white border border-slate-300 rounded-md text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600 shadow-xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-xs p-1 cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 4. PROJECT LIST TABLE / EMPTY STATE / LOADING STATE */}
        {isLoadingProjects ? (
          /* LOADING SKELETON UI */
          <div
            id="project-loading-state"
            style={{
              background: 'rgba(255, 255, 255, 0.92)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
            }}
            className="rounded-md border border-slate-200 shadow-xs p-16 text-center flex flex-col items-center justify-center my-6"
          >
            <div className="w-10 h-10 rounded-full border-3 border-blue-600 border-t-transparent animate-spin mb-4" />
            <h3 className="text-sm font-bold text-slate-800">
              프로젝트 목록을 불러오는 중입니다...
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Supabase DB에서 최신 기사 및 워크스페이스 데이터를 동기화하고 있습니다.
            </p>
          </div>
        ) : sortedProjects.length === 0 ? (
          /* EMPTY STATE UI (Bright Frosted Glass) */
          <div
            id="project-empty-state"
            style={{
              background: 'rgba(255, 255, 255, 0.92)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
            }}
            className="rounded-md border border-slate-200 shadow-xs p-12 text-center flex flex-col items-center justify-center my-6"
          >
            <div className="w-12 h-12 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 mb-4">
              <FolderKanban className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900 whitespace-nowrap">
              아직 프로젝트가 없습니다.
            </h3>
            <p className="text-xs text-slate-600 mt-1 max-w-sm">
              새 프로젝트를 만들어 기사를 작성해보세요.
            </p>
            <button
              id="btn-create-first-project"
              type="button"
              onClick={() => {
                setNewProjectName('');
                setNewArticleTitle('');
                setNewReporterName(currentUser.name);
                setIsCreateModalOpen(true);
              }}
              style={{ background: 'var(--grad-button)' }}
              className="mt-4 px-4 py-2 text-white rounded-md text-xs font-bold inline-flex items-center space-x-1.5 shadow-2xs hover:opacity-95 active:opacity-90 transition-all cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>첫 프로젝트 만들기</span>
            </button>
          </div>
        ) : (
          /* PROJECT TABLE (Bright Frosted Glass) */
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.92)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
            }}
            className="rounded-md border border-slate-200 shadow-xs overflow-visible relative"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-100/90 text-slate-700 uppercase text-[11px] font-bold tracking-wider border-b border-slate-200 select-none">
                  <tr>
                    <th className="py-3.5 px-4 font-bold whitespace-nowrap">프로젝트명</th>
                    <th className="py-3.5 px-4 font-bold whitespace-nowrap">기사 제목</th>
                    <th className="py-3.5 px-4 font-bold whitespace-nowrap">기자</th>
                    <th className="py-3.5 px-4 font-bold whitespace-nowrap">생성일</th>
                    <th className="py-3.5 px-4 font-bold whitespace-nowrap">최종 수정일</th>
                    <th className="py-3.5 px-4 font-bold text-center whitespace-nowrap">기사 상태</th>
                    <th className="py-3.5 px-4 font-bold text-center whitespace-nowrap">공개 범위</th>
                    <th className="py-3.5 px-4 font-bold text-right whitespace-nowrap">더보기</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/80">
                  {sortedProjects.map((p) => {
                    const isMenuOpen = activeMenuId === p.id;

                    return (
                      <tr
                        key={p.id}
                        id={`project-row-${p.id}`}
                        onClick={() => onSelectProject(p.id)}
                        className="border-b border-slate-200/80 hover:bg-blue-50/50 transition-colors cursor-pointer group"
                      >
                        {/* 1. 프로젝트명 */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                              {p.name}
                            </span>
                            {p.desk && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono border border-slate-200 whitespace-nowrap shrink-0">
                                {p.desk}
                              </span>
                            )}
                          </div>
                          {p.coverageType && (
                            <span className="text-[10px] text-slate-400 mt-0.5 block whitespace-nowrap">
                              {p.coverageType}
                            </span>
                          )}
                        </td>

                        {/* 2. 기사 제목 (가독성 개선: max-w 확장 및 최대 2줄 line-clamp + hover tooltip) */}
                        <td className="py-3.5 px-4 min-w-[280px] max-w-md lg:max-w-xl">
                          <p
                            className="font-medium text-slate-800 line-clamp-2 leading-relaxed group-hover:text-blue-600 transition-colors"
                            title={p.articleTitle}
                          >
                            {p.articleTitle}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] mt-1">
                            {p.charCount !== undefined && (
                              <span className="text-slate-400 font-mono whitespace-nowrap">{p.charCount.toLocaleString()}자</span>
                            )}
                            {p.pendingReviewsCount !== undefined && p.pendingReviewsCount > 0 ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-semibold whitespace-nowrap shrink-0">
                                <span>검토 대기 {p.pendingReviewsCount}건</span>
                                <span className="text-amber-600 font-normal">
                                  ({p.aiPendingCount !== undefined ? `AI 검수 ${p.aiPendingCount}` : ''}
                                  {p.aiPendingCount !== undefined && p.feedbackPendingCount !== undefined ? ' · ' : ''}
                                  {p.feedbackPendingCount !== undefined ? `데스크 ${p.feedbackPendingCount}` : ''})
                                </span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-medium whitespace-nowrap shrink-0">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                <span>검토 완료</span>
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 3. 기자 */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex items-center space-x-1.5 text-slate-700 font-medium">
                            <UserIcon className="w-3.5 h-3.5 text-slate-400" />
                            <span>{p.reporter}</span>
                          </div>
                        </td>

                        {/* 4. 생성일 */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                          <div className="flex items-center space-x-1">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            <span>{p.createdAt || '2026.09.18'}</span>
                          </div>
                        </td>

                        {/* 5. 최종 수정일 */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-slate-700 font-mono text-[11px]">
                          <div className="flex items-center space-x-1 font-semibold text-slate-700">
                            <Clock className="w-3 h-3 text-blue-600" />
                            <span>{p.updatedAt}</span>
                          </div>
                        </td>

                        {/* 6. 기사 단계 (초안, 검토 대기, 수정 요청, 출고 대기, 출고 완료) */}
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          {renderStatusSelector(p.id, p.status)}
                        </td>

                        {/* 7. 공개 범위 (비공개 / 같은 부서 공개 / 전체 공개) */}
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          {renderVisibilitySelector(p.id, p.visibility as ProjectVisibility)}
                        </td>

                        {/* 8. More Menu (더보기 메뉴: 열기, 전체 프로젝트 공유, 이름 변경, 복제, 삭제) */}
                        <td
                          className="py-3.5 px-4 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            id={`btn-project-more-menu-${p.id}`}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (activeMenuId === p.id) {
                                setActiveMenuId(null);
                                setMenuPosition(null);
                              } else {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const menuWidth = 176;
                                const menuHeight = 220;
                                const spaceBelow = window.innerHeight - rect.bottom;
                                const top = spaceBelow < menuHeight
                                  ? Math.max(8, rect.top - menuHeight - 4)
                                  : rect.bottom + 4;
                                const idealLeft = rect.right - menuWidth;
                                const left = Math.max(8, Math.min(idealLeft, window.innerWidth - menuWidth - 8));
                                setMenuPosition({ top, left });
                                setActiveMenuId(p.id);
                              }
                            }}
                            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                              isMenuOpen ? 'text-blue-600 bg-blue-50' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                            }`}
                            title="더보기 메뉴"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Table Footer info */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 flex items-center justify-between">
              <span className="whitespace-nowrap">
                표시된 프로젝트: <strong>{sortedProjects.length}</strong>건 (최근 수정된 순으로 정렬됨)
              </span>
            </div>
          </div>
        )}
      </>
    )}
  </div>

      {/* 5. 새 프로젝트 생성 MODAL */}
      {isCreateModalOpen && (
        <div
          id="modal-create-project-backdrop"
          onClick={() => setIsCreateModalOpen(false)}
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div
            id="modal-create-project-content"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-md shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-150"
          >
            {/* Header */}
            <div
              style={{ background: 'var(--grad-topbar)' }}
              className="px-5 py-4 text-white flex items-center justify-between border-b border-slate-800"
            >
              <div className="flex items-center space-x-2">
                <FolderKanban className="w-5 h-5 text-slate-300" />
                <h3 className="text-sm font-bold">새 프로젝트</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleCreateSubmit} className="p-6 space-y-4 text-xs text-slate-700">
              {/* 프로젝트명 */}
              <div>
                <label className="block font-bold text-slate-800 mb-1.5">
                  프로젝트명 <span className="text-red-500">*</span>
                </label>
                <input
                  id="input-new-project-name"
                  type="text"
                  required
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="예: 2026 하반기 정기국회 예산안 심층취재"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 shadow-2xs"
                  autoFocus
                />
              </div>

              {/* 기사 제목 */}
              <div>
                <label className="block font-bold text-slate-800 mb-1.5">
                  기사 제목 <span className="text-red-500">*</span>
                </label>
                <input
                  id="input-new-article-title"
                  type="text"
                  required
                  value={newArticleTitle}
                  onChange={(e) => setNewArticleTitle(e.target.value)}
                  placeholder="예: 정부 내년도 예산안 국회 제출… R&D·복지 쟁점"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 shadow-2xs"
                />
              </div>

              {/* 기자명 */}
              <div>
                <label className="block font-bold text-slate-800 mb-1.5">
                  기자명 <span className="text-red-500">*</span>
                </label>
                <input
                  id="input-new-reporter-name"
                  type="text"
                  required
                  value={newReporterName}
                  onChange={(e) => setNewReporterName(e.target.value)}
                  placeholder="기자 이름 (예: 김현우)"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 shadow-2xs"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  현재 로그인된 계정: {currentUser.name} ({currentUser.email})
                </span>
              </div>

              {/* Database Context Note */}
              <div className="p-3 bg-slate-50 rounded-md border border-slate-200 text-[11px] text-slate-700 leading-relaxed">
                ℹ️ 프로젝트를 생성하면 즉시 <strong>초안(Draft)</strong> 상태로 등록되며, 해당 기사 편집 화면으로 이동합니다.
              </div>

              {/* Modal Actions: [취소] [프로젝트 생성] */}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-end space-x-2">
                <button
                  id="btn-cancel-create-project"
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-xs font-semibold transition-colors shadow-2xs"
                >
                  취소
                </button>
                <button
                  id="btn-submit-create-project"
                  type="submit"
                  style={{ background: 'var(--grad-button)' }}
                  className="px-5 py-2 text-white rounded-md text-xs font-bold shadow-2xs hover:opacity-95 active:opacity-90 transition-all cursor-pointer"
                >
                  프로젝트 생성
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. 이름 변경 MODAL */}
      {renameTarget && (
        <div
          id="modal-rename-project-backdrop"
          onClick={() => setRenameTarget(null)}
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div
            id="modal-rename-project-content"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-md shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-150"
          >
            <div
              style={{ background: 'var(--grad-topbar)' }}
              className="px-5 py-4 text-white flex items-center justify-between border-b border-slate-800"
            >
              <div className="flex items-center space-x-2">
                <Edit3 className="w-4 h-4 text-slate-300" />
                <h3 className="text-sm font-bold">프로젝트 이름 변경</h3>
              </div>
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRenameSubmit} className="p-5 space-y-4 text-xs text-slate-700">
              <div>
                <label className="block font-bold text-slate-800 mb-1">
                  프로젝트명 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={renameName}
                  onChange={(e) => setRenameName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 shadow-2xs"
                  autoFocus
                />
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">
                  기사 제목
                </label>
                <input
                  type="text"
                  value={renameTitle}
                  onChange={(e) => setRenameTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 shadow-2xs"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setRenameTarget(null)}
                  className="px-3.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md font-semibold text-xs shadow-2xs cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  style={{ background: 'var(--grad-button)' }}
                  className="px-4 py-1.5 text-white rounded-md font-bold text-xs shadow-2xs hover:opacity-95 active:opacity-90 transition-all cursor-pointer"
                >
                  변경 저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. 프로젝트 삭제 확인 MODAL */}
      {deleteTarget && (
        <div
          id="modal-delete-project-backdrop"
          onClick={() => setDeleteTarget(null)}
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div
            id="modal-delete-project-content"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-md shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-150 p-5 space-y-4"
          >
            <div className="flex items-center space-x-3 text-red-600">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">프로젝트 삭제</h3>
                <p className="text-xs text-slate-500">삭제 후에는 복구할 수 없습니다.</p>
              </div>
            </div>

            <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3 rounded-md border border-slate-200">
              정말로 <strong>"{deleteTarget.name}"</strong> 프로젝트를 삭제하시겠습니까? 관련 기사 내용과 데이터가 모두 영구 제거됩니다.
            </p>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-3.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-xs font-semibold shadow-2xs"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-md text-xs font-bold shadow-2xs"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 8. 포털로 렌더링되는 더보기 드롭다운 메뉴 (부모 컨테이너 overflow/z-index 잘림 원천 방지) */}
      {activeMenuId && menuPosition && (() => {
        const targetProj = projects.find(item => item.id === activeMenuId);
        if (!targetProj) return null;
        return createPortal(
          <div
            ref={menuRef}
            id={`project-dropdown-menu-${targetProj.id}`}
            style={{
              position: 'fixed',
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
              zIndex: 9999,
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-44 bg-white rounded-lg shadow-2xl border border-slate-200 py-1 text-xs animate-in fade-in zoom-in-95 duration-100"
          >
            {/* 열기 */}
            <button
              id={`menu-action-open-${targetProj.id}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveMenuId(null);
                setMenuPosition(null);
                onSelectProject(targetProj.id);
              }}
              className="w-full px-3 py-2 text-left text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex items-center space-x-2 font-medium cursor-pointer whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
              <span>열기</span>
            </button>

            {/* 전체 프로젝트에 공유 / 공유 취소 (draft 상태에서는 노출 금지) */}
            {onToggleShareProject && normalizeStatus(targetProj.status) !== 'draft' && (
              <button
                id={`menu-action-toggle-share-${targetProj.id}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveMenuId(null);
                  setMenuPosition(null);
                  onToggleShareProject(targetProj.id);
                }}
                className={`w-full px-3 py-2 text-left flex items-center space-x-2 font-medium cursor-pointer whitespace-nowrap ${
                  targetProj.visibility === 'shared'
                    ? 'text-amber-700 hover:bg-amber-50'
                    : 'text-blue-700 hover:bg-blue-50'
                }`}
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>{targetProj.visibility === 'shared' ? '전체 공유 취소' : '전체 프로젝트에 공유'}</span>
              </button>
            )}

            {/* 이름 변경 */}
            <button
              id={`menu-action-rename-${targetProj.id}`}
              type="button"
              onClick={(e) => {
                setActiveMenuId(null);
                setMenuPosition(null);
                handleOpenRename(targetProj, e);
              }}
              className="w-full px-3 py-2 text-left text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex items-center space-x-2 font-medium cursor-pointer whitespace-nowrap"
            >
              <Edit3 className="w-3.5 h-3.5 text-slate-400" />
              <span>이름 변경</span>
            </button>

            {/* 복제 */}
            <button
              id={`menu-action-duplicate-${targetProj.id}`}
              type="button"
              onClick={(e) => {
                setActiveMenuId(null);
                setMenuPosition(null);
                handleDuplicate(targetProj, e);
              }}
              className="w-full px-3 py-2 text-left text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex items-center space-x-2 font-medium cursor-pointer whitespace-nowrap"
            >
              <Copy className="w-3.5 h-3.5 text-slate-400" />
              <span>복제</span>
            </button>

            <div className="h-px bg-slate-100 my-1" />

            {/* 삭제 */}
            <button
              id={`menu-action-delete-${targetProj.id}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveMenuId(null);
                setMenuPosition(null);
                setDeleteTarget(targetProj);
              }}
              className="w-full px-3 py-2 text-left text-red-600 hover:bg-red-50 flex items-center space-x-2 font-medium cursor-pointer whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-500" />
              <span>삭제</span>
            </button>
          </div>,
          document.body
        );
      })()}
    </div>
  );
};
