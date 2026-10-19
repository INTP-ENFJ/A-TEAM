import React, { useState } from 'react';
import {
  AlertCircle,
  Clock,
  FileEdit,
  CheckCircle2,
  User as UserIcon,
  FolderKanban,
  RotateCcw,
  Inbox,
  ArrowRight,
  Calendar,
  UserCheck
} from 'lucide-react';
import { DashboardSummary, DashboardTaskItem, User, isDeskUser, isManagerOrAboveUser } from '../../types';
import { ArticleStatusBadge } from '../common/ArticleStatusBadge';
import { AssignArticleModal } from './AssignArticleModal';

interface TaskDashboardViewProps {
  tasks: DashboardTaskItem[];
  summary: DashboardSummary;
  currentUser: User;
  onSelectProject: (projectId: string) => void;
  isLoading?: boolean;
  onRefresh?: () => void;
  showToast?: (message: string) => void;
}

export const TaskDashboardView: React.FC<TaskDashboardViewProps> = ({
  tasks,
  summary,
  currentUser,
  onSelectProject,
  isLoading = false,
  onRefresh,
  showToast,
}) => {
  const isDesk = isDeskUser(currentUser);
  // 출고 대기 기사는 부장 이상(부장 직급 또는 편집국장 역할)에게만 보인다
  const canSeeReadyQueue = isManagerOrAboveUser(currentUser);

  // 1. 기자 관점 필터링
  const myDrafts = tasks.filter(t => t.authorId === currentUser.id && t.status === 'draft');
  const myChangesRequested = tasks.filter(t => t.authorId === currentUser.id && t.status === 'changes_requested');
  const myInReview = tasks.filter(t => t.authorId === currentUser.id && t.status === 'review');
  const myReady = tasks.filter(t => t.authorId === currentUser.id && t.status === 'ready');
  const myPublished = tasks.filter(t => t.authorId === currentUser.id && t.status === 'published');
  const totalMyTasks = myDrafts.length + myChangesRequested.length + myInReview.length + myReady.length + myPublished.length;

  // 데스크 사용자: 검토 대기(review) 또는 출고 대기(ready) 큐가 존재하면 '데스크 검토 큐'를 기본 활성화
  const totalDeskActionable = summary.deskReviewQueueCount + (canSeeReadyQueue ? summary.deskReadyQueueCount : 0);
  const [roleView, setRoleView] = useState<'reporter' | 'desk'>(
    isDesk ? (totalDeskActionable > 0 ? 'desk' : (totalMyTasks > 0 ? 'reporter' : 'desk')) : 'reporter'
  );
  const [assignModalTarget, setAssignModalTarget] = useState<DashboardTaskItem | null>(null);

  // 2. 데스크 관점 필터링
  // 내가 쓴 기사도 함께 보여준다 (계정 하나로 기자·데스크를 겸하는 경우 포함)
  const deskReviewQueue = tasks.filter(t => t.status === 'review');
  const deskChangesRequested = tasks.filter(t => t.status === 'changes_requested');
  const isMine = (t: DashboardTaskItem) => t.authorId === currentUser.id;
  const renderMineBadge = (t: DashboardTaskItem) => isMine(t) ? (
    <span className="px-1.5 py-0.5 rounded text-[12px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-300">내 기사</span>
  ) : null;
  const deskReadyQueue = canSeeReadyQueue ? tasks.filter(t => t.status === 'ready') : [];

  // 요약 카드를 누르면 해당 목록으로 부드럽게 이동하고 잠깐 강조한다
  const goTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('ring-2', 'ring-blue-400', 'ring-offset-2');
    window.setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400', 'ring-offset-2'), 1400);
  };
  const cardNav = (id: string, label: string) => ({
    onClick: () => goTo(id),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(id); } },
    role: 'button' as const,
    tabIndex: 0,
    title: `${label} 목록으로 이동`,
    style: { cursor: 'pointer' } as React.CSSProperties,
  });

  // 마감 배지 렌더러
  const renderDeadlineBadge = (task: DashboardTaskItem) => {
    if (!task.deadlineFormatted) return null;
    if (task.isOverdue) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[12px] font-bold bg-rose-100 text-rose-800 border border-rose-300 inline-flex items-center space-x-1">
          <span>🚨 마감 초과</span>
          <span>({task.deadlineFormatted})</span>
        </span>
      );
    }
    if (task.isUrgentDeadline) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[12px] font-bold bg-amber-100 text-amber-900 border border-amber-300 inline-flex items-center space-x-1 animate-pulse">
          <span>⏰ 마감 임박</span>
          <span>({task.deadlineFormatted})</span>
        </span>
      );
    }
    return (
      <span className="text-[12px] text-slate-500 font-medium inline-flex items-center space-x-1">
        <Calendar className="w-3 h-3 text-slate-400" />
        <span>마감 {task.deadlineFormatted}</span>
      </span>
    );
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-slate-500">
        <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mb-3" />
        <span className="text-xs font-semibold">뉴스룸 업무 큐를 불러오는 중입니다...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. 상단 역할 전환 탭 (데스크 사용자 전용) & 상태 필터 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/80 backdrop-blur-xs p-3.5 rounded-xl border border-slate-200/80 shadow-2xs">
        <div className="flex items-center space-x-2">
          {isDesk ? (
            <div className="flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => setRoleView('desk')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                  roleView === 'desk'
                    ? 'bg-white text-blue-700 shadow-2xs font-extrabold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Inbox className="w-3.5 h-3.5" />
                <span>데스크 검토 큐</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[12px] font-extrabold ${
                  summary.deskReviewQueueCount > 0 
                    ? 'bg-rose-500 text-white' 
                    : (canSeeReadyQueue && summary.deskReadyQueueCount > 0 ? 'bg-purple-600 text-white' : 'bg-slate-200 text-slate-600')
                }`}>
                  {totalDeskActionable}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setRoleView('reporter')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                  roleView === 'reporter'
                    ? 'bg-white text-blue-700 shadow-2xs font-extrabold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileEdit className="w-3.5 h-3.5" />
                <span>내 기사 업무</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[12px] font-extrabold ${
                  summary.myChangesRequestedCount > 0 
                    ? 'bg-rose-500 text-white animate-pulse' 
                    : (totalMyTasks > 0 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600')
                }`}>
                  {totalMyTasks}
                </span>
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-800">
              <div className="w-2 h-2 rounded-full bg-blue-600" />
              <span>{currentUser.name} 기자의 업무 큐</span>
            </div>
          )}
        </div>

        <div className="text-xs text-slate-500 flex items-center space-x-2">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span>최신 변경 순으로 정렬됨</span>
        </div>
      </div>

      {/* 2. KPI 업무 통계 카드 배너 */}
      {roleView === 'reporter' ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {/* 작성중 */}
          <div {...cardNav('sec-r-draft', '초안 작성중')} className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
            <span className="text-[12px] font-semibold text-slate-500 flex items-center space-x-1">
              <FileEdit className="w-3 h-3 text-slate-400" />
              <span>초안 작성중</span>
            </span>
            <span className="text-2xl font-black text-slate-800 mt-2">{summary.myDraftCount}</span>
          </div>

          {/* 수정 요청 (긴급) */}
          <div {...cardNav('sec-r-changes', '수정 요청됨')} className={`p-3.5 rounded-xl border shadow-2xs flex flex-col justify-between transition-all ${
            summary.myChangesRequestedCount > 0
              ? 'bg-rose-50/80 border-rose-300 ring-2 ring-rose-200'
              : 'bg-white border-slate-200/90'
          }`}>
            <span className={`text-[12px] font-bold flex items-center space-x-1 ${
              summary.myChangesRequestedCount > 0 ? 'text-rose-700' : 'text-slate-500'
            }`}>
              <AlertCircle className={`w-3 h-3 ${summary.myChangesRequestedCount > 0 ? 'text-rose-600' : 'text-slate-400'}`} />
              <span>수정 요청됨</span>
            </span>
            <span className={`text-2xl font-black mt-2 ${
              summary.myChangesRequestedCount > 0 ? 'text-rose-700 animate-pulse' : 'text-slate-800'
            }`}>
              {summary.myChangesRequestedCount}
            </span>
          </div>

          {/* 검토중 */}
          <div {...cardNav('sec-r-review', '데스크 검토중')} className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
            <span className="text-[12px] font-semibold text-slate-500 flex items-center space-x-1">
              <Clock className="w-3 h-3 text-blue-500" />
              <span>데스크 검토중</span>
            </span>
            <span className="text-2xl font-black text-blue-700 mt-2">{summary.myInReviewCount}</span>
          </div>

          {/* 출고 대기 */}
          <div {...cardNav('sec-r-ready', '승인 / 출고대기')} className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
            <span className="text-[12px] font-semibold text-slate-500 flex items-center space-x-1">
              <CheckCircle2 className="w-3 h-3 text-purple-500" />
              <span>승인 / 출고대기</span>
            </span>
            <span className="text-2xl font-black text-purple-700 mt-2">{summary.myReadyCount}</span>
          </div>

          {/* 출고 완료 */}
          <div {...cardNav('sec-r-ready', '출고 완료')} className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
            <span className="text-[12px] font-semibold text-slate-500 flex items-center space-x-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              <span>출고 완료</span>
            </span>
            <span className="text-2xl font-black text-emerald-700 mt-2">{summary.myPublishedCount}</span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* 데스크 검토 요청 */}
          <div {...cardNav('sec-d-review', '검토 요청된 기사')} className={`p-4 rounded-xl border shadow-2xs flex items-center justify-between transition-all ${
            summary.deskReviewQueueCount > 0
              ? 'bg-blue-50/90 border-blue-300 ring-2 ring-blue-200'
              : 'bg-white border-slate-200'
          }`}>
            <div>
              <span className="text-xs font-bold text-blue-800 flex items-center space-x-1.5">
                <Inbox className="w-4 h-4 text-blue-600" />
                <span>검토 요청된 기사</span>
              </span>
              <p className="text-[12px] text-blue-600/80 mt-1">부서 기자가 감수를 요청한 기사</p>
            </div>
            <span className="text-3xl font-black text-blue-900">{summary.deskReviewQueueCount}</span>
          </div>

          {/* 기자 수정 대기 중 */}
          <div {...cardNav('sec-d-changes', '기자 수정 대기 중')} className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-700 flex items-center space-x-1.5">
                <RotateCcw className="w-4 h-4 text-amber-500" />
                <span>기자 수정 대기 중</span>
              </span>
              <p className="text-[12px] text-slate-500 mt-1">데스크가 수정을 요청하여 보완 중</p>
            </div>
            <span className="text-3xl font-black text-slate-800">{summary.deskChangesRequestedCount}</span>
          </div>

          {/* 출고 대기 */}
          {canSeeReadyQueue && (
          <div {...cardNav('sec-d-ready', '출고 대기')} className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-purple-800 flex items-center space-x-1.5">
                <CheckCircle2 className="w-4 h-4 text-purple-600" />
                <span>출고 대기 기사</span>
              </span>
              <p className="text-[12px] text-slate-500 mt-1">승인 완료되어 최종 출고 가능한 기사</p>
            </div>
            <span className="text-3xl font-black text-purple-900">{summary.deskReadyQueueCount}</span>
          </div>
          )}
        </div>
      )}

      {/* 3. 업무 큐 본문 리스트 */}
      {roleView === 'reporter' ? (
        <div className="space-y-6">
          {/* [섹션 1]: 수정 요청된 기사 (최우선 강조) */}
          <div id="sec-r-changes" className="bg-white rounded-xl border border-rose-200/90 shadow-2xs overflow-hidden">
            <div className="px-5 py-3.5 bg-rose-50/80 border-b border-rose-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <h3 className="text-xs font-bold text-rose-900">
                  수정 요청 받은 기사 ({myChangesRequested.length})
                </h3>
              </div>
              <span className="text-[12px] text-rose-700 font-semibold">
                * 데스크 피드백을 확인하고 수정 후 [재검토 요청]을 진행하세요
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {myChangesRequested.length === 0 ? (
                <div className="p-8 text-center text-xs font-medium text-slate-400">
                  현재 수정 요청된 기사가 없습니다. 모든 기사가 순조롭게 진행 중입니다.
                </div>
              ) : (
                myChangesRequested.map(task => (
                  <div
                    key={task.id}
                    onClick={() => onSelectProject(task.projectId)}
                    className="p-4 hover:bg-rose-50/30 transition-colors cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-3 group"
                  >
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <ArticleStatusBadge status={task.status} size="sm" showDot={true} />
                        <span className="text-xs font-semibold text-slate-500 flex items-center space-x-1">
                          <FolderKanban className="w-3 h-3 text-slate-400" />
                          <span>{task.projectName}</span>
                        </span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-400">{task.updatedAtFormatted}</span>
                        {renderDeadlineBadge(task)}
                      </div>
                      <h4 className="text-sm font-bold text-slate-900 group-hover:text-rose-600 transition-colors line-clamp-1">
                        {task.title}
                      </h4>
                      {task.changesReason && (
                        <div className="p-2.5 bg-rose-50 rounded-lg border border-rose-200/80 text-xs text-rose-900 flex items-start space-x-2">
                          <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold text-rose-950">
                              [{task.changesRequestedBy || '데스크'} 수정 요청]
                            </span>{' '}
                            <span>{task.changesReason}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectProject(task.projectId);
                      }}
                      className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold text-xs transition-colors shadow-2xs whitespace-nowrap self-start md:self-center shrink-0 cursor-pointer flex items-center space-x-1"
                    >
                      <span>기사 수정하기</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* [섹션 2]: 초안 작성중인 기사 (Draft) */}
          <div id="sec-r-draft" className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <FileEdit className="w-4 h-4 text-slate-600 shrink-0" />
                <h3 className="text-xs font-bold text-slate-900">
                  내가 작성 중인 기사 ({myDrafts.length})
                </h3>
              </div>
              <span className="text-[12px] text-slate-500">작성 완료 후 [검토 요청]을 진행할 수 있습니다</span>
            </div>

            <div className="divide-y divide-slate-100">
              {myDrafts.length === 0 ? (
                <div className="p-8 text-center text-xs font-medium text-slate-400">
                  현재 작성 중인 초안 기사가 없습니다. 새로운 프로젝트를 생성해보세요.
                </div>
              ) : (
                myDrafts.map(task => (
                  <div
                    key={task.id}
                    onClick={() => onSelectProject(task.projectId)}
                    className="p-4 hover:bg-slate-50/80 transition-colors cursor-pointer flex items-center justify-between gap-3 group"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <ArticleStatusBadge status={task.status} size="sm" showDot={true} />
                        <span className="text-xs text-slate-500">{task.projectName}</span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-400">최근 저장: {task.updatedAtFormatted}</span>
                        {renderDeadlineBadge(task)}
                      </div>
                      <h4 className="text-sm font-bold text-slate-800 group-hover:text-blue-600 transition-colors line-clamp-1">
                        {task.title}
                      </h4>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectProject(task.projectId);
                      }}
                      className="px-3 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg font-semibold text-xs transition-colors shrink-0 cursor-pointer flex items-center space-x-1"
                    >
                      <span>이어서 작성</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* [섹션 3]: 검토중 / 출고대기 기사 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 검토중 */}
            <div id="sec-r-review" className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
              <div className="px-4 py-3 bg-blue-50/60 border-b border-blue-200 flex items-center justify-between">
                <span className="text-xs font-bold text-blue-900 flex items-center space-x-1.5">
                  <Clock className="w-3.5 h-3.5 text-blue-600" />
                  <span>검토 대기 중인 기사 ({myInReview.length})</span>
                </span>
              </div>
              <div className="divide-y divide-slate-100 p-1">
                {myInReview.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400">
                    현재 검토 대기 중인 기사가 없습니다.
                  </div>
                ) : (
                  myInReview.map(task => (
                    <div
                      key={task.id}
                      onClick={() => onSelectProject(task.projectId)}
                      className="p-3 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors"
                    >
                      <h5 className="text-xs font-bold text-slate-800 line-clamp-1">{task.title}</h5>
                      <div className="text-[12px] text-slate-400 mt-1 flex items-center justify-between">
                        <span>{task.projectName}</span>
                        <span>{task.updatedAtFormatted}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 출고 대기 및 출고 완료 기사 */}
            <div id="sec-r-ready" className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
              <div className="px-4 py-3 bg-purple-50/60 border-b border-purple-200 flex items-center justify-between">
                <span className="text-xs font-bold text-purple-900 flex items-center space-x-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-purple-600" />
                  <span>출고 대기 / 완료 ({myReady.length + myPublished.length})</span>
                </span>
                <span className="text-[12px] text-purple-700 font-semibold">
                  대기 {myReady.length} · 출고 {myPublished.length}
                </span>
              </div>
              <div className="divide-y divide-slate-100 p-1">
                {(myReady.length + myPublished.length) === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400">
                    현재 출고 대기 또는 완료된 기사가 없습니다.
                  </div>
                ) : (
                  [...myReady, ...myPublished].map(task => (
                    <div
                      key={task.id}
                      onClick={() => onSelectProject(task.projectId)}
                      className="p-3 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h5 className="text-xs font-bold text-slate-800 line-clamp-1">{task.title}</h5>
                        <ArticleStatusBadge status={task.status} size="sm" />
                      </div>
                      <div className="text-[12px] text-slate-400 mt-1 flex items-center justify-between">
                        <span>{task.projectName}</span>
                        <span>{task.updatedAtFormatted}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* 데스크 전용 업무 큐 */
        <div className="space-y-6">
          {/* [섹션 1]: 검토해야 할 기사 (동일 부서 제출 기사) */}
          <div id="sec-d-review" className="bg-white rounded-xl border border-blue-200/90 shadow-2xs overflow-hidden">
            <div className="px-5 py-3.5 bg-blue-50/80 border-b border-blue-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Inbox className="w-4 h-4 text-blue-600 shrink-0" />
                <h3 className="text-xs font-bold text-blue-900">
                  내가 검토해야 할 기사 ({deskReviewQueue.length})
                </h3>
              </div>
              <span className="text-[12px] text-blue-700 font-semibold">
                * 기사를 검토하고 피드백 메모, [수정 요청] 또는 [승인]을 처리하세요
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {deskReviewQueue.length === 0 ? (
                <div className="p-8 text-center text-xs font-medium text-slate-400">
                  현재 검토 대기 중인 기사가 없습니다. 모든 기사가 처리되었습니다.
                </div>
              ) : (
                deskReviewQueue.map(task => (
                  <div
                    key={task.id}
                    onClick={() => onSelectProject(task.projectId)}
                    className="p-4 hover:bg-blue-50/30 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                  >
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <ArticleStatusBadge status={task.status} size="sm" showDot={true} />
                        {renderMineBadge(task)}
                        <span className="text-xs font-bold text-slate-700 flex items-center space-x-1">
                          <UserIcon className="w-3 h-3 text-slate-400" />
                          <span>{task.authorName} 기자 ({task.department || '부서'})</span>
                        </span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-500">{task.projectName}</span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-400">{task.updatedAtFormatted}</span>
                        {renderDeadlineBadge(task)}
                      </div>
                      <h4 className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-1">
                        {task.title}
                      </h4>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      {isDesk && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAssignModalTarget(task);
                          }}
                          className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:text-blue-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors shadow-2xs cursor-pointer flex items-center space-x-1"
                          title="기사 담당 기자 및 마감시간 변경"
                        >
                          <UserCheck className="w-3.5 h-3.5 text-slate-500" />
                          <span>배정/마감</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectProject(task.projectId);
                        }}
                        className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs transition-colors shadow-2xs whitespace-nowrap shrink-0 cursor-pointer flex items-center space-x-1"
                      >
                        <span>{isMine(task) ? '기사 열기' : '기사 검토하기'}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* [섹션 2]: 수정 요청 중인 기사 (기자 수정 대기) */}
          <div id="sec-d-changes" className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <RotateCcw className="w-4 h-4 text-amber-500 shrink-0" />
                <h3 className="text-xs font-bold text-slate-900">
                  수정 요청 중인 기사 ({deskChangesRequested.length})
                </h3>
              </div>
              <span className="text-[12px] text-slate-500">기자의 수정 보완 진행 상황을 모니터링합니다</span>
            </div>

            <div className="divide-y divide-slate-100">
              {deskChangesRequested.length === 0 ? (
                <div className="p-8 text-center text-xs font-medium text-slate-400">
                  현재 수정 대기 중인 기사가 없습니다.
                </div>
              ) : (
                deskChangesRequested.map(task => (
                  <div
                    key={task.id}
                    onClick={() => onSelectProject(task.projectId)}
                    className="p-4 hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between gap-3 group"
                  >
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <ArticleStatusBadge status={task.status} size="sm" showDot={true} />
                        {renderMineBadge(task)}
                        <span className="text-xs font-bold text-slate-700">{task.authorName} 기자</span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-500">{task.projectName}</span>
                        {renderDeadlineBadge(task)}
                      </div>
                      <h4 className="text-sm font-bold text-slate-800 line-clamp-1">{task.title}</h4>
                      {task.changesReason && (
                        <p className="text-xs text-rose-800 bg-rose-50/60 p-2 rounded border border-rose-200/60 line-clamp-1">
                          <span className="font-bold">[수정 요청 사유]:</span> {task.changesReason}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      {isDesk && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAssignModalTarget(task);
                          }}
                          className="px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-blue-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors shadow-2xs cursor-pointer flex items-center space-x-1"
                        >
                          <UserCheck className="w-3.5 h-3.5 text-slate-500" />
                          <span>배정/마감</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectProject(task.projectId);
                        }}
                        className="px-3 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg font-semibold text-xs transition-colors shrink-0 cursor-pointer"
                      >
                        상세 보기
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* [섹션 3]: 승인 및 출고 대기 기사 */}
          {canSeeReadyQueue && (
          <div id="sec-d-ready" className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
            <div className="px-5 py-3.5 bg-purple-50/60 border-b border-purple-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-purple-600 shrink-0" />
                <h3 className="text-xs font-bold text-purple-900">
                  출고 대기 기사 ({deskReadyQueue.length})
                </h3>
              </div>
              <span className="text-[12px] text-purple-700">부장 직급은 상단 [기사 출고]를 통해 즉시 배포할 수 있습니다</span>
            </div>

            <div className="divide-y divide-slate-100">
              {deskReadyQueue.length === 0 ? (
                <div className="p-8 text-center text-xs font-medium text-slate-400">
                  현재 출고 대기 중인 기사가 없습니다.
                </div>
              ) : (
                deskReadyQueue.map(task => (
                  <div
                    key={task.id}
                    onClick={() => onSelectProject(task.projectId)}
                    className="p-4 hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between gap-3 group"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <ArticleStatusBadge status={task.status} size="sm" showDot={true} />
                        {renderMineBadge(task)}
                        <span className="text-xs font-bold text-slate-700">{task.authorName} 기자</span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-500">{task.projectName}</span>
                        {renderDeadlineBadge(task)}
                      </div>
                      <h4 className="text-sm font-bold text-slate-800 line-clamp-1">{task.title}</h4>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      {isDesk && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAssignModalTarget(task);
                          }}
                          className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:text-purple-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors shadow-2xs cursor-pointer flex items-center space-x-1"
                        >
                          <UserCheck className="w-3.5 h-3.5 text-slate-500" />
                          <span>배정/마감</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectProject(task.projectId);
                        }}
                        className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold text-xs transition-colors shrink-0 cursor-pointer"
                      >
                        기사 확인
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          )}
        </div>
      )}

      {/* 4. 기사 배정 및 마감시간 설정 모달 */}
      {assignModalTarget && (
        <AssignArticleModal
          isOpen={Boolean(assignModalTarget)}
          onClose={() => setAssignModalTarget(null)}
          articleId={assignModalTarget.articleId}
          articleTitle={assignModalTarget.title}
          currentAuthorId={assignModalTarget.authorId}
          currentDeadlineAt={assignModalTarget.deadlineAt}
          onSuccess={() => {
            onRefresh?.();
          }}
          showToast={(msg) => {
            showToast?.(msg);
          }}
        />
      )}
    </div>
  );
};
