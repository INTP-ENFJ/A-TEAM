import React from 'react';
import { ArticleStatus, ProjectStatus } from '../../types';

export interface StatusStyleConfig {
  key: string;
  label: string;
  enLabel: string;
  desc: string;
  badgeClass: string;
  dotClass: string;
}

export const ARTICLE_STATUS_CONFIG: Record<string, StatusStyleConfig> = {
  draft: {
    key: 'draft',
    label: '초안 작성중',
    enLabel: 'Draft',
    desc: '기자 단독 작성 중인 기사',
    badgeClass: 'bg-slate-100 text-slate-800 border-slate-300',
    dotClass: 'bg-slate-500',
  },
  Draft: {
    key: 'Draft',
    label: '초안 작성중',
    enLabel: 'Draft',
    desc: '기자 단독 작성 중인 기사',
    badgeClass: 'bg-slate-100 text-slate-800 border-slate-300',
    dotClass: 'bg-slate-500',
  },
  review: {
    key: 'review',
    label: '데스크 감수',
    enLabel: 'Reviewing',
    desc: '데스크/부장 검토 진행 중',
    badgeClass: 'bg-blue-50/90 text-blue-900 border-blue-200',
    dotClass: 'bg-blue-600',
  },
  Reviewing: {
    key: 'Reviewing',
    label: '데스크 감수',
    enLabel: 'Reviewing',
    desc: '데스크/부장 검토 진행 중',
    badgeClass: 'bg-blue-50/90 text-blue-900 border-blue-200',
    dotClass: 'bg-blue-600',
  },
  changes_requested: {
    key: 'changes_requested',
    label: '수정 요청됨',
    enLabel: 'Changes',
    desc: '데스크 수정 요청 진행 중',
    badgeClass: 'bg-rose-50/95 text-rose-950 border-rose-300',
    dotClass: 'bg-rose-600',
  },
  ChangesRequested: {
    key: 'ChangesRequested',
    label: '수정 요청됨',
    enLabel: 'Changes',
    desc: '데스크 수정 요청 진행 중',
    badgeClass: 'bg-rose-50/95 text-rose-950 border-rose-300',
    dotClass: 'bg-rose-600',
  },
  proofread: {
    key: 'proofread',
    label: '교열/팩트체크',
    enLabel: 'Fact Check',
    desc: '교열팀 및 팩트체크 검증 단계',
    badgeClass: 'bg-amber-50/90 text-amber-950 border-amber-300/80',
    dotClass: 'bg-amber-600',
  },
  ready: {
    key: 'ready',
    label: '출고 대기',
    enLabel: 'Ready',
    desc: '최종 승인 완료 및 출고 대기',
    badgeClass: 'bg-purple-50 text-purple-950 border-purple-200',
    dotClass: 'bg-purple-600',
  },
  Ready: {
    key: 'Ready',
    label: '출고 대기',
    enLabel: 'Ready',
    desc: '최종 승인 완료 및 출고 대기',
    badgeClass: 'bg-purple-50 text-purple-950 border-purple-200',
    dotClass: 'bg-purple-600',
  },
  published: {
    key: 'published',
    label: '출고 완료',
    enLabel: 'Published',
    desc: '최종 출고 및 배포 완료',
    badgeClass: 'bg-emerald-50/90 text-emerald-950 border-emerald-300/80',
    dotClass: 'bg-emerald-600',
  },
};

export const getStatusConfig = (status: ArticleStatus | ProjectStatus | string): StatusStyleConfig => {
  return (
    ARTICLE_STATUS_CONFIG[status] || {
      key: String(status),
      label: String(status),
      enLabel: String(status),
      desc: '',
      badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
      dotClass: 'bg-slate-400',
    }
  );
};

export interface ArticleStatusBadgeProps {
  status: ArticleStatus | ProjectStatus | string;
  size?: 'sm' | 'md';
  showDot?: boolean;
  displayMode?: 'ko' | 'en' | 'both';
  className?: string;
}

export const ArticleStatusBadge: React.FC<ArticleStatusBadgeProps> = ({
  status,
  size = 'md',
  showDot = true,
  displayMode = 'both',
  className = '',
}) => {
  const config = getStatusConfig(status);

  const sizeClass =
    size === 'sm'
      ? 'px-2 py-0.5 text-[12px]'
      : 'px-2.5 py-0.5 text-xs';

  let text = config.label;
  if (displayMode === 'en') {
    text = config.enLabel;
  } else if (displayMode === 'both') {
    text = `${config.enLabel} (${config.label})`;
  }

  return (
    <span
      id={`article-status-badge-${String(status).toLowerCase()}`}
      className={`inline-flex items-center font-semibold rounded-full border shadow-2xs whitespace-nowrap select-none ${sizeClass} ${config.badgeClass} ${className}`}
      title={config.desc || config.label}
    >
      {showDot && (
        <span
          className={`w-1.5 h-1.5 rounded-full mr-1.5 shrink-0 ${config.dotClass}`}
          aria-hidden="true"
        />
      )}
      <span>{text}</span>
    </span>
  );
};
