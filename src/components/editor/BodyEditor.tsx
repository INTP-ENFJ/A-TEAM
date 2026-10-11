import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useEditor,
  EditorContent,
  ReactNodeViewRenderer,
  NodeViewWrapper,
  Node,
  Extension,
  mergeAttributes,
} from '@tiptap/react';
import type { NodeViewProps, JSONContent } from '@tiptap/react';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Trash2, Video, Quote, Move, EyeOff } from 'lucide-react';
import type { ArticleBlock, ArticleFeedback } from '../../types';
import { findFeedbackAnchors, HIGHLIGHTER_STYLES } from './feedbackHighlight';
import type { HighlighterColor } from './feedbackHighlight';
import { parseCrop, formatCrop, CROP_MAX_ZOOM } from '../common/mediaCrop';
import type { CropFocus } from '../common/mediaCrop';
import { BlurModal } from './BlurModal';
import { getBlurUploadConfig } from './blurConfig';
import { mediaService } from '../../services/mediaService';
import { blocksToDoc, docToBlocks, MEDIA_NODE_NAME, paragraphJson, mediaItemToBodyAttrs } from './bodyEditorModel';
import type { BodyBlockDraft, BodyMediaAttrs } from './bodyEditorModel';

interface BodyEditorProps {
  /** 이 본문이 속한 기사 ID (저장 대상 구분용) */
  articleId: string;
  /** 처음 불러올 기사 본문 블록 */
  blocks: ArticleBlock[];
  /** 검수(읽기 전용) 모드이면 true */
  readOnly?: boolean;
  /**
   * 저장 함수. 편집기 내용(블록 초안)을 받아 실제 DB 블록 ID 목록(초안과 같은 순서)을 돌려준다.
   * 실패하면 예외를 던진다 (편집기가 알아서 다시 시도한다).
   */
  onSave?: (drafts: BodyBlockDraft[], articleId: string) => Promise<string[]>;
  /** 저장 상태 알림: 'saving' | 'saved' | 'error' */
  onSaveStateChange?: (state: 'saving' | 'saved' | 'error') => void;
  /** 피드백 형광펜으로 표시할 피드백 목록 */
  feedbacks?: ArticleFeedback[];
  /** 지금 강조(깜빡임)할 피드백 ID */
  highlightedFeedbackId?: string | null;
  /** AI 검수 대상: 이 칸(블록)의 이 글귀를 노란색으로 표시 */
  aiHighlightBlockId?: string | null;
  aiHighlightText?: string | null;
  /** 글을 마우스로 드래그해 선택했을 때 (피드백 작성 버튼을 띄우기 위함) */
  onTextSelected?: (info: BodyTextSelection) => void;
  /** 선택이 풀렸을 때 */
  onSelectionCollapsed?: () => void;
  /**
   * 바깥에서 쓸 수 있는 조작 함수 등록 (해제할 때 null)
   * - flush: 지금 즉시 저장 (수동 저장·화면 전환 전)
   * - discard: 아직 저장 안 된 변경을 버림 (서버 최신본을 다시 불러올 때)
   */
  registerControls?: (controls: BodyEditorControls | null) => void;
}

/** 본문에서 드래그해 선택한 글 정보 (피드백 앵커 저장용) */
export interface BodyTextSelection {
  blockId?: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
  contextBefore: string;
  contextAfter: string;
  clientX: number;
  clientY: number;
}

export interface BodyEditorControls {
  flush: () => Promise<void>;
  discard: () => void;
  /**
   * 사진/영상 덩어리를 본문에 넣는다.
   * where: 숫자 = 그 칸 번호 앞, 'cursor' = 글 쓰던 자리 다음(없으면 맨 끝), 'end' = 맨 끝
   */
  insertMedia: (items: BodyMediaAttrs[], where: number | 'cursor' | 'end') => boolean;
  /** TXT에서 읽은 문단들을 본문 끝에 덧붙이거나(append) 본문 전체를 바꾼다(replace) */
  importParagraphs: (paragraphs: string[], mode: 'append' | 'replace') => boolean;
}

const SAVE_DEBOUNCE_MS = 800;
const SAVE_RETRY_MS = 5000;

