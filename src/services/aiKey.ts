/**
 * 개인 AI 설정(공급자·모델·키) 도우미.
 * - 키는 내 계정에 암호화되어 서버에 저장된다. 그래서 어느 컴퓨터에서 로그인해도 다시 입력할 필요가 없다.
 * - 화면에는 키의 뒤 4자리만 보이며, 키 원문은 서버에서 브라우저로 돌아오지 않는다.
 * - AI 기능을 부를 때 서버가 내 계정의 키를 직접 꺼내 쓰므로, 호출하는 쪽에서 키를 붙일 필요가 없다.
 */
import { supabase } from '../lib/supabase';

export type AiProviderName = 'Google Gemini' | 'OpenAI' | 'Anthropic' | 'Custom API';
type Slug = 'gemini' | 'openai' | 'anthropic' | 'custom';

const SLUG: Record<AiProviderName, Slug> = {
  'Google Gemini': 'gemini',
  'OpenAI': 'openai',
  'Anthropic': 'anthropic',
  'Custom API': 'custom',
};
const NAME: Record<Slug, AiProviderName> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  custom: 'Custom API',
};

const LEGACY_KEY_PREFIX = 'press_ai_user_key:';
const LEGACY_PREFS_PREFIX = 'press_ai_user_prefs:';
const GENERIC_KEY = /^[\x21-\x7E]{8,400}$/;
const GEMINI_KEY = /^[A-Za-z0-9_.~+/=-]{20,400}$/;

export interface MyAiPrefs {
  provider: AiProviderName;
  model: string;
  /** 사내 API 주소 (Custom API일 때만) */
  endpoint: string;
}

/** 기능별로 따로 고르는 AI (review=기사 검수, media=사진 분석, draft=초안·원자료 정리·인포그래픽) */
export type AiFeatureName = 'review' | 'media' | 'draft';
export type FunctionModels = Partial<Record<AiFeatureName, { provider: AiProviderName; model: string }>>;

interface AiStatus {
  prefs: MyAiPrefs | null;
  /** 기능별로 따로 고른 공급자·모델 (없으면 기본 설정을 따름) */
  functionModels: FunctionModels;
  /** 공급자별 등록된 키의 뒤 4자리 */
  keys: Partial<Record<Slug | 'googlecloud', string>>;
}

export interface KeyCheckResult {
  ok: boolean;
  message: string;
  /** 서버가 키를 확인할 수 없는 경우(사내 API 등): 저장은 허용 */
  unverified?: boolean;
}

export function isValidKeyFormat(provider: AiProviderName, key: string): boolean {
  const k = key.trim();
  return provider === 'Google Gemini' ? GEMINI_KEY.test(k) : GENERIC_KEY.test(k);
}

