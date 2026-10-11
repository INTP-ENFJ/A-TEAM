/**
 * 피드백 형광펜 / AI 검수 하이라이트 공용 도구
 * (기존 편집기와 새 본문 편집기가 같은 규칙으로 위치를 찾고 같은 색을 쓰도록 한 곳에 모아 둠)
 */
import type { ArticleFeedback } from '../../types';

// ==========================================
// 2. 피드백 앵커 매칭 & 복구 인터페이스 및 헬퍼
// ==========================================
export interface AnchorMatch {
  feedbackId: string;
  startIndex: number;
  endIndex: number;
  selectedText: string;
  color?: HighlighterColor;
}

/**
 * 본문 내에서 feedback의 selectedText 및 앞뒤 문맥(contextBefore, contextAfter)을 기반으로
 * 앵커의 시작/종료 인덱스를 찾아 반환합니다. (본문 일부가 수정되어도 최대한 복구)
 */
export function findFeedbackAnchors(
  fullText: string,
  feedbacks: ArticleFeedback[]
): AnchorMatch[] {
  const matches: AnchorMatch[] = [];
  if (!fullText) return matches;

  for (const fb of feedbacks) {
    if (!fb.selectedText || fb.selectedText.trim().length === 0) continue;
    const target = fb.selectedText.trim();

    // 1순위: contextBefore + selectedText + contextAfter 완벽 일치 탐색
    if (fb.contextBefore && fb.contextAfter) {
      const fullContextPattern = fb.contextBefore + target + fb.contextAfter;
      const ctxIdx = fullText.indexOf(fullContextPattern);
      if (ctxIdx !== -1) {
        const start = ctxIdx + fb.contextBefore.length;
        matches.push({
          feedbackId: fb.id,
          startIndex: start,
          endIndex: start + target.length,
          selectedText: target,
          color: (fb.color as HighlighterColor) || 'emerald',
        });
        continue;
      }
    }

    // 2순위: 부분 context (contextBefore 뒤 15자 + target) 탐색
    if (fb.contextBefore) {
      const partialBefore = fb.contextBefore.slice(-15) + target;
      const ctxIdx = fullText.indexOf(partialBefore);
      if (ctxIdx !== -1) {
        const start = ctxIdx + fb.contextBefore.slice(-15).length;
        matches.push({
          feedbackId: fb.id,
          startIndex: start,
          endIndex: start + target.length,
          selectedText: target,
          color: (fb.color as HighlighterColor) || 'emerald',
        });
        continue;
      }
    }

    // 3순위: target이 본문에 등장하는 위치 (startOffset과 가장 가까운 위치 우선)
    const occurrences: number[] = [];
    let idx = fullText.indexOf(target);
    while (idx !== -1) {
      occurrences.push(idx);
      idx = fullText.indexOf(target, idx + 1);
    }

    if (occurrences.length === 1) {
      matches.push({
        feedbackId: fb.id,
        startIndex: occurrences[0],
        endIndex: occurrences[0] + target.length,
        selectedText: target,
        color: (fb.color as HighlighterColor) || 'emerald',
      });
      continue;
    }

    if (occurrences.length > 1) {
      if (fb.startOffset !== undefined) {
        occurrences.sort((a, b) => Math.abs(a - fb.startOffset!) - Math.abs(b - fb.startOffset!));
      }
      matches.push({
        feedbackId: fb.id,
        startIndex: occurrences[0],
        endIndex: occurrences[0] + target.length,
        selectedText: target,
        color: (fb.color as HighlighterColor) || 'emerald',
      });
    }
  }

  return matches;
}

export type HighlighterColor = 'emerald' | 'amber' | 'blue' | 'rose' | 'purple';

export const HIGHLIGHTER_STYLES: Record<HighlighterColor, { focused: string; normal: string; dot: string; label: string }> = {
  emerald: {
    focused: 'bg-emerald-300 ring-2 ring-emerald-500 shadow-sm animate-pulse',
    normal: 'bg-emerald-200/90 border-b-2 border-emerald-500',
    dot: 'bg-emerald-500',
    label: '에메랄드',
  },
  amber: {
    focused: 'bg-amber-300 ring-2 ring-amber-500 shadow-sm animate-pulse',
    normal: 'bg-amber-200/90 border-b-2 border-amber-500',
    dot: 'bg-amber-500',
    label: '앰버',
  },
  blue: {
    focused: 'bg-blue-300 ring-2 ring-blue-500 shadow-sm animate-pulse',
    normal: 'bg-blue-200/90 border-b-2 border-blue-500',
    dot: 'bg-blue-500',
    label: '블루',
  },
  rose: {
    focused: 'bg-rose-300 ring-2 ring-rose-500 shadow-sm animate-pulse',
    normal: 'bg-rose-200/90 border-b-2 border-rose-500',
    dot: 'bg-rose-500',
    label: '로즈',
  },
  purple: {
    focused: 'bg-purple-300 ring-2 ring-purple-500 shadow-sm animate-pulse',
    normal: 'bg-purple-200/90 border-b-2 border-purple-500',
    dot: 'bg-purple-500',
    label: '퍼플',
  },
};

