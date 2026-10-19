import React, { useState } from 'react';
import { CroppedImage } from '../common/CroppedImage';
import { 
  ArrowLeft, 
  Send, 
  Share2, 
  Bookmark, 
  Smartphone, 
  Monitor, 
  Newspaper, 
  Tag
} from 'lucide-react';
import { Article } from '../../types';

interface ArticlePreviewProps {
  article: Article;
  onBackToEditor: () => void;
  onOpenPublish: () => void;
}

export const ArticlePreview: React.FC<ArticlePreviewProps> = ({
  article,
  onBackToEditor,
  onOpenPublish,
}) => {
  const [previewMode, setPreviewMode] = useState<'portal' | 'newspaper' | 'mobile'>('portal');

  return (
    <div className="flex-1 bg-slate-100 overflow-y-auto flex flex-col select-text">
      {/* Top Preview Controls Bar */}
      <div className="h-12 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-20 shadow-xs">
        <div className="flex items-center space-x-3">
          <button
            id="btn-preview-back-to-editor"
            onClick={onBackToEditor}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>편집기로 돌아가기</span>
          </button>

          <div className="h-4 w-px bg-slate-300 mx-1" />

          <span className="text-xs font-medium text-slate-500">
            기사 출고 전 최종 독자 화면 미리보기
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {/* Layout Mode Switcher */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-md border border-slate-200 text-xs">
            <button
              onClick={() => setPreviewMode('portal')}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-semibold transition-all ${
                previewMode === 'portal' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Monitor className="w-3.5 h-3.5 text-slate-500" />
              <span>포털 웹 뷰</span>
            </button>
            <button
              onClick={() => setPreviewMode('newspaper')}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-semibold transition-all ${
                previewMode === 'newspaper' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Newspaper className="w-3.5 h-3.5 text-slate-500" />
              <span>지면 조판 뷰</span>
            </button>
            <button
              onClick={() => setPreviewMode('mobile')}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-semibold transition-all ${
                previewMode === 'mobile' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5 text-slate-500" />
              <span>모바일 웹 뷰</span>
            </button>
          </div>

          {/* Publish Trigger */}
          <button
            id="btn-preview-publish"
            onClick={onOpenPublish}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-bold shadow-xs transition-colors cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>최종 출고하기</span>
          </button>
        </div>
      </div>

      {/* Preview Content Area */}
      <div className="flex-1 flex justify-center p-6 md:p-10">
        {/* MODE 1: PORTAL WEB VIEW */}
        {previewMode === 'portal' && (
          <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-lg shadow-sm p-8 md:p-12 space-y-6">
            {/* Category & Date */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 text-xs text-slate-500">
              <div className="flex items-center space-x-2 font-bold text-blue-600">
                <span>{article.category} 뉴스</span>
                {article.exclusive && <span className="text-rose-600">[단독]</span>}
                {article.urgent && <span className="text-amber-600">[속보]</span>}
              </div>
              <div className="flex items-center space-x-2 font-mono text-[12px] text-slate-400">
                <span>출고 예정: 2026.09.21 {article.lastSaved}</span>
              </div>
            </div>

            {/* Headline */}
            <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 leading-tight tracking-tight font-sans">
              {article.title}
            </h1>

            {/* Subtitle */}
            {article.subtitle && (
              <div className="text-base md:text-lg font-medium text-slate-600 leading-relaxed border-l-3 border-blue-600 pl-3.5 bg-slate-50/50 py-1 font-sans">
                {article.subtitle.split('\n').map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            )}

            {/* Byline Bar */}
            <div className="flex items-center justify-between py-3 border-y border-slate-100 text-xs text-slate-600">
              <div className="flex items-center space-x-2 font-medium">
                <span className="font-bold text-slate-800">{article.reporter}</span>
                <span className="text-slate-400">({article.reporterEmail})</span>
                <span className="text-slate-300">|</span>
                <span className="text-slate-500">{article.desk}</span>
              </div>
              <div className="flex items-center space-x-3 text-slate-400">
                <Bookmark className="w-4 h-4 hover:text-slate-700 cursor-pointer" />
                <Share2 className="w-4 h-4 hover:text-slate-700 cursor-pointer" />
              </div>
            </div>

            {/* Article Blocks (Paragraphs, Images, Quotes) */}
            <div className="space-y-6 pt-2 font-serif text-[17px] text-slate-800 leading-[1.8] select-text">
              {article.blocks.map((block) => {
                if (block.type === 'paragraph') {
                  return (
                    <p key={block.id} className="tracking-normal">
                      {block.text}
                    </p>
                  );
                }

                if (block.type === 'image') {
                  return (
                    <figure key={block.id} className="my-6 space-y-2">
                      <CroppedImage
                        src={block.runtimeMediaUrl || block.mediaUrl}
                        alt={block.caption || '보도사진'}
                        focusText={block.text}
                        className="w-full rounded-md shadow-xs object-cover"
                      />
                      {block.caption && (
                        <figcaption className="text-xs font-sans text-slate-500 leading-relaxed pt-1">
                          {block.caption}
                        </figcaption>
                      )}
                      {block.credit && (
                        <div className="text-[12px] font-sans text-slate-400 text-right">
                          {block.credit}
                        </div>
                      )}
                    </figure>
                  );
                }

                if (block.type === 'video') {
                  return (
                    <div key={block.id} className="my-6 space-y-2">
                      <div className="relative rounded-md overflow-hidden bg-black aspect-video flex items-center justify-center">
                        <img src={block.runtimeMediaUrl || block.mediaUrl} alt="동영상" className="w-full h-full object-cover opacity-70" />
                        <div className="absolute text-white font-sans text-xs bg-black/70 px-3 py-1.5 rounded-full">
                          ▶ 보도 영상 클립 재생
                        </div>
                      </div>
                      {block.caption && (
                        <p className="text-xs font-sans text-slate-500">{block.caption}</p>
                      )}
                    </div>
                  );
                }

                if (block.type === 'quote') {
                  return (
                    <blockquote key={block.id} className="my-6 border-l-4 border-slate-400 pl-4 italic text-slate-700 font-serif text-lg bg-slate-50 py-2">
                      <p>{block.text}</p>
                      {block.caption && (
                        <footer className="text-xs font-sans text-slate-500 not-italic mt-1.5">
                          {block.caption}
                        </footer>
                      )}
                    </blockquote>
                  );
                }

                return null;
              })}
            </div>

            {/* Tags & Footer Copyright */}
            <div className="pt-8 border-t border-slate-200 space-y-4">
              <div className="flex flex-wrap gap-1.5 items-center">
                <Tag className="w-3.5 h-3.5 text-slate-400 mr-1" />
                {article.tags.map((t, idx) => (
                  <span key={idx} className="text-xs px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full font-sans cursor-pointer">
                    #{t}
                  </span>
                ))}
              </div>

              <div className="bg-slate-50 p-4 rounded text-xs text-slate-500 font-sans leading-relaxed">
                <p className="font-semibold text-slate-700">저작권자 ⓒ 뉴스룸 (Newsroom). 무단전재 및 재배포 금지</p>
                <p className="text-[12px] text-slate-400 mt-1">본 기사는 한국신문윤리위원회 윤리강령 및 보도준칙을 준수하여 작성되었습니다.</p>
              </div>
            </div>
          </div>
        )}

        {/* MODE 2: NEWSPAPER PRINT COLUMN VIEW */}
        {previewMode === 'newspaper' && (
          <div className="w-full max-w-4xl bg-stone-50 border-2 border-stone-300 rounded-none shadow-md p-10 font-serif text-stone-900 select-text">
            {/* Newspaper Masthead */}
            <div className="border-b-4 border-stone-900 pb-3 mb-6 text-center">
              <div className="flex justify-between items-center text-xs uppercase tracking-widest text-stone-600 border-b border-stone-300 pb-1 mb-2">
                <span>2026년 9월 22일 화요일 (제 18,452호)</span>
                <span className="font-bold">종합 1면 (TOP)</span>
                <span>서울 판석간</span>
              </div>
              <h2 className="text-4xl font-extrabold tracking-widest text-stone-900 font-serif">
                THE DAILY NEWSROOM
              </h2>
            </div>

            {/* Print Headline */}
            <h1 className="text-3xl font-extrabold tracking-tight leading-snug mb-3">
              {article.title}
            </h1>

            {/* Print Subtitle */}
            {article.subtitle && (
              <h3 className="text-base font-bold text-stone-700 leading-normal mb-4 border-l-2 border-stone-900 pl-3">
                {article.subtitle}
              </h3>
            )}

            <div className="text-xs text-stone-600 font-sans mb-6 pb-2 border-b border-stone-300 flex justify-between">
              <span>{article.reporter} ({article.desk})</span>
              <span>지면 배정: A1면 통단 탑기사</span>
            </div>

            {/* 3-Column Typesetting */}
            <div className="columns-1 md:columns-2 lg:columns-3 gap-6 text-[15px] leading-relaxed text-justify space-y-4">
              {article.blocks.map((b) => {
                if (b.type === 'paragraph') {
                  return <p key={b.id} className="indent-4">{b.text}</p>;
                }
                if (b.type === 'image') {
                  return (
                    <div key={b.id} className="break-inside-avoid my-4 border border-stone-300 p-1 bg-white">
                      <CroppedImage src={b.runtimeMediaUrl || b.mediaUrl} alt="지면 사진" focusText={b.text} className="w-full object-cover" />
                      <p className="text-[12px] text-stone-600 mt-1 font-sans leading-tight">
                        {b.caption}
                      </p>
                    </div>
                  );
                }
                if (b.type === 'quote') {
                  return (
                    <div key={b.id} className="break-inside-avoid border-y-2 border-stone-900 py-2 my-4 text-center italic font-bold">
                      "{b.text}"
                    </div>
                  );
                }
                return null;
              })}
            </div>
          </div>
        )}

        {/* MODE 3: MOBILE WEB VIEW */}
        {previewMode === 'mobile' && (
          <div className="w-96 bg-white border-8 border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[750px]">
            <div className="h-6 bg-slate-800 flex items-center justify-center">
              <div className="w-20 h-3 bg-slate-900 rounded-full" />
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans select-text">
              <div className="text-xs font-bold text-blue-600">{article.category}</div>
              <h1 className="text-xl font-bold text-slate-900 leading-snug">{article.title}</h1>
              <div className="text-xs text-slate-500 font-mono pb-2 border-b">
                {article.reporter} • 2026.09.21
              </div>

              <div className="space-y-4 text-sm leading-relaxed text-slate-800 font-serif">
                {article.blocks.map((b) => {
                  if (b.type === 'paragraph') return <p key={b.id}>{b.text}</p>;
                  if (b.type === 'image') {
                    return (
                      <div key={b.id} className="space-y-1 my-3">
                        <CroppedImage src={b.runtimeMediaUrl || b.mediaUrl} alt="모바일 사진" focusText={b.text} className="w-full rounded" />
                        <p className="text-[12px] text-slate-500 font-sans">{b.caption}</p>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
