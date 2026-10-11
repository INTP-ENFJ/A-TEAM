/**
 * 사진 자르기(보이는 부분 + 확대) 값.
 * DB 구조를 바꾸지 않기 위해 사진 블록의 text 칸에 `focus:가로,세로,확대` 로 적어 둔다.
 * - 가로·세로: 0~100 (%), 확대: 1~4 (배)
 * 값이 있으면 사진을 16:9 칸에 꽉 차게 맞춘 뒤 이 값만큼 확대하고 보이는 부분을 옮긴다.
 * 값이 없으면 자르지 않은 원본 전체를 보여준다.
 */
export interface CropFocus {
  x: number;
  y: number;
  z: number;
}

export const CROP_ASPECT = 16 / 9;
export const CROP_MAX_ZOOM = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** `focus:50,30,1.5` 또는 `50,30,1.5` (앞의 focus: 는 있어도 없어도 됨) → 값. 올바르지 않으면 null */
export function parseCrop(raw: string | null | undefined): CropFocus | null {
  const m = /^(?:focus:)?\s*(\d{1,3}(?:\.\d+)?),(\d{1,3}(?:\.\d+)?)(?:,(\d(?:\.\d+)?))?\s*$/.exec((raw ?? '').trim());
  if (!m) return null;
  return {
    x: clamp(Number(m[1]), 0, 100),
    y: clamp(Number(m[2]), 0, 100),
    z: clamp(m[3] ? Number(m[3]) : 1, 1, CROP_MAX_ZOOM),
  };
}

/** 편집기 속성에 담는 문자열 (`x,y,z`) */
export function formatCrop(c: CropFocus): string {
  return `${Math.round(c.x)},${Math.round(c.y)},${Math.round(c.z * 100) / 100}`;
}

/**
 * 원본 사진에서 실제로 보이는 영역(원본 픽셀 기준). 화면 표시와 같은 계산이라
 * 내보내기 등에서 같은 모양으로 잘라낼 수 있다.
 */
export function cropSourceRect(nw: number, nh: number, c: CropFocus): { sx: number; sy: number; sw: number; sh: number } {
  let visW: number;
  let visH: number;
  if (nw / nh > CROP_ASPECT) {
    visH = nh;
    visW = nh * CROP_ASPECT;
  } else {
    visW = nw;
    visH = nw / CROP_ASPECT;
  }
  const sw = visW / c.z;
  const sh = visH / c.z;
  return { sx: (nw - sw) * (c.x / 100), sy: (nh - sh) * (c.y / 100), sw, sh };
}
