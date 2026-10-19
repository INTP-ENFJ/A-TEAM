import React, { useState } from 'react';
import { 
  X, 
  Image as ImageIcon, 
  Video, 
  Search, 
  Layers 
} from 'lucide-react';
import { MediaItem } from '../../types';

interface MediaPickerModalProps {
  isOpen: boolean;
  type: 'image' | 'video';
  targetIndex: number;
  mediaItems: MediaItem[];
  onClose: () => void;
  onSelectMedia: (item: MediaItem, targetIndex: number) => void;
  onOpenFullLibrary: () => void;
}

export const MediaPickerModal: React.FC<MediaPickerModalProps> = ({
  isOpen,
  type,
  targetIndex,
  mediaItems,
  onClose,
  onSelectMedia,
  onOpenFullLibrary,
}) => {
  const [search, setSearch] = useState('');

  if (!isOpen) return null;

  const filtered = mediaItems.filter(item => {
    if (item.type !== type) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        (item.originalFilename || '').toLowerCase().includes(q) ||
        (item.caption || '').toLowerCase().includes(q) ||
        item.aiTags.some(t => t.toLowerCase().includes(q)) ||
        item.credit.toLowerCase().includes(q) ||
        (item.uploaderName || '').toLowerCase().includes(q) ||
        (item.uploaderEmail || '').toLowerCase().includes(q) ||
        (item.uploaderDepartment || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 select-none animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center space-x-2 font-bold text-sm">
            {type === 'image' ? (
              <ImageIcon className="w-4 h-4 text-blue-400" />
            ) : (
              <Video className="w-4 h-4 text-slate-300" />
            )}
            <span>
              {type === 'image' ? '보도사진 선택 및 삽입' : '보도 영상 클립 선택 및 삽입'}
            </span>
            <span className="text-xs font-normal text-slate-400">
              (블록 #{targetIndex + 1} 위치)
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search & Actions Bar */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="미디어 제목, 태그(#국회, #인물) 검색..."
              className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-900 text-xs text-slate-900 placeholder:text-slate-400"
            />
          </div>

          <button
            onClick={() => {
              onClose();
              onOpenFullLibrary();
            }}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 rounded-md text-slate-700 font-medium transition-colors shadow-xs"
          >
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            <span>하단 라이브러리에서 드래그하기</span>
          </button>
        </div>

        {/* Media Grid */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {filtered.map((item) => (
            <div
              key={item.id}
              onClick={() => {
                onSelectMedia(item, targetIndex);
                onClose();
              }}
              className="group border border-slate-200 hover:border-slate-400 rounded-lg overflow-hidden cursor-pointer transition-all bg-white flex flex-col justify-between shadow-xs hover:shadow-sm"
            >
              <div className="relative h-28 bg-slate-900 overflow-hidden">
                <img
                  src={item.url}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute top-1.5 left-1.5 bg-black/70 text-white text-[12px] font-bold px-1.5 py-0.5 rounded">
                  {item.format}
                </div>
                {item.type === 'video' && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-8 h-8 rounded-full bg-slate-900/90 border border-slate-600 text-white flex items-center justify-center shadow-md">
                      <Video className="w-4 h-4" />
                    </div>
                  </div>
                )}
              </div>

              <div className="p-2.5 space-y-1">
                <p className="text-xs font-semibold text-slate-800 line-clamp-2 leading-snug group-hover:text-blue-600">
                  {item.title}
                </p>
                <p className="text-[12px] text-slate-400 truncate">
                  출처: {item.credit}
                </p>
              </div>

              <div className="px-2.5 py-1.5 bg-slate-50 border-t border-slate-100 text-center">
                <span className="text-[12px] font-bold text-slate-700 group-hover:text-blue-600 group-hover:underline">
                  + 이 위치에 삽입
                </span>
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="col-span-full py-12 text-center text-slate-500 text-xs space-y-2">
              <ImageIcon className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="font-semibold text-slate-700">검색 조건에 일치하는 미디어가 없습니다</p>
              <p className="text-[12px] text-slate-400">다른 검색어를 입력하거나 미디어 라이브러리에서 새 파일을 업로드하세요.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-xs font-semibold transition-colors shadow-xs"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