async function callManage(body: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke('manage-ai-key', { body });
  if (error) {
    let message = '';
    try {
      const ctx = (error as any).context;
      if (ctx && typeof ctx.json === 'function') message = (await ctx.json())?.error || '';
    } catch {
      /* 무시 */
    }
    throw new Error(message || '서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (data && data.success === false) throw new Error(data.error || '요청을 처리하지 못했습니다.');
  return data;
}

function toStatus(data: any): AiStatus {
  const p = data?.prefs;
  const prefs: MyAiPrefs | null = p && NAME[p.provider as Slug]
    ? { provider: NAME[p.provider as Slug], model: String(p.model || ''), endpoint: String(p.endpoint || '') }
    : null;
  const functionModels: FunctionModels = {};
  const fm = data?.functionModels || {};
  for (const f of ['review', 'media', 'draft'] as AiFeatureName[]) {
    const v = fm[f];
    if (v && NAME[v.provider as Slug]) functionModels[f] = { provider: NAME[v.provider as Slug], model: String(v.model || '') };
  }
  return { prefs, functionModels, keys: (data?.keys || {}) as AiStatus['keys'] };
}

// 같은 화면에서 여러 번 묻지 않도록 잠깐 보관
let cache: { uid: string; at: number; value: AiStatus } | null = null;
const CACHE_MS = 30_000;

async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

function applyStatus(uid: string, data: any): AiStatus {
  const value = toStatus(data);
  cache = { uid, at: Date.now(), value };
  return value;
}

async function loadStatus(force = false): Promise<AiStatus> {
  const uid = await currentUserId();
  if (!uid) return { prefs: null, functionModels: {}, keys: {} };
  if (!force && cache && cache.uid === uid && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const data = await callManage({ action: 'status' });
    const value = toStatus(data);
    await migrateLegacyKeys(uid, value);
    cache = { uid, at: Date.now(), value };
    return value;
  } catch {
    return cache?.uid === uid ? cache.value : { prefs: null, functionModels: {}, keys: {} };
  }
}

/** 예전 버전이 이 브라우저에 저장해 둔 키가 있으면 내 계정으로 한 번 옮기고 지운다 */
let migrating = false;
async function migrateLegacyKeys(uid: string, status: AiStatus): Promise<void> {
  if (migrating) return;
  migrating = true;
  try {
    let legacyPrefs: MyAiPrefs | null = null;
    try {
      const raw = window.localStorage.getItem(LEGACY_PREFS_PREFIX + uid);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && SLUG[p.provider as AiProviderName]) {
          legacyPrefs = { provider: p.provider, model: String(p.model || ''), endpoint: String(p.endpoint || '') };
        }
      }
    } catch { /* 무시 */ }

    for (const name of Object.keys(SLUG) as AiProviderName[]) {
      const slug = SLUG[name];
      let key = '';
      let storageKey = `${LEGACY_KEY_PREFIX}${uid}:${slug}`;
      try {
        key = window.localStorage.getItem(storageKey) || '';
        if (!key && name === 'Google Gemini') {
          storageKey = LEGACY_KEY_PREFIX + uid;
          key = window.localStorage.getItem(storageKey) || '';
        }
      } catch { /* 무시 */ }
      if (!key) continue;
      if (status.keys[slug]) {
        try { window.localStorage.removeItem(storageKey); } catch { /* 무시 */ }
        continue;
      }
      if (!isValidKeyFormat(name, key)) continue;
      try {
        const useThis = legacyPrefs && legacyPrefs.provider === name;
        const data = await callManage({
          action: 'save_key',
          provider: slug,
          key,
          model: useThis ? legacyPrefs!.model : '',
          endpoint: useThis ? legacyPrefs!.endpoint : '',
        });
        status.keys = toStatus(data).keys;
        status.prefs = toStatus(data).prefs ?? status.prefs;
        try { window.localStorage.removeItem(storageKey); } catch { /* 무시 */ }
      } catch {
        /* 옮기지 못하면 이 브라우저의 복사본을 남겨 둔다 (다음에 다시 시도) */
      }
    }
  } finally {
    migrating = false;
  }
}

export async function getMyAiPrefs(): Promise<MyAiPrefs | null> {
  return (await loadStatus()).prefs;
}

export async function setMyAiPrefs(prefs: MyAiPrefs): Promise<void> {
  const uid = await currentUserId();
  if (!uid) throw new Error('로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.');
  const data = await callManage({
    action: 'save_prefs',
    provider: SLUG[prefs.provider],
    model: prefs.model,
    endpoint: prefs.endpoint,
  });
  applyStatus(uid, data);
}

/** 기능별로 따로 고른 공급자·모델 */
export async function getMyFunctionModels(): Promise<FunctionModels> {
  return (await loadStatus(true)).functionModels;
}

/** 기능별 공급자·모델 저장. 비워 둔 기능은 기본 설정을 따른다 */
export async function setMyFunctionModels(fm: FunctionModels): Promise<void> {
  const uid = await currentUserId();
  if (!uid) throw new Error('로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.');
  const body: Record<string, { provider: Slug; model: string }> = {};
  for (const [f, v] of Object.entries(fm)) {
    if (v && v.provider !== 'Custom API') body[f] = { provider: SLUG[v.provider], model: v.model };
  }
  const data = await callManage({ action: 'save_function_models', functionModels: body });
  applyStatus(uid, data);
}

/** 등록된 키가 있는 공급자 목록 (구글 클라우드 제외) */
export async function getMyKeyProviders(): Promise<AiProviderName[]> {
  const keys = (await loadStatus()).keys;
  return (Object.keys(NAME) as Slug[]).filter(k => keys[k]).map(k => NAME[k]);
}

/** 이 공급자의 등록된 키 뒤 4자리 (없으면 빈 문자열) */
export async function getMyAiKeyLast4(provider: AiProviderName): Promise<string> {
  return (await loadStatus()).keys[SLUG[provider]] || '';
}

