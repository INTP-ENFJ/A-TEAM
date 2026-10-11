/**
 * PRESS-CMS AI Review Service
 * 
 * Supabase Edge Function (`review-article-content`)을 통한
 * 안전하고 통제된 실제 Gemini AI 기사 검수를 전담합니다.
 * 
 * [원칙]
 * - 기사 원문(제목, 부제, 본문 블록)은 절대로 자동 수정하지 않습니다.
 * - AI 검수 결과는 DB에 영속 저장하지 않고 화면 세션(State)에서만 관리합니다.
 * - 연타 방지: 검수 진행 중 중복 호출 방어 및 5초 쿨다운(Cooldown) 정책 적용.
 */

import { friendlyAiError } from './aiErrors';
import { getAiKeyHeaders } from './aiKey';
import { supabase } from '../lib/supabase';
import { AiReviewItem, AiReviewCategory, ReviewStatus } from '../types';
import { IAiReviewService } from './apiInterfaces';

export interface EdgeFunctionReviewItem {
  blockId: string;
  sourceText: string;
  category: AiReviewCategory;
  subCategory?: string;
  reason?: string;
  checkPoint?: string;
  suggestionExample?: string;
}

export interface EdgeFunctionReviewResponse {
  success: boolean;
  articleId: string;
  model: string;
  reviews: EdgeFunctionReviewItem[];
  message?: string;
  error?: string;
  code?: string;
}

class AiReviewService implements IAiReviewService {
  private isScanning = false;
  private lastScanTimestamp = 0;
  private readonly COOLDOWN_MS = 5000; // 5초 재실행 쿨다운

  /**
   * 현재 쿨다운 남은 시간(초) 반환 (0이면 실행 가능)
   */
  getRemainingCooldownSeconds(): number {
    const elapsed = Date.now() - this.lastScanTimestamp;
    if (elapsed >= this.COOLDOWN_MS) return 0;
    return Math.ceil((this.COOLDOWN_MS - elapsed) / 1000);
  }

  /**
   * 현재 AI 검수가 진행 중인지 여부
   */
  getIsScanning(): boolean {
    return this.isScanning;
  }

  /**
   * 기사 ID로 AI 검수 실행 (Edge Function 'review-article-content' 호출)
   */
  async runAiScan(articleId: string): Promise<AiReviewItem[]> {
    if (!articleId) {
      throw new Error('검수할 기사 ID가 유효하지 않습니다.');
    }

    // 1. 중복 실행 방어
    if (this.isScanning) {
      throw new Error('현재 AI 검수가 진행 중입니다. 잠시만 기다려주세요.');
    }

    // 2. 쿨다운 검증
    const remainingCooldown = this.getRemainingCooldownSeconds();
    if (remainingCooldown > 0) {
      throw new Error(`AI 검수 쿨다운 중입니다. ${remainingCooldown}초 후에 다시 시도해주세요.`);
    }

    this.isScanning = true;

    try {
      const { data, error } = await supabase.functions.invoke<EdgeFunctionReviewResponse>(
        'review-article-content',
        {
          body: { articleId },
          headers: await getAiKeyHeaders(),
        }
      );

      if (error) {
        console.error('[AiReviewService.runAiScan] Edge Function invocation error:', error);
        throw new Error(await friendlyAiError(error));
      }

      if (!data || !data.success) {
        throw new Error(data?.error || 'AI 검수 결과를 올바르게 수신하지 못했습니다.');
      }

      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const rawReviews = data.reviews || [];

      // 클라이언트 런타임 AiReviewItem 포맷으로 매핑
      const formattedReviews: AiReviewItem[] = rawReviews.map((rev, index) => ({
        id: `ai_rev_${Date.now()}_${index + 1}`,
        articleId,
        blockId: rev.blockId,
        sourceText: rev.sourceText,
        category: rev.category,
        subCategory: rev.subCategory || '일반 검토',
        reason: rev.reason || '기사 작성 가이드라인 확인 필요',
        checkPoint: rev.checkPoint || '원문의 문맥과 사실관계를 확인하세요.',
        suggestionExample: rev.suggestionExample || undefined,
        status: 'pending' as ReviewStatus,
        createdAt: timeStr,
      }));

      // 검수 성공 후 타임스탬프 기록
      this.lastScanTimestamp = Date.now();
      return formattedReviews;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * 기존 하위 호환성 메서드 (화면 State에서 관리하므로 메모리용 스텁)
   */
  async getReviewsByArticleId(_articleId: string): Promise<AiReviewItem[]> {
    return [];
  }

  async resolveReview(_reviewId: string): Promise<void> {
    // 클라이언트 state에서 처리
  }

  async ignoreReview(_reviewId: string): Promise<void> {
    // 클라이언트 state에서 처리
  }

  async undoReview(_reviewId: string): Promise<void> {
    // 클라이언트 state에서 처리
  }
}

export const aiReviewService = new AiReviewService();
