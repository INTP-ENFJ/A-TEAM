import React, { useState, useEffect, useCallback } from 'react';
import { 
  Send, 
  X, 
  CheckCircle2, 
  AlertTriangle, 
  Check, 
  ShieldCheck,
  XCircle,
  Clock,
  FileText,
  Radio,
  Loader2
} from 'lucide-react';
import { Article, PublishPreflightResult } from '../../types';
import { articleService } from '../../services/articleService';
import { supabase } from '../../lib/supabase';

interface PublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  article: Article;
  onConfirmPublish: (selectedChannels: string[]) => Promise<void> | void;
}

const ALL_CHANNELS = [
  '네이버 뉴스 (Naver News API)',
  '다음/카카오 뉴스 (Daum News API)',
  '뉴스룸 웹사이트 (Official Web/App)',
  '지면 CMS (CTS 조판망)',
  '모바일 긴급 속보 Push 알림',
];

export const PublishModal: React.FC<PublishModalProps> = ({
  isOpen,
  onClose,
  article,
  onConfirmPublish,
}) => {
  const [channels, setChannels] = useState<string[]>([
    '네이버 뉴스 (Naver News API)',
    '다음/카카오 뉴스 (Daum News API)',
    '뉴스룸 웹사이트 (Official Web/App)',
    '지면 CMS (CTS 조판망)',
  ]);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState(0);
  const [isSuccess, setIsSuccess] = useState(false);
  const [preflightResult, setPreflightResult] = useState<PublishPreflightResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  // 이 기사에 AI 초안 도구를 쓴 적이 있는지 (송고 전 AI 사용 안내용)
  const [usedAiDraft, setUsedAiDraft] = useState(false);

  // 클라이언트 즉시 사전 검증 (빠른 반응성)
  const clientStatusReady = article.status === 'ready';
  const clientTitleValid = (article.title || '').trim().length > 0;
  const clientBodyValid = article.blocks.some(b => (b.text || '').trim().length > 0);
  const clientChannelsValid = channels.length > 0;
  const isEmbargoInFuture = article.embargo ? new Date(article.embargo).getTime() > Date.now() : false;
  const clientEmbargoValid = !isEmbargoInFuture;

  // 서버 RPC 출고 사전 검증 (Preflight)
  const runServerPreflight = useCallback(async (targetChannels: string[]) => {
    if (!article.id) return;
    setIsValidating(true);
    setPreflightError(null);
    try {
      const res = await articleService.validatePublishPreflight(article.id, targetChannels);
      setPreflightResult(res);
    } catch (err: any) {
      console.error('[PublishModal] Preflight validation error:', err);
      setPreflightError(err.message || '출고 사전 검증 요청 중 오류가 발생했습니다.');
    } finally {
      setIsValidating(false);
    }
  }, [article.id]);

  useEffect(() => {
    if (isOpen) {
      setIsPublishing(false);
      setPublishProgress(0);
      setIsSuccess(false);
      runServerPreflight(channels);
    }
  }, [isOpen, runServerPreflight]);

  useEffect(() => {
    if (!isOpen || !article.id) return;
    let alive = true;
    supabase
      .from('ai_draft_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('article_id', article.id)
      .then(({ count, error }) => { if (alive && !error) setUsedAiDraft((count || 0) > 0); });
    return () => { alive = false; };
  }, [isOpen, article.id]);

  // 채널 변경 시 서버 Preflight 재검증 (디바운스)
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      runServerPreflight(channels);
    }, 200);
    return () => clearTimeout(timer);
  }, [channels, isOpen, runServerPreflight]);

  if (!isOpen) return null;

  // 최종 유효성 판단: 서버 응답이 있으면 서버 checks 반영, 없으면 클라이언트 체크 기준
  const statusReady = preflightResult ? preflightResult.checks.status_ready : clientStatusReady;
  const titleValid = preflightResult ? preflightResult.checks.title_valid : clientTitleValid;
  const bodyValid = preflightResult ? preflightResult.checks.body_valid : clientBodyValid;
  const channelsValid = preflightResult ? preflightResult.checks.channels_valid : clientChannelsValid;
  const embargoValid = preflightResult ? preflightResult.checks.embargo_valid : clientEmbargoValid;
  const permissionValid = preflightResult?.checks.permission_valid ?? true;

  const isAllChecksPassed = 
    statusReady && 
    titleValid && 
    bodyValid && 
    channelsValid && 
    embargoValid && 
    permissionValid &&
    (!preflightResult || preflightResult.valid);

  const unresolvedInfoChecks = article.aiReviews.filter(
    r => r.type === 'information_check' && r.status === 'pending'
  );

  const toggleChannel = (channel: string) => {
    if (isPublishing) return;
    setChannels(prev => 
      prev.includes(channel) ? prev.filter(c => c !== channel) : [...prev, channel]
    );
  };

  const handleStartPublish = async () => {
    if (isPublishing || !isAllChecksPassed || isValidating) return;

    setIsPublishing(true);
    setPublishProgress(25);

    const progressInterval = setInterval(() => {
      setPublishProgress(prev => {
        if (prev >= 85) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + 20;
      });
    }, 150);

    try {
      await onConfirmPublish(channels);
      clearInterval(progressInterval);
      setPublishProgress(100);
      setIsPublishing(false);
      setIsSuccess(true);
    } catch (err: any) {
      clearInterval(progressInterval);
      setIsPublishing(false);
      setPublishProgress(0);
      console.error('[PublishModal.handleStartPublish] Failed:', err);
      // 서버 에러 발생 시 Preflight 재실행하여 원인 파악
      runServerPreflight(channels);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 select-none">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-xl border border-slate-300 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div 
          style={{ background: 'var(--grad-topbar)' }}
          className="p-4 text-white flex items-center justify-between border-b border-slate-800 shrink-0"
        >
          <div className="flex items-center space-x-2">
            <Send className="w-4 h-4 text-blue-300" />
            <h3 className="text-sm font-bold">기사 출고</h3>
          </div>
          <button 
            onClick={onClose} 
            disabled={isPublishing}
            className="text-slate-400 hover:text-white cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        {!isSuccess ? (
          <div className="p-6 space-y-4 text-xs text-slate-700 overflow-y-auto">
            {/* Confirmation Banner */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
              <h4 className="text-sm font-bold text-slate-900">최종 출고 전 검증(Publish Preflight)</h4>
              <p className="text-[12px] text-slate-600 mt-0.5 leading-relaxed">
                출고 기준 충족 여부를 확인한 후 승인된 기사만 지정된 송고 채널로 배포됩니다.
              </p>
            </div>

            {/* Article Digest */}
            <div className="p-3 bg-white border border-slate-200 rounded-md space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold uppercase text-slate-400">출고 대상 기사</span>
                <span className={`text-[12px] font-bold px-1.5 py-0.5 rounded border ${
                  article.status === 'ready' 
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                    : 'bg-amber-50 text-amber-700 border-amber-300'
                }`}>
                  상태: {article.status}
                </span>
              </div>
              <h5 className="text-sm font-bold text-slate-900 line-clamp-1">{article.title || '(제목 없음)'}</h5>
              <div className="flex items-center space-x-2 text-[12px] text-slate-500">
                <span>{article.desk || '데스크 미지정'}</span>
                <span>•</span>
                <span>{article.reporter || '기자 미지정'}</span>
                <span>•</span>
                <span>원고 {article.charCount.toLocaleString()}자</span>
                {article.embargo && (
                  <>
                    <span>•</span>
                    <span className="text-amber-700 font-medium">엠바고: {new Date(article.embargo).toLocaleString('ko-KR')}</span>
                  </>
                )}
              </div>
            </div>

            {/* Preflight Checklist Section */}
            <div className="space-y-2 border border-slate-200 rounded-md p-3 bg-slate-50/60">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800 flex items-center space-x-1.5">
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                  <span>출고 전 필수 검증 체크리스트</span>
                </span>
                {isValidating ? (
                  <span className="flex items-center space-x-1 text-[12px] text-blue-600">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>서버 검증 중...</span>
                  </span>
                ) : isAllChecksPassed ? (
                  <span className="text-[12px] font-bold text-emerald-600 flex items-center space-x-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>검증 통과 (출고 가능)</span>
                  </span>
                ) : (
                  <span className="text-[12px] font-bold text-rose-600 flex items-center space-x-1">
                    <XCircle className="w-3.5 h-3.5" />
                    <span>검증 미달 (출고 불가)</span>
                  </span>
                )}
              </div>

              {/* 5개 핵심 체크리스트 아이템 */}
              <div className="grid grid-cols-1 gap-1.5 pt-1">
                {/* 1. 기사 상태 */}
                <div className={`p-2 rounded border flex items-center justify-between ${
                  statusReady ? 'bg-white border-slate-200 text-slate-700' : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}>
                  <div className="flex items-center space-x-2">
                    <div className="shrink-0">
                      {statusReady ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[3]" />
                      ) : (
                        <X className="w-3.5 h-3.5 text-rose-600 stroke-[3]" />
                      )}
                    </div>
                    <div>
                      <span className="font-semibold text-xs">기사 승인 상태</span>
                      <span className="text-[12px] text-slate-500 ml-1.5">출고 대기(ready) 상태 필수</span>
                    </div>
                  </div>
                  <span className={`text-[12px] font-bold ${statusReady ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {statusReady ? 'PASS' : `FAIL (${article.status})`}
                  </span>
                </div>

                {/* 2. 기사 제목 */}
                <div className={`p-2 rounded border flex items-center justify-between ${
                  titleValid ? 'bg-white border-slate-200 text-slate-700' : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}>
                  <div className="flex items-center space-x-2">
                    <div className="shrink-0">
                      {titleValid ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[3]" />
                      ) : (
                        <X className="w-3.5 h-3.5 text-rose-600 stroke-[3]" />
                      )}
                    </div>
                    <div>
                      <span className="font-semibold text-xs">기사 제목 유효성</span>
                      <span className="text-[12px] text-slate-500 ml-1.5">공백 제외 1자 이상 입력</span>
                    </div>
                  </div>
                  <span className={`text-[12px] font-bold ${titleValid ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {titleValid ? 'PASS' : 'FAIL (제목 없음)'}
                  </span>
                </div>

                {/* 3. 본문 실질 텍스트 */}
                <div className={`p-2 rounded border flex items-center justify-between ${
                  bodyValid ? 'bg-white border-slate-200 text-slate-700' : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}>
                  <div className="flex items-center space-x-2">
                    <div className="shrink-0">
                      {bodyValid ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[3]" />
                      ) : (
                        <X className="w-3.5 h-3.5 text-rose-600 stroke-[3]" />
                      )}
                    </div>
                    <div className="flex items-center space-x-1">
                      <FileText className="w-3 h-3 text-slate-400" />
                      <span className="font-semibold text-xs">본문 텍스트 존재</span>
                      <span className="text-[12px] text-slate-500 ml-1">실질적인 본문 문단 최소 1개 이상</span>
                    </div>
                  </div>
                  <span className={`text-[12px] font-bold ${bodyValid ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {bodyValid ? 'PASS' : 'FAIL (실질 본문 없음)'}
                  </span>
                </div>

                {/* 4. 출고 채널 선택 */}
                <div className={`p-2 rounded border flex items-center justify-between ${
                  channelsValid ? 'bg-white border-slate-200 text-slate-700' : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}>
                  <div className="flex items-center space-x-2">
                    <div className="shrink-0">
                      {channelsValid ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[3]" />
                      ) : (
                        <X className="w-3.5 h-3.5 text-rose-600 stroke-[3]" />
                      )}
                    </div>
                    <div className="flex items-center space-x-1">
                      <Radio className="w-3 h-3 text-slate-400" />
                      <span className="font-semibold text-xs">출고 대상 채널</span>
                      <span className="text-[12px] text-slate-500 ml-1">최소 1개 이상의 송고 채널 선택</span>
                    </div>
                  </div>
                  <span className={`text-[12px] font-bold ${channelsValid ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {channelsValid ? `PASS (${channels.length}개 선택)` : 'FAIL (채널 미선택)'}
                  </span>
                </div>

                {/* 5. 엠바고 시각 */}
                <div className={`p-2 rounded border flex items-center justify-between ${
                  embargoValid ? 'bg-white border-slate-200 text-slate-700' : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}>
                  <div className="flex items-center space-x-2">
                    <div className="shrink-0">
                      {embargoValid ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[3]" />
                      ) : (
                        <X className="w-3.5 h-3.5 text-rose-600 stroke-[3]" />
                      )}
                    </div>
                    <div className="flex items-center space-x-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span className="font-semibold text-xs">엠바고 검증</span>
                      <span className="text-[12px] text-slate-500 ml-1">미래 엠바고 즉시 출고 차단</span>
                    </div>
                  </div>
                  <span className={`text-[12px] font-bold ${embargoValid ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {embargoValid ? (article.embargo ? 'PASS (엠바고 해제)' : 'PASS (엠바고 없음)') : 'FAIL (미래 엠바고)'}
                  </span>
                </div>
              </div>

              {/* 검증 이슈 목록 (존재하는 경우) */}
              {preflightResult?.issues && preflightResult.issues.length > 0 && (
                <div className="mt-2 p-2.5 bg-rose-50 border border-rose-300 rounded text-rose-900 space-y-1">
                  <div className="font-bold flex items-center space-x-1 text-[12px]">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span>출고 차단 원인 ({preflightResult.issues.length}건):</span>
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-[12px] pl-1">
                    {preflightResult.issues.map((issue, idx) => (
                      <li key={idx} className="leading-tight">{issue.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {preflightError && (
                <div className="p-2 bg-amber-50 border border-amber-300 rounded text-amber-900 text-[12px]">
                  검증 오류: {preflightError}
                </div>
              )}
            </div>

            {/* AI Review Validation Pre-check */}
            <div className="space-y-1.5">
              <span className="font-bold text-slate-700 block">AI 품질 검수 상태</span>
              {unresolvedInfoChecks.length > 0 ? (
                <div className="p-2.5 bg-amber-50 border border-amber-300 rounded text-amber-900 space-y-1">
                  <div className="flex items-center space-x-1.5 font-bold text-xs">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>주의: 정보 확인 필요 {unresolvedInfoChecks.length}건이 미해결 상태입니다.</span>
                  </div>
                  <p className="text-[12px] text-amber-800">
                    사실관계 오류나 누락 정보가 없는지 확인 후 출고하시기 바랍니다.
                  </p>
                </div>
              ) : (
                <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-emerald-900 flex items-center space-x-2 text-[12px]">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>모든 정보 확인 검토가 완료되었습니다.</span>
                </div>
              )}
            </div>

            {/* AI 사용 안내 (참고용, 출고를 막지 않음) */}
            {usedAiDraft && (
              <div className="p-2.5 bg-violet-50 border border-violet-200 rounded text-violet-900 space-y-0.5">
                <div className="flex items-center space-x-1.5 font-bold text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 text-violet-600 shrink-0" />
                  <span>이 기사에는 AI 초안 도구를 사용한 기록이 있습니다.</span>
                </div>
                <p className="text-[12px] text-violet-800">
                  회사의 AI 사용 표기 기준에 따라 필요하면 표기해 주세요. AI가 만든 문장의 사실관계와 인용문은 기자가 직접 확인해야 합니다.
                </p>
              </div>
            )}

            {/* Publication Channels Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-700">출고 채널 선택 <span className="ml-1 text-[12px] font-medium text-slate-500">({channels.length}/5개 선택됨)</span></span>
                <span className="flex items-center gap-2 text-[12px]">
                  <button type="button" onClick={() => setChannels(ALL_CHANNELS)} className="text-blue-600 hover:underline cursor-pointer">모두 선택</button>
                  <span className="text-slate-300">|</span>
                  <button type="button" onClick={() => setChannels([])} className="text-slate-500 hover:underline cursor-pointer">모두 해제</button>
                </span>
              </div>
              {channels.length === 0 && (
                <p className="text-[12px] text-rose-600">내보낼 곳을 하나 이상 골라 주세요. 하나도 고르지 않으면 출고할 수 없습니다.</p>
              )}
              {channels.includes('모바일 긴급 속보 Push 알림') && (
                <p className="text-[12px] text-amber-700">⚠ 긴급 속보 알림은 구독자 전체에게 알림이 바로 나갑니다. 꼭 필요할 때만 선택하세요.</p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {[
                  { id: '네이버 뉴스 (Naver News API)', desc: '네이버 뉴스스탠드 및 통합검색 연동' },
                  { id: '다음/카카오 뉴스 (Daum News API)', desc: '다음 포털 및 카카오 채널 뉴스 출고' },
                  { id: '뉴스룸 웹사이트 (Official Web/App)', desc: '사내 자체 웹 포털 및 모바일 웹 즉시 발행' },
                  { id: '지면 CMS (CTS 조판망)', desc: '내일 자 신문 지면 1면/종합면 조판 전송' },
                  { id: '모바일 긴급 속보 Push 알림', desc: '자체 앱 50만 구독자 긴급 푸시 발송' },
                ].map((item) => {
                  const isChecked = channels.includes(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleChannel(item.id)}
                      className={`p-2.5 rounded-md border cursor-pointer flex items-start space-x-2.5 transition-all ${
                        isChecked
                          ? 'border-slate-800 bg-slate-100 text-slate-900 font-medium'
                          : 'border-slate-200 hover:border-slate-300 text-slate-600 bg-white'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded border mt-0.5 flex items-center justify-center shrink-0 ${
                        isChecked ? 'bg-slate-900 border-slate-900 text-white' : 'border-slate-300 bg-white'
                      }`}>
                        {isChecked && <Check className="w-3 h-3 stroke-[2.5]" />}
                      </div>
                      <div>
                        <div className="font-semibold text-xs leading-tight">{item.id}</div>
                        <div className="text-[12px] text-slate-500 mt-0.5">{item.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Publishing Progress Bar if submitting */}
            {isPublishing && (
              <div className="space-y-1.5 pt-2">
                <div className="flex justify-between text-[12px] text-slate-500">
                  <span>포털 및 통신망 API 출고 패킷 전송 중...</span>
                  <span className="font-mono">{publishProgress}%</span>
                </div>
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-600 transition-all duration-300 rounded-full"
                    style={{ width: `${publishProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
              <div className="text-[12px] text-slate-500">
                {!isAllChecksPassed && (
                  <span className="text-rose-600 font-medium">
                    * 위 필수 검증 항목을 모두 충족해야 최종 출고가 가능합니다.
                  </span>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  disabled={isPublishing}
                  onClick={onClose}
                  className="px-3.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md font-medium text-xs shadow-xs disabled:opacity-50 transition-colors cursor-pointer"
                >
                  취소
                </button>

                <button
                  type="button"
                  id="btn-confirm-publish-submit"
                  disabled={isPublishing || !isAllChecksPassed || isValidating}
                  onClick={handleStartPublish}
                  style={isAllChecksPassed && !isPublishing ? { background: 'var(--grad-button)' } : undefined}
                  className="px-5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-md font-bold text-xs shadow-xs flex items-center space-x-1.5 disabled:opacity-40 disabled:bg-slate-600 disabled:cursor-not-allowed hover:opacity-95 active:opacity-90 transition-all cursor-pointer"
                >
                  {isPublishing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>출고 처리 중...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>최종 기사 출고</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* SUCCESS STATE */
          <div className="p-8 text-center space-y-4 text-xs">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-xs">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900">기사 출고가 성공적으로 완료되었습니다!</h3>
              <p className="text-slate-500 text-xs mt-1">
                선택한 {channels.length}개 채널(포털, 웹, 지면망)에 전송 완료되었습니다.
              </p>
            </div>

            <div className="bg-slate-50 p-3 rounded border text-left text-[12px] text-slate-600 space-y-1">
              <div>• 출고 기사: <strong>{article.title}</strong></div>
              <div>• 출고 시각: <strong>{new Date().toLocaleString('ko-KR')}</strong></div>
              <div>• 출고 채널: <strong>{channels.join(', ')}</strong></div>
              <div>• 기사 상태: <span className="font-bold text-emerald-600">출고 완료 (Published)</span></div>
            </div>

            <div className="pt-3">
              <button
                id="btn-close-publish-success"
                onClick={onClose}
                className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded font-bold transition-colors cursor-pointer"
              >
                확인 및 닫기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
