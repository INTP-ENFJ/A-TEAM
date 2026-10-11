/**
 * 사진 일부 가리기로 만든 새 사진을 어디에 보관할지 (App이 기사를 열 때마다 알려줌).
 * projectId 가 없으면 프로젝트 없이 라이브러리에 보관한다.
 */
export interface BlurUploadConfig {
  projectId: string | null;
  uploader: { name?: string; email?: string; department?: string };
}

let current: BlurUploadConfig = { projectId: null, uploader: {} };

export const setBlurUploadConfig = (c: BlurUploadConfig) => { current = c; };
export const getBlurUploadConfig = (): BlurUploadConfig => current;