/** 키를 서버에서 확인한 뒤 암호화해 내 계정에 저장 (공급자·모델·주소도 함께 저장) */
export async function saveMyAiKey(prefs: MyAiPrefs, key: string): Promise<KeyCheckResult> {
  const uid = await currentUserId();
  if (!uid) throw new Error('로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.');
  const clean = key.trim();
  if (!isValidKeyFormat(prefs.provider, clean)) throw new Error('키 형식이 올바르지 않습니다. 복사한 키를 그대로 붙여 넣어 주세요.');
  const data = await callManage({
    action: 'save_key',
    provider: SLUG[prefs.provider],
    key: clean,
    model: prefs.model,
    endpoint: prefs.endpoint,
  });
  applyStatus(uid, data);
  return { ok: true, unverified: !!data.unverified, message: data.message || '' };
}

/** 이미 저장된 키가 아직 유효한지 서버가 다시 확인 */
export async function testSavedAiKey(provider: AiProviderName, endpoint: string): Promise<KeyCheckResult> {
  try {
    const data = await callManage({ action: 'test_key', provider: SLUG[provider], endpoint });
    return { ok: true, unverified: !!data.unverified, message: data.message || '키가 정상으로 확인되었습니다.' };
  } catch (e: any) {
    return { ok: false, message: e?.message || '키를 확인하지 못했습니다.' };
  }
}

export async function clearMyAiKey(provider: AiProviderName): Promise<void> {
  const uid = await currentUserId();
  if (!uid) return;
  const data = await callManage({ action: 'delete_key', provider: SLUG[provider] });
  applyStatus(uid, data);
  try {
    window.localStorage.removeItem(`${LEGACY_KEY_PREFIX}${uid}:${SLUG[provider]}`);
    if (provider === 'Google Gemini') window.localStorage.removeItem(LEGACY_KEY_PREFIX + uid);
  } catch { /* 무시 */ }
}

/** 지금 쓰기로 한 공급자의 키가 등록되어 있는지 */
export async function hasMyAiKey(): Promise<boolean> {
  const st = await loadStatus();
  const slug = SLUG[st.prefs?.provider || 'Google Gemini'];
  return !!st.keys[slug];
}

/**
 * AI 함수를 부를 때 붙이는 머리글.
 * 이제 서버가 내 계정에 저장된 키를 직접 꺼내 쓰므로 비어 있는 객체를 돌려준다.
 */
export async function getAiKeyHeaders(): Promise<Record<string, string>> {
  return {};
}

/** 화면에 보여 줄 가린 표기: 뒤 4자리만 */
export function maskLast4(last4: string): string {
  return last4 ? `••••••••${last4}` : '';
}

// ---------- 받아쓰기 전용: 구글 클라우드 서비스 계정 키 ----------
// Gemini·OpenAI 키는 위의 공통 함수를 쓰고, 구글 클라우드는 글쓰기 공급자로 고를 수 없는 받아쓰기 전용 키다.

/** 구글 클라우드 키 뒤 4자리(프로젝트 이름 끝부분). 없으면 빈 문자열 */
export async function getGoogleCloudKeyLast4(): Promise<string> {
  return (await loadStatus()).keys.googlecloud || '';
}

/** 서비스 계정 키(JSON 내용)를 서버에서 확인한 뒤 암호화해 저장 */
export async function saveGoogleCloudKey(json: string): Promise<KeyCheckResult> {
  const uid = await currentUserId();
  if (!uid) throw new Error('로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.');
  const data = await callManage({ action: 'save_key', provider: 'googlecloud', key: json.trim() });
  applyStatus(uid, data);
  return { ok: true, unverified: true, message: data.message || '' };
}

export async function testGoogleCloudKey(): Promise<KeyCheckResult> {
  try {
    const data = await callManage({ action: 'test_key', provider: 'googlecloud' });
    return { ok: true, unverified: true, message: data.message || '' };
  } catch (e: any) {
    return { ok: false, message: e?.message || '키를 확인하지 못했습니다.' };
  }
}

export async function clearGoogleCloudKey(): Promise<void> {
  const uid = await currentUserId();
  if (!uid) return;
  const data = await callManage({ action: 'delete_key', provider: 'googlecloud' });
  applyStatus(uid, data);
}

/** 받아쓰기에 쓸 수 있는 엔진별 키 등록 여부 */
export async function getSttKeyStatus(): Promise<{
  gemini: boolean;
  openai: boolean;
  googlecloud: boolean;
  /** 지금 글쓰기에 쓰는 공급자 */
  active: 'gemini' | 'openai' | 'anthropic' | 'custom';
}> {
  const st = await loadStatus(true);
  return {
    gemini: !!st.keys.gemini,
    openai: !!st.keys.openai,
    googlecloud: !!st.keys.googlecloud,
    active: SLUG[st.prefs?.provider || 'Google Gemini'],
  };
}
