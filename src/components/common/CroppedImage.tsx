import React from 'react';
import { parseCrop } from './mediaCrop';

interface CroppedImageProps {
  src?: string;
  alt?: string;
  /** 사진 블록의 text 칸 값 (`focus:가로,세로,확대`). 없으면 자르지 않고 원본 전체를 보여준다 */
  focusText?: string | null;
  className?: string;
}

/** 편집기에서 정한 대로 사진을 16:9로 자르고 확대해서 보여주는 읽기용 이미지 */
export const CroppedImage: React.FC<CroppedImageProps> = ({ src, alt, focusText, className }) => {
  const crop = parseCrop(focusText);
  if (!crop) {
    return <img src={src} alt={alt} className={className} />;
  }
  return (
    <div className={`aspect-video overflow-hidden ${className ?? ''}`}>
      <img
        src={src}
        alt={alt}
        className="w-full h-full object-cover"
        style={{
          objectPosition: `${crop.x}% ${crop.y}%`,
          transformOrigin: `${crop.x}% ${crop.y}%`,
          transform: crop.z > 1 ? `scale(${crop.z})` : undefined,
        }}
      />
    </div>
  );
};