// ------------------------------------------------------------
// 사진/영상/인용구 "덩어리" 화면
// ------------------------------------------------------------
const MediaNodeView: React.FC<NodeViewProps> = ({ node, updateAttributes, deleteNode, editor }) => {
  const a = node.attrs as Record<string, any>;
  const editable = editor.isEditable;
  const kind: 'image' | 'video' | 'quote' = a.blockType === 'video' ? 'video' : a.blockType === 'quote' ? 'quote' : 'image';
  const src: string | undefined = a.runtimeMediaUrl || a.mediaUrl || undefined;

  // 사진 자르기: 16:9 칸 안에서 확대(z)하고 보이는 부분(x,y)을 옮긴다
  const savedCropOrNull = parseCrop(a.focus);
  const savedCrop: CropFocus = savedCropOrNull ?? { x: 50, y: 50, z: 1 };
  const [adjusting, setAdjusting] = useState(false);
  const [blurOpen, setBlurOpen] = useState(false);
  const [liveCrop, setLiveCrop] = useState<CropFocus | null>(null);
  const liveCropRef = useRef<CropFocus | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ px: number; py: number; fx: number; fy: number } | null>(null);
  const shown = liveCrop ?? savedCrop;
  // 자르기 값이 있거나 조절 중일 때만 16:9 칸으로 보여주고, 아니면 원본 전체를 보여준다
  const cropped = kind === 'image' && (savedCropOrNull !== null || liveCrop !== null);
  const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
  const setLive = (c: CropFocus) => { liveCropRef.current = c; setLiveCrop(c); };
  const commitCrop = () => {
    const c = liveCropRef.current;
    if (!c) return;
    updateAttributes({ focus: formatCrop(c) });
    liveCropRef.current = null;
    setLiveCrop(null);
  };

  const handleFocusDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!adjusting) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { px: e.clientX, py: e.clientY, fx: shown.x, fy: shown.y };
  };
  const handleFocusMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const img = imgRef.current;
    if (!d || !img || !img.naturalWidth || !img.naturalHeight) return;
    const fw = img.clientWidth;
    const fh = img.clientHeight;
    const scale = Math.max(fw / img.naturalWidth, fh / img.naturalHeight) * shown.z;
    const overflowX = img.naturalWidth * scale - fw;
    const overflowY = img.naturalHeight * scale - fh;
    // 사진을 손으로 끄는 것처럼: 오른쪽으로 끌면 사진의 왼쪽 부분이 보인다
    const nx = overflowX > 1 ? clamp(d.fx - ((e.clientX - d.px) / overflowX) * 100) : d.fx;
    const ny = overflowY > 1 ? clamp(d.fy - ((e.clientY - d.py) / overflowY) * 100) : d.fy;
    setLive({ x: nx, y: ny, z: shown.z });
  };
  const handleFocusUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    commitCrop();
  };
  const changeZoom = (z: number) => setLive({ x: shown.x, y: shown.y, z: clamp(z, 1, CROP_MAX_ZOOM) });
  const resetCrop = () => setLive({ x: 50, y: 50, z: 1 });
  const removeCrop = () => {
    liveCropRef.current = null;
    setLiveCrop(null);
    setAdjusting(false);
    updateAttributes({ focus: null });
  };
  const startAdjust = () => {
    if (!savedCropOrNull) setLive({ x: 50, y: 50, z: 1 });
    setAdjusting(true);
  };

  // 가린 사진을 새 파일로 저장하고, 이 칸의 사진만 바꾼다 (원본은 라이브러리에 그대로 남음)
  const applyBlur = async (file: File) => {
    const cfg = getBlurUploadConfig();
    const meta = {
      title: `가림 처리한 사진 ${new Date().toLocaleDateString('ko-KR')}`,
      caption: a.caption || undefined,
      credit: a.credit || undefined,
      uploader: cfg.uploader,
    };
    let item;
    try {
      item = await mediaService.uploadMedia(cfg.projectId, file, meta);
    } catch (e) {
      if (!cfg.projectId) throw e;
      item = await mediaService.uploadMedia(null, file, meta); // 프로젝트 주인이 아니면 프로젝트 없이 보관
    }
    const next = mediaItemToBodyAttrs(item);
    updateAttributes({
      mediaUrl: next.mediaUrl,
      runtimeMediaUrl: next.runtimeMediaUrl,
      mediaType: next.mediaType,
      fileFormat: next.fileFormat,
      fileSize: next.fileSize,
    });
    setBlurOpen(false);
  };

  return (
    <NodeViewWrapper className="group relative my-6 rounded-lg" data-block-id={a.blockId || undefined}>
      {blurOpen && src && <BlurModal src={src} onClose={() => setBlurOpen(false)} onApply={applyBlur} />}
      {kind === 'quote' ? (
        <div
          contentEditable={false}
          className="border-l-4 border-blue-600 pl-4 py-2 bg-blue-50/20 rounded-r"
        >
          <Quote className="w-5 h-5 text-blue-600 opacity-60 mb-1" />
          <textarea
            readOnly={!editable}
            value={a.text || ''}
            onChange={e => updateAttributes({ text: e.target.value })}
            placeholder="핵심 인용구..."
            rows={2}
            className="w-full text-base font-serif italic text-slate-800 leading-relaxed bg-transparent border-none outline-none resize-none"
          />
          <input
            type="text"
            readOnly={!editable}
            value={a.caption || ''}
            onChange={e => updateAttributes({ caption: e.target.value })}
            placeholder="— 발언자 직함 및 성명"
            className="w-full text-xs text-slate-500 bg-transparent border-t border-slate-200/60 pt-1 focus:outline-none"
          />
        </div>
      ) : (
        <div contentEditable={false}>
          <div
            // 사진/영상 부분 어디든 누른 채 끌면 옮겨진다 (캡션 입력칸은 제외)
            {...(editable && !adjusting ? { 'data-drag-handle': '' } : {})}
            title={adjusting ? '끌어서 보이는 부분을 조절하세요' : editable ? '누른 채 끌어서 다른 위치로 이동' : undefined}
            onPointerDown={handleFocusDown}
            onPointerMove={handleFocusMove}
            onPointerUp={handleFocusUp}
            onPointerCancel={handleFocusUp}
            className={`relative rounded-lg overflow-hidden border border-slate-200 ${
              adjusting ? 'cursor-move ring-2 ring-blue-500 touch-none' : editable ? 'cursor-grab active:cursor-grabbing' : ''
            } ${
              kind === 'video' ? 'bg-slate-950 flex items-center justify-center h-72' : cropped ? 'bg-slate-900 aspect-video' : 'bg-slate-900'
            }`}
          >
            {src && (
              <img
                ref={imgRef}
                src={src}
                alt={a.caption || (kind === 'video' ? '영상 썸네일' : '보도사진')}
                draggable={false}
                style={kind === 'video' || !cropped ? undefined : {
                  objectPosition: `${shown.x}% ${shown.y}%`,
                  transformOrigin: `${shown.x}% ${shown.y}%`,
                  transform: shown.z > 1 ? `scale(${shown.z})` : undefined,
                }}
                className={
                  kind === 'video'
                    ? 'w-full h-full object-cover opacity-65 select-none pointer-events-none'
                    : (cropped ? 'w-full h-full object-cover' : 'w-full h-auto max-h-[640px] object-contain') + ' select-none pointer-events-none'
                }
              />
            )}
            {kind === 'video' && (
              <div className="absolute flex flex-col items-center justify-center text-white">
                <div className="w-12 h-12 rounded-full bg-slate-900/90 border border-slate-700 flex items-center justify-center shadow-lg mb-2">
                  <Video className="w-6 h-6 text-white ml-0.5" />
                </div>
                <span className="text-xs font-semibold">보도 영상 클립</span>
              </div>
            )}
            {adjusting && (
              <div
                className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/75 text-white text-xs px-3 py-1.5 rounded-full"
                onPointerDown={e => e.stopPropagation()}
              >
                <span className="hidden sm:inline">끌어서 위치 맞추기</span>
                <label className="flex items-center gap-1.5">
                  <span>확대</span>
                  <input
                    type="range"
                    min={1}
                    max={CROP_MAX_ZOOM}
                    step={0.05}
                    value={shown.z}
                    onChange={e => changeZoom(Number(e.target.value))}
                    onPointerUp={commitCrop}
                    onKeyUp={commitCrop}
                    className="w-24 accent-blue-500"
                  />
                  <span className="w-9 tabular-nums">{Math.round(shown.z * 100)}%</span>
                </label>
                <button type="button" onClick={resetCrop} className="underline text-slate-200 hover:text-white">가운데로</button>
                <button type="button" onClick={removeCrop} className="underline text-slate-200 hover:text-white">자르기 해제</button>
                <button type="button" onClick={() => { commitCrop(); setAdjusting(false); }} className="bg-blue-600 hover:bg-blue-500 rounded-full px-2 py-0.5 font-semibold">완료</button>
              </div>
            )}
            {editable && !adjusting && (
              <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center bg-black/60 p-1 rounded-lg">
                {kind === 'image' && (
                  <button
                    type="button"
                    onClick={startAdjust}
                    className="flex items-center gap-1 px-1.5 py-1 text-xs text-slate-100 hover:bg-white/20 rounded transition-colors mr-0.5"
                    title="사진 확대·자르기 (보이는 부분 맞추기)"
                  >
                    <Move className="w-3.5 h-3.5" />
                    <span>자르기·확대</span>
                  </button>
                )}
                {kind === 'image' && (
                  <button
                    type="button"
                    onClick={() => setBlurOpen(true)}
                    className="flex items-center gap-1 px-1.5 py-1 text-xs text-slate-100 hover:bg-white/20 rounded transition-colors mr-0.5"
                    title="얼굴·차량 번호 등 사진 일부를 가리기"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>일부 가리기</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => deleteNode()}
                  className="p-1.5 text-rose-300 hover:text-rose-100 hover:bg-rose-500/30 rounded transition-colors"
                  title={kind === 'video' ? '영상 삭제' : '사진 삭제'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          <div className="mt-2 px-1 flex flex-col md:flex-row md:items-center justify-between text-xs text-slate-500 gap-2">
            <div className="flex-1 flex items-center space-x-1.5">
              <span className="font-bold text-slate-400 shrink-0">{kind === 'video' ? '▲ [영상]' : '▲'}</span>
              <input
                type="text"
                readOnly={!editable}
                value={a.caption || ''}
                onChange={e => updateAttributes({ caption: e.target.value })}
                placeholder={kind === 'video' ? '영상 설명' : '사진 설명을 입력하세요'}
                className="w-full bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-400 focus:outline-none text-slate-700 py-0.5"
              />
            </div>
            <div className="flex items-center space-x-1 text-[11px] text-slate-400 shrink-0">
              <span>출처:</span>
              <input
                type="text"
                readOnly={!editable}
                value={a.credit || ''}
                onChange={e => updateAttributes({ credit: e.target.value })}
                placeholder="뉴스룸 DB"
                className="w-32 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-400 focus:outline-none text-slate-600 py-0.5 text-right"
              />
            </div>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
};

// ------------------------------------------------------------
// 편집기 확장 부품
// ------------------------------------------------------------
const MediaBlockNode = Node.create({
  name: MEDIA_NODE_NAME,
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    const keys = [
      'blockId', 'blockType', 'mediaUrl', 'runtimeMediaUrl', 'caption',
      'credit', 'text', 'focus', 'mediaType', 'fileFormat', 'fileSize',
    ];
    const attrs: Record<string, { default: unknown }> = {};
    keys.forEach(k => { attrs[k] = { default: null }; });
    return attrs;
  },

  parseHTML() {
    return [{ tag: 'div[data-media-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-media-block': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MediaNodeView);
  },
});

// ------------------------------------------------------------
// 피드백 형광펜 + AI 검수 노란색 표시 (글자 위에 배경색만 입히며 저장 내용에는 영향 없음)
// ------------------------------------------------------------
interface AnnotationData {
  feedbacks: ArticleFeedback[];
  activeFeedbackId: string | null;
  aiBlockId: string | null;
  aiText: string | null;
}

const annotationKey = new PluginKey('bodyAnnotations');
const EMPTY_ANNOTATIONS: AnnotationData = { feedbacks: [], activeFeedbackId: null, aiBlockId: null, aiText: null };

/** 문단 노드의 글 (줄바꿈은 '\n') */
function paragraphPlainText(node: { forEach: (cb: (child: any) => void) => void }): string {
  let out = '';
  node.forEach(child => {
    if (child.type.name === 'hardBreak') out += '\n';
    else if (child.isText) out += child.text ?? '';
  });
  return out;
}

const AnnotationHighlights = Extension.create({
  name: 'annotationHighlights',
  addStorage() {
    return { data: EMPTY_ANNOTATIONS as AnnotationData };
  },
  addProseMirrorPlugins() {
    const storage = this.storage as { data: AnnotationData };
    return [
      new Plugin({
        key: annotationKey,
        props: {
          decorations(state) {
            const { feedbacks, activeFeedbackId, aiBlockId, aiText } = storage.data;
            const decos: Decoration[] = [];
            state.doc.forEach((node, offset) => {
              if (node.type.name !== 'paragraph') return;
              const blockId: string | null = node.attrs.blockId || null;
              // 다른 화면(피드백 목록 등)에서 이 문단으로 스크롤할 수 있도록 표식을 달아 둔다
              if (blockId) {
                decos.push(Decoration.node(offset, offset + node.nodeSize, {
                  id: `article-block-${blockId}`,
                  'data-block-id': blockId,
                }));
              }
              const wantsAi = !!(aiText && aiBlockId && blockId === aiBlockId);
              if (feedbacks.length === 0 && !wantsAi) return;
              const text = paragraphPlainText(node);
              if (!text) return;

              const length = text.length;
              const isAi = new Uint8Array(length);
              if (wantsAi) {
                let pos = text.indexOf(aiText as string);
                while (pos !== -1) {
                  for (let i = pos; i < pos + (aiText as string).length && i < length; i++) isAi[i] = 1;
                  pos = text.indexOf(aiText as string, pos + 1);
                }
              }
              const matchAt = new Array<ReturnType<typeof findFeedbackAnchors>[number] | null>(length).fill(null);
              for (const m of findFeedbackAnchors(text, feedbacks)) {
                for (let i = m.startIndex; i < m.endIndex && i < length; i++) matchAt[i] = m;
              }

              const base = offset + 1; // 문단 안 첫 글자 위치
              let chunkStart = 0;
              for (let i = 0; i <= length; i++) {
                const boundary =
                  i === length ||
                  isAi[i] !== isAi[chunkStart] ||
                  matchAt[i]?.feedbackId !== matchAt[chunkStart]?.feedbackId;
                if (!boundary) continue;
                const hasAi = isAi[chunkStart] === 1;
                const fb = matchAt[chunkStart];
                if (fb) {
                  const color = (fb.color || 'emerald') as HighlighterColor;
                  const style = HIGHLIGHTER_STYLES[color] || HIGHLIGHTER_STYLES.emerald;
                  decos.push(Decoration.inline(base + chunkStart, base + i, {
                    id: `feedback-anchor-${fb.feedbackId}`,
                    class: `rounded-xs transition-all ${activeFeedbackId === fb.feedbackId ? style.focused : style.normal} ${hasAi ? 'outline-1 outline-amber-500' : ''}`,
                    title: `데스크/기자 피드백: ${fb.selectedText}`,
                  }));
                } else if (hasAi) {
                  decos.push(Decoration.inline(base + chunkStart, base + i, {
                    class: 'bg-amber-300 rounded-xs shadow-xs',
                    title: 'AI 검수 대상',
                  }));
                }
                chunkStart = i;
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

/** 문단이 DB 블록 ID를 기억하도록 하는 보조 속성 (화면에는 나타나지 않음) */
const ParagraphBlockId = Extension.create({
  name: 'paragraphBlockId',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          blockId: { default: null, rendered: false },
        },
      },
    ];
  },
});

// ------------------------------------------------------------
// 본문 편집기 본체
// ------------------------------------------------------------
export const BodyEditor: React.FC<BodyEditorProps> = ({
  articleId,
  blocks,
  readOnly = false,
  onSave,
  onSaveStateChange,
  feedbacks,
  highlightedFeedbackId = null,
  aiHighlightBlockId = null,
  aiHighlightText = null,
  onTextSelected,
  onSelectionCollapsed,
  registerControls,
}) => {
  const initialContent = useMemo<JSONContent>(() => blocksToDoc(blocks), []); // eslint-disable-line react-hooks/exhaustive-deps

  // 저장 관련 최신 값들을 ref에 보관 (콜백이 낡은 값을 쓰지 않도록)
  const onSaveRef = useRef(onSave);
  const onStateRef = useRef(onSaveStateChange);
  const onTextSelectedRef = useRef(onTextSelected);
  const onCollapsedRef = useRef(onSelectionCollapsed);
  const readOnlyRef = useRef(readOnly);
  onTextSelectedRef.current = onTextSelected;
  onCollapsedRef.current = onSelectionCollapsed;
  readOnlyRef.current = readOnly;
  const articleIdRef = useRef(articleId);
  onSaveRef.current = onSave;
  onStateRef.current = onSaveStateChange;
  articleIdRef.current = articleId;

  const latestDraftsRef = useRef<BodyBlockDraft[] | null>(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const applyingIdsRef = useRef(false);
  // 사진/영상을 끌고 있는 중인지 (끄는 도중에 문서를 건드리면 놓을 때 원본이 안 지워지는 문제가 생김)
  const draggingMediaRef = useRef(false);
  // 마지막으로 글을 쓰던 칸 번호 (라이브러리에서 [기사에 삽입] 할 때 그 다음 자리에 넣기 위함)
  const lastCursorBlockRef = useRef<number | null>(null);
  const insertMediaRef = useRef<BodyEditorControls['insertMedia']>(() => false);
  const mountedRef = useRef(true);
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);

  /** 저장이 끝나 새로 받은 DB 블록 ID를 문서의 각 덩어리에 적어 둔다 (되돌리기 기록에는 남기지 않음) */
  const applyIds = useCallback((drafts: BodyBlockDraft[], ids: string[]) => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    // 사진을 끄는 도중에는 문서를 건드리지 않는다 (다음 저장 때 번호가 정리된다)
    if (draggingMediaRef.current) return;
    const doc = ed.state.doc;
    // 저장하는 사이 문서가 달라졌으면(칸 수/종류/내용이 다름) 건드리지 않는다. 다음 저장에서 바로잡힌다.
    const now = docToBlocks(ed.getJSON());
    if (doc.childCount !== ids.length || now.length !== drafts.length) return;
    let ok = true;
    for (let i = 0; i < now.length; i++) {
      const a = now[i];
      const b = drafts[i];
      if (a.type !== b.type || (a.text ?? '') !== (b.text ?? '') || (a.caption ?? '') !== (b.caption ?? '') || (a.credit ?? '') !== (b.credit ?? '')) {
        ok = false;
        break;
      }
    }
    if (!ok) return;

    let tr = ed.state.tr;
    let changed = false;
    doc.forEach((node, offset, index) => {
      if (node.attrs.blockId !== ids[index]) {
        tr = tr.setNodeMarkup(offset, undefined, { ...node.attrs, blockId: ids[index] });
        changed = true;
      }
    });
    if (changed) {
      tr.setMeta('addToHistory', false);
      applyingIdsRef.current = true;
      try {
        ed.view.dispatch(tr);
      } finally {
        applyingIdsRef.current = false;
      }
    }
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // 이미 진행 중인 저장이 있으면 끝날 때까지 기다린다
    while (inFlightRef.current) {
      try { await inFlightRef.current; } catch { /* 아래에서 다시 시도 */ }
    }
    const save = onSaveRef.current;
    const drafts = latestDraftsRef.current;
    if (!dirtyRef.current || !save || !drafts) return;

    dirtyRef.current = false;
    onStateRef.current?.('saving');
    const job = (async () => {
      try {
        const ids = await save(drafts, articleIdRef.current);
        applyIds(drafts, ids);
        if (!dirtyRef.current) onStateRef.current?.('saved');
      } catch (err) {
        dirtyRef.current = true;
        onStateRef.current?.('error');
        // 다른 사람이 동시에 고친 경우(noRetry)에는 자동 재시도를 멈춘다 (계속 시도해도 같은 오류가 나기 때문)
        if (mountedRef.current && !(err as any)?.noRetry) {
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => { flush().catch(() => {}); }, SAVE_RETRY_MS);
        }
        throw err;
      }
    })();
    inFlightRef.current = job;
    try {
      await job;
    } finally {
      inFlightRef.current = null;
    }
    // 저장하는 동안 또 수정이 있었다면 이어서 저장
    if (dirtyRef.current && !timerRef.current) {
      timerRef.current = setTimeout(() => { flush().catch(() => {}); }, SAVE_DEBOUNCE_MS);
    }
  }, [applyIds]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  const editor = useEditor({
    extensions: [
      // 글자 서식(굵게 등)은 DB에 저장할 곳이 없으므로 모두 끄고, 문단/줄바꿈/되돌리기만 사용
      StarterKit.configure({
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        codeBlock: false,
        code: false,
        bold: false,
        italic: false,
        strike: false,
        underline: false,
        link: false,
        horizontalRule: false,
        // 사진을 끌 때 "여기에 놓입니다" 위치를 파란 선으로 보여준다
        dropcursor: { color: '#2563eb', width: 4, class: 'body-drop-cursor' },
      }),
      ParagraphBlockId,
      AnnotationHighlights,
      MediaBlockNode,
      Placeholder.configure({
        placeholder: readOnly ? '(본문 내용 없음)' : '기사 본문을 입력하세요...',
      }),
    ],
    content: initialContent,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: 'outline-none text-[17px] leading-[1.85] tracking-normal font-sans text-slate-900 px-2 py-1 min-h-[300px]',
      },
      // 글을 마우스로 드래그해 선택하면 [피드백 작성] 버튼을 띄우기 위해 선택 정보를 알려 준다
      handleDOMEvents: {
        mouseup: (view, event) => {
          const ev = event as MouseEvent;
          // 선택 영역이 갱신된 뒤에 읽기 위해 한 박자 늦춘다
          window.setTimeout(() => {
            let fromPos: number;
            let toPos: number;
            if (readOnlyRef.current) {
              // 읽기 전용(검토 모드)에서는 편집기 자체 선택이 갱신되지 않으므로 브라우저의 선택 영역을 직접 읽는다
              const domSel = window.getSelection();
              if (!domSel || domSel.rangeCount === 0 || domSel.isCollapsed) {
                onCollapsedRef.current?.();
                return;
              }
              const range = domSel.getRangeAt(0);
              if (!view.dom.contains(range.startContainer) || !view.dom.contains(range.endContainer)) return;
              try {
                fromPos = view.posAtDOM(range.startContainer, range.startOffset);
                toPos = view.posAtDOM(range.endContainer, range.endOffset);
              } catch {
                return;
              }
            } else {
              const sel = view.state.selection;
              if (sel.empty || !(sel instanceof TextSelection)) {
                onCollapsedRef.current?.();
                return;
              }
              fromPos = sel.from;
              toPos = sel.to;
            }
            if (fromPos === toPos) {
              onCollapsedRef.current?.();
              return;
            }
            const $from = view.state.doc.resolve(Math.min(fromPos, toPos));
            const $to = view.state.doc.resolve(Math.max(fromPos, toPos));
            // 한 문단 안에서 고른 글만 피드백을 달 수 있다 (여러 문단에 걸친 선택은 제외)
            if (!$from.sameParent($to) || $from.parent.type.name !== 'paragraph') return;
            const paraText = paragraphPlainText($from.parent);
            const startOffset = $from.parentOffset;
            const endOffset = $to.parentOffset;
            const selected = paraText.slice(startOffset, endOffset).trim();
            if (!selected) return;
            onTextSelectedRef.current?.({
              blockId: ($from.parent.attrs.blockId as string | null) || undefined,
              selectedText: selected,
              startOffset,
              endOffset,
              contextBefore: paraText.slice(Math.max(0, startOffset - 30), startOffset),
              contextAfter: paraText.slice(endOffset, Math.min(paraText.length, endOffset + 30)),
              clientX: ev.clientX,
              clientY: ev.clientY,
            });
          }, 0);
          return false;
        },
      },
      // 미디어 라이브러리 카드를 끌어다 놓았을 때: 놓은 자리에 사진/영상 넣기
      handleDrop: (view, event) => {
        const dt = (event as DragEvent).dataTransfer;
        const raw = dt?.getData('application/x-press-cms-media');
        if (!raw) return false;
        let payload: any;
        try { payload = JSON.parse(raw); } catch { return false; }
        if (!payload || payload.type !== 'media-library-item' || !payload.id) return false;

        const me = event as DragEvent;
        const hit = view.posAtCoords({ left: me.clientX, top: me.clientY });
        const doc = view.state.doc;
        let index = doc.childCount;
        if (hit) {
          const $p = doc.resolve(hit.pos);
          if ($p.depth === 0) {
            index = $p.index();
          } else {
            index = $p.index(0);
            const dom = view.nodeDOM($p.before(1)) as HTMLElement | null;
            if (dom) {
              const r = dom.getBoundingClientRect();
              if (me.clientY > r.top + r.height / 2) index += 1;
            }
          }
        }
        const item = { ...payload, type: payload.mediaType === 'video' ? 'video' : 'image' };
        me.preventDefault();
        insertMediaRef.current([mediaItemToBodyAttrs(item)], index);
        return true;
      },
    },
    onSelectionUpdate: ({ editor: ed }) => {
      if (ed.isFocused) lastCursorBlockRef.current = ed.state.selection.$from.index(0);
      if (ed.state.selection.empty && ed.isFocused) onCollapsedRef.current?.();
    },
    onUpdate: ({ editor: ed, transaction }) => {
      // 내용이 실제로 바뀐 경우만 저장 대상으로 본다 (편집 가능 여부 전환 같은 신호는 무시)
      if (!transaction.docChanged) return;
      latestDraftsRef.current = docToBlocks(ed.getJSON());
      if (applyingIdsRef.current || readOnly || !onSaveRef.current) return;
      dirtyRef.current = true;
      onStateRef.current?.('saving');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { flushRef.current().catch(() => {}); }, SAVE_DEBOUNCE_MS);
    },
  });
  editorRef.current = editor;

  useEffect(() => {
    editor?.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  // 형광펜/AI 표시 정보가 바뀌면 편집기에 알려 다시 그리게 한다
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    (editor.storage as any).annotationHighlights.data = {
      feedbacks: feedbacks ?? [],
      activeFeedbackId: highlightedFeedbackId,
      aiBlockId: aiHighlightBlockId,
      aiText: aiHighlightText,
    } as AnnotationData;
    editor.view.dispatch(editor.state.tr.setMeta('bodyAnnotationsChanged', true));
  }, [editor, feedbacks, highlightedFeedbackId, aiHighlightBlockId, aiHighlightText]);

  /** 사진/영상 덩어리를 문서에 끼워 넣는다 */
  const insertMedia = useCallback<BodyEditorControls['insertMedia']>((items, where) => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed || !ed.isEditable || items.length === 0) return false;
    const doc = ed.state.doc;
    const count = doc.childCount;
    const lastIsEmptyPara = count > 0 && doc.child(count - 1).type.name === 'paragraph' && doc.child(count - 1).content.size === 0;

    let index: number;
    if (where === 'cursor') {
      const c = lastCursorBlockRef.current;
      index = c !== null && c < count ? c + 1 : (lastIsEmptyPara ? count - 1 : count);
    } else if (where === 'end' || where >= count) {
      index = lastIsEmptyPara ? count - 1 : count;
    } else {
      index = Math.max(0, where);
    }

    let pos = 0;
    for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
    const nodes = items.map(a => ed.schema.nodeFromJSON({ type: MEDIA_NODE_NAME, attrs: { blockId: null, text: '', ...a } }));
    const tr = ed.state.tr.insert(pos, nodes).scrollIntoView();
    ed.view.dispatch(tr);
    lastCursorBlockRef.current = index + nodes.length - 1;
    return true;
  }, []);
  insertMediaRef.current = insertMedia;

  /** TXT 문단들을 문서에 넣는다 */
  const importParagraphs = useCallback<BodyEditorControls['importParagraphs']>((paragraphs, mode) => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed || !ed.isEditable) return false;
    const cleaned = paragraphs.map(t => t.replace(/\r/g, ''));
    if (cleaned.length === 0) return false;
    const paraNodes = cleaned.map(t => ed.schema.nodeFromJSON(paragraphJson(t)));
    const doc = ed.state.doc;

    let tr = ed.state.tr;
    if (mode === 'replace') {
      tr = tr.replaceWith(0, doc.content.size, paraNodes);
    } else {
      const count = doc.childCount;
      const lastIsEmptyPara = count > 0 && doc.child(count - 1).type.name === 'paragraph' && doc.child(count - 1).content.size === 0;
      let pos = doc.content.size;
      // 마지막이 빈 문단이면 그 문단을 첫 번째 가져온 문단으로 대신한다
      if (lastIsEmptyPara) pos -= doc.child(count - 1).nodeSize;
      tr = tr.insert(pos, paraNodes);
    }
    ed.view.dispatch(tr.scrollIntoView());
    lastCursorBlockRef.current = null;
    return true;
  }, []);

  // 바깥에서 "지금 저장 / 변경 버리기 / 사진 넣기 / TXT 넣기" 를 할 수 있도록 등록
  useEffect(() => {
    if (!registerControls) return;
    registerControls({
      insertMedia,
      importParagraphs,
      flush,
      discard: () => {
        dirtyRef.current = false;
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      },
    });
    return () => registerControls(null);
  }, [registerControls, flush, insertMedia, importParagraphs]);

  // 화면을 떠날 때(기사 전환, 편집기 전환) 남은 변경을 즉시 저장
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (dirtyRef.current) {
        flushRef.current().catch(() => {});
      }
    };
  }, []);

  // 저장 안 된 변경이 있는데 탭을 닫으려 하면 경고
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || inFlightRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // 사진/영상을 끄는 동안 "놓을 수 있는 자리"를 점선으로 보여준다
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isDraggingMedia, setIsDraggingMedia] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || readOnly) return;
    let timer: number | null = null;

    // ---- 끄는 동안 화면 가장자리에 가까워지면 자동으로 스크롤 (긴 기사에서 멀리 옮길 수 있도록) ----
    let pointerY = 0;
    let raf: number | null = null;
    const EDGE = 110;      // 가장자리에서 이 거리(px) 안이면 스크롤 시작
    const MAX_SPEED = 28;  // 한 프레임당 최대 스크롤 거리(px)

    const findScroller = (start: HTMLElement): HTMLElement | null => {
      let n: HTMLElement | null = start.parentElement;
      while (n) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
        n = n.parentElement;
      }
      return null;
    };

    const onDocDragOver = (e: DragEvent) => {
      pointerY = e.clientY;
    };

    const tick = () => {
      raf = window.requestAnimationFrame(tick);
      const sc = findScroller(el);
      const rect = sc ? sc.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const top = Math.max(rect.top, 0);
      const bottom = Math.min(rect.bottom, window.innerHeight);
      let delta = 0;
      if (pointerY < top + EDGE) {
        delta = -MAX_SPEED * Math.min(1, (top + EDGE - pointerY) / EDGE);
      } else if (pointerY > bottom - EDGE) {
        delta = MAX_SPEED * Math.min(1, (pointerY - (bottom - EDGE)) / EDGE);
      }
      if (delta !== 0) {
        if (sc) sc.scrollTop += delta;
        else window.scrollBy(0, delta);
      }
    };

    const stop = () => {
      draggingMediaRef.current = false;
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (raf !== null) {
        window.cancelAnimationFrame(raf);
        raf = null;
      }
      setIsDraggingMedia(false);
      document.removeEventListener('dragover', onDocDragOver, true);
      document.removeEventListener('dragend', stop, true);
      document.removeEventListener('drop', stop, true);
    };

    // 미디어 라이브러리 카드를 끌어 편집기 위로 들어올 때도 같은 점선/자동 스크롤을 보여준다
    const onLibraryDragEnter = (e: DragEvent) => {
      if (draggingMediaRef.current) return;
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('application/x-press-cms-media')) return;
      pointerY = e.clientY;
      draggingMediaRef.current = true;
      setIsDraggingMedia(true);
      if (raf === null) raf = window.requestAnimationFrame(tick);
      document.addEventListener('dragover', onDocDragOver, true);
      document.addEventListener('dragend', stop, true);
      document.addEventListener('drop', stop, true);
    };

    const onDragStart = (e: DragEvent) => {
      const t = e.target as HTMLElement | null;
      // 사진/영상 덩어리를 끌 때만 (글자 선택 끌기는 제외)
      if (!t || !t.closest || !t.closest('.node-mediaBlock, [data-block-id], [data-media-block]')) return;
      // 끌기 시작과 같은 순간에 화면을 바꾸면 브라우저가 끌기를 취소할 수 있어 한 박자 늦춘다
      pointerY = e.clientY;
      draggingMediaRef.current = true;
      timer = window.setTimeout(() => {
        timer = null;
        setIsDraggingMedia(true);
        if (raf === null) raf = window.requestAnimationFrame(tick);
      }, 0);
      document.addEventListener('dragover', onDocDragOver, true);
      document.addEventListener('dragend', stop, true);
      document.addEventListener('drop', stop, true);
    };

    el.addEventListener('dragstart', onDragStart);
    el.addEventListener('dragenter', onLibraryDragEnter);
    return () => {
      el.removeEventListener('dragstart', onDragStart);
      el.removeEventListener('dragenter', onLibraryDragEnter);
      stop();
    };
  }, [readOnly]);

  return (
    <div ref={containerRef} className={`body-editor${isDraggingMedia ? ' is-dragging-media' : ''}`}>
      {isDraggingMedia && (
        <div className="sticky top-2 z-40 h-0 pointer-events-none" aria-hidden="true">
          <div className="absolute right-2 -top-1 px-3 py-1 rounded-full bg-blue-600 text-white text-[11px] font-bold shadow-lg whitespace-nowrap">
            점선 자리에 놓을 수 있어요
          </div>
        </div>
      )}
      {aiHighlightText && aiHighlightBlockId && (
        <div className="sticky top-2 z-40 h-0 pointer-events-none" aria-hidden="true">
          <div className="absolute right-2 -top-1 max-w-[60%] px-2 py-1 bg-amber-50 border border-amber-300 rounded text-xs flex items-center space-x-2 text-amber-900 shadow-md">
            <span className="px-1.5 py-0.5 rounded bg-amber-300 text-slate-900 font-bold text-[10px] shrink-0">AI 검수 대상</span>
            <span className="font-semibold underline decoration-amber-500 decoration-2 truncate">"{aiHighlightText}"</span>
          </div>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
};

export default BodyEditor;
