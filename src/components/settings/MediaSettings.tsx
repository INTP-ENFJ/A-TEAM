import React, { useState } from 'react';
import { 
  Image as ImageIcon, 
  UploadCloud, 
  Save, 
  Check, 
  Sparkles
} from 'lucide-react';

export const MediaSettings: React.FC = () => {
  const [maxImageSize, setMaxImageSize] = useState('20MB');
  const [maxVideoSize, setMaxVideoSize] = useState('500MB');
  const [autoConvertWebp, setAutoConvertWebp] = useState(true);
  const [autoStripExif, setAutoStripExif] = useState(true);
  const [autoVisionTagging, setAutoVisionTagging] = useState(true);
  const [isSaved, setIsSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <ImageIcon className="w-5 h-5 text-blue-600" />
            <span>미디어 라이브러리 및 에셋 설정 (Media Settings)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            사진·영상 업로드 규격, WebP 압축 최적화, EXIF 개인정보 보호 및 AI 자동 비전 태깅을 관리합니다.
          </p>
        </div>

        {isSaved && (
          <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded text-xs font-bold animate-fade-in shadow-xs">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>설정이 저장되었습니다!</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-6 text-xs text-slate-700">
        {/* Upload Limits & Formats */}
        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center space-x-2 text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            <UploadCloud className="w-4 h-4 text-blue-600" />
            <h3>1. 파일 업로드 허용 규격 및 용량</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                이미지 최대 업로드 용량
              </label>
              <select
                value={maxImageSize}
                onChange={(e) => setMaxImageSize(e.target.value)}
                className="w-full p-2 border border-slate-300 rounded bg-white text-xs text-slate-800 focus:ring-1 focus:ring-blue-500"
              >
                <option value="10MB">10 MB (표준 웹)</option>
                <option value="20MB">20 MB (고해상도 보도사진 권장)</option>
                <option value="50MB">50 MB (RAW / 대형 사진)</option>
              </select>
              <span className="text-[10px] text-slate-400 mt-1 block">지원 포맷: JPG, JPEG, PNG, WEBP</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                영상 최대 업로드 용량
              </label>
              <select
                value={maxVideoSize}
                onChange={(e) => setMaxVideoSize(e.target.value)}
                className="w-full p-2 border border-slate-300 rounded bg-white text-xs text-slate-800 focus:ring-1 focus:ring-blue-500"
              >
                <option value="200MB">200 MB (단신 영상)</option>
                <option value="500MB">500 MB (권장 현장 취재 영상)</option>
                <option value="1GB">1 GB (심층 다큐/고화질)</option>
              </select>
              <span className="text-[10px] text-slate-400 mt-1 block">지원 포맷: MP4, MOV, WEBM</span>
            </div>
          </div>
        </div>

        {/* AI & Optimization */}
        <div className="bg-white p-5 rounded-md border border-slate-200 shadow-2xs space-y-4">
          <div className="flex items-center space-x-2 text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            <Sparkles className="w-4 h-4 text-slate-600" />
            <h3>2. 이미지 자동 최적화 및 AI 비전 분석</h3>
          </div>

          <div className="space-y-3">
            <label className="flex items-start space-x-2.5 cursor-pointer p-2 rounded-md hover:bg-slate-50 transition-colors">
              <input
                type="checkbox"
                checked={autoConvertWebp}
                onChange={(e) => setAutoConvertWebp(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <div>
                <span className="font-semibold text-slate-800">포털 및 웹 출고 시 차세대 WebP 자동 변환</span>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  원본 화질을 유지하면서 파일 용량을 평균 65% 절감하여 모바일 독자 페이지 로딩 속도를 향상시킵니다.
                </p>
              </div>
            </label>

            <label className="flex items-start space-x-2.5 cursor-pointer p-2 rounded-md hover:bg-slate-50 transition-colors">
              <input
                type="checkbox"
                checked={autoStripExif}
                onChange={(e) => setAutoStripExif(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <div>
                <span className="font-semibold text-slate-800">촬영자 GPS 위치 등 민감 EXIF 정보 자동 제거</span>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  취재원 보호 및 기자 개인정보 보호를 위해 사진 파일 내 임베드된 위치 메타데이터를 출고 전 자동 필터링합니다.
                </p>
              </div>
            </label>

            <label className="flex items-start space-x-2.5 cursor-pointer p-2 rounded-md hover:bg-slate-50 transition-colors">
              <input
                type="checkbox"
                checked={autoVisionTagging}
                onChange={(e) => setAutoVisionTagging(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <div>
                <span className="font-semibold text-slate-800">AI 비전 자동 태깅 및 캡션 초안 생성</span>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  사진 업로드 시 피사체(인물, 장소, 사건)를 식별하여 #국회 #본회의 등 메타데이터 태그와 캡션 예시를 자동 제안합니다.
                </p>
              </div>
            </label>
          </div>
        </div>


        <div className="flex items-center justify-end space-x-3 pt-1">
          <button
            type="submit"
            id="btn-save-media-settings"
            className="px-6 py-2 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white rounded-md font-bold text-xs shadow-2xs flex items-center space-x-2 transition-colors cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>설정 저장</span>
          </button>
        </div>
      </form>
    </div>
  );
};
