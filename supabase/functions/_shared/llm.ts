/**
 * 공통 AI 호출 도우미 (Gemini / OpenAI / Anthropic / 사내 API)
 * - 사용자가 환경설정에 등록한 "개인 키"는 계정에 암호화(AES-GCM)되어 저장된다.
 * - 암호 열쇠는 서버 비밀값 AI_KEY_ENCRYPTION_SECRET 이며, 키 원문은 브라우저로 돌려보내지 않는다.
 * - 키는 로그에 남기지 않는다.
 */

export type LlmProvider = "gemini" | "openai" | "anthropic" | "custom";

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  endpoint?: string;
}

export const LLM_CORS_HEADERS =
  "authorization, x-client-info, apikey, content-type";

export const LLM_MISSING_MESSAGE =
  "개인 AI 키가 등록되지 않았습니다. 환경설정의 AI 서비스 설정에서 내 AI 키를 등록해 주세요.";
const LLM_INVALID_MESSAGE =
  "등록한 AI 키가 올바르지 않거나 사용 권한이 없습니다. 환경설정에서 키를 확인해 주세요.";
const LLM_RATE_MESSAGE =
  "AI 사용 한도를 넘었습니다. 잠시 후 다시 시도하거나 내 AI 계정의 사용 한도를 확인해 주세요.";
const LLM_BUSY_MESSAGE =
  "AI 서비스가 지금 이용자가 몰려 응답하지 못했습니다. 잠시 후 다시 시도해 주세요. 계속되면 환경설정에서 다른 모델을 골라 보세요.";
const LLM_CONFIG_MESSAGE =
  "AI 설정(공급자, 모델, 주소)이 올바르지 않습니다. 환경설정의 AI 서비스 설정을 확인해 주세요.";

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  gemini: "gemini-3.8-flash",
  openai: "gpt-6-luna",
  anthropic: "claude-sonnet-5-5",
  custom: "custom-newsroom-llm-v1",
};

export class LlmError extends Error {
  code: "AI_KEY_INVALID" | "AI_RATE_LIMIT" | "AI_CONFIG_INVALID" | "AI_UPSTREAM" | "AI_BUSY";
  constructor(code: LlmError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export function isSafeHttpsEndpoint(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.startsWith("[")) return null;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return null;
    }
  }
  return u;
}

export const PROVIDERS: LlmProvider[] = ["gemini", "openai", "anthropic", "custom"];

// 글쓰기용 AI는 아니고, 받아쓰기(음성 인식)에만 쓰는 구글 클라우드 키도 같은 보관함에 저장한다
export type KeyProvider = LlmProvider | "googlecloud";
export const KEY_PROVIDERS: KeyProvider[] = [...PROVIDERS, "googlecloud"];

export function isValidKeyFormat(provider: LlmProvider, key: string): boolean {
  if (!/^[\x21-\x7E]{8,400}$/.test(key)) return false;
  if (provider === "gemini" && !/^[A-Za-z0-9_.~+\/=\-]{20,400}$/.test(key)) return false;
  return true;
}

export function sanitizeModel(provider: LlmProvider, raw: unknown): string {
  const m = typeof raw === "string" ? raw.trim() : "";
  return /^[A-Za-z0-9._:\/\-]{1,100}$/.test(m) ? m : DEFAULT_MODELS[provider];
}

/** 사내 API 주소를 검사해 정리한 문자열을 돌려준다. 안전하지 않으면 null */
export function sanitizeEndpoint(raw: unknown): string | null {
  const u = isSafeHttpsEndpoint(typeof raw === "string" ? raw.trim() : "");
  return u ? u.toString().replace(/\/+$/, "") : null;
}

// ---------- 키 암호화 (AES-GCM) ----------
export const ENCRYPTION_MISSING_MESSAGE =
  "서버에 키 암호화용 비밀값(AI_KEY_ENCRYPTION_SECRET)이 설정되지 않았습니다. 관리자에게 설정을 요청해 주세요.";

async function aesKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("AI_KEY_ENCRYPTION_SECRET") || "";
  if (secret.length < 16) throw new LlmError("AI_CONFIG_INVALID", ENCRYPTION_MISSING_MESSAGE);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function encryptKey(plain: string): Promise<{ cipher: string; iv: string }> {
  const key = await aesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return { cipher: toB64(enc), iv: toB64(iv) };
}

export async function decryptKey(cipher: string, iv: string): Promise<string> {
  const key = await aesKey();
  try {
    const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, key, fromB64(cipher));
    return new TextDecoder().decode(dec);
  } catch {
    throw new LlmError("AI_KEY_INVALID", "저장된 AI 키를 읽을 수 없습니다. 환경설정에서 키를 다시 등록해 주세요.");
  }
}

/** 지정한 공급자의 저장된 키를 풀어서 돌려준다 (서버 안에서만 사용). 없으면 null */
export async function loadProviderKey(adminClient: any, userId: string, provider: KeyProvider): Promise<string | null> {
  const { data: row } = await adminClient
    .from("user_ai_keys")
    .select("key_cipher, key_iv")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (!row) return null;
  return await decryptKey(row.key_cipher, row.key_iv);
}

/** 기능별 모델을 고를 수 있는 AI 기능 묶음 */
export type AiFeature = "review" | "media" | "draft";
export const AI_FEATURES: AiFeature[] = ["review", "media", "draft"];
/** 기능별로 다른 공급자를 쓸 수 있는 곳 (사내 API는 주소가 하나라 기본 설정에서만 사용) */
export const FEATURE_PROVIDERS: LlmProvider[] = ["gemini", "openai", "anthropic"];

/** user_ai_prefs.function_models 값을 안전하게 정리한다 */
export function sanitizeFunctionModels(raw: unknown): Partial<Record<AiFeature, { provider: LlmProvider; model: string }>> {
  const out: Partial<Record<AiFeature, { provider: LlmProvider; model: string }>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const f of AI_FEATURES) {
    const v = (raw as any)[f];
    if (!v || typeof v !== "object") continue;
    const p = String(v.provider || "") as LlmProvider;
    if (!FEATURE_PROVIDERS.includes(p)) continue;
    out[f] = { provider: p, model: sanitizeModel(p, v.model) };
  }
  return out;
}

/**
 * 로그인한 사용자의 저장된 공급자·모델·키를 읽어 온다. 키가 없으면 null
 * feature를 주면, 그 기능에 따로 고른 공급자·모델이 있고 그 공급자의 키가 등록돼 있을 때 그것을 쓴다.
 * (따로 고르지 않았거나 그 공급자 키가 없으면 기본 설정을 쓴다)
 */
export async function loadLlmConfig(adminClient: any, userId: string, feature?: AiFeature): Promise<LlmConfig | null> {
  // select("*"): function_models 칸을 만드는 SQL을 아직 실행하지 않은 경우에도 오류 없이 동작
  const { data: prefs } = await adminClient
    .from("user_ai_prefs")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (feature) {
    const pick = sanitizeFunctionModels(prefs?.function_models)[feature];
    if (pick) {
      const { data: frow } = await adminClient
        .from("user_ai_keys")
        .select("key_cipher, key_iv")
        .eq("user_id", userId)
        .eq("provider", pick.provider)
        .maybeSingle();
      if (frow) {
        const fkey = await decryptKey(frow.key_cipher, frow.key_iv);
        return { provider: pick.provider, apiKey: fkey, model: pick.model };
      }
    }
  }

  const provider = (PROVIDERS.includes(prefs?.provider) ? prefs.provider : "gemini") as LlmProvider;

  const { data: row } = await adminClient
    .from("user_ai_keys")
    .select("key_cipher, key_iv")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (!row) return null;

  const apiKey = await decryptKey(row.key_cipher, row.key_iv);
  const model = sanitizeModel(provider, prefs?.model);
  let endpoint: string | undefined;
  if (provider === "custom") {
    const ep = sanitizeEndpoint(prefs?.endpoint);
    if (!ep) throw new LlmError("AI_CONFIG_INVALID", LLM_CONFIG_MESSAGE);
    endpoint = ep;
  }
  return { provider, apiKey, model, endpoint };
}

export interface KeyTestResult {
  ok: boolean;
  unverified?: boolean;
  message: string;
}

/** 공급자에 직접 물어 키가 맞는지 확인 (모델 목록 요청) */
export async function testLlmKey(provider: LlmProvider, apiKey: string, endpoint?: string): Promise<KeyTestResult> {
  let url = "";
  const headers: Record<string, string> = {};
  if (provider === "gemini") {
    url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1";
    headers["x-goog-api-key"] = apiKey;
  } else if (provider === "openai") {
    url = "https://api.openai.com/v1/models";
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else if (provider === "anthropic") {
    url = "https://api.anthropic.com/v1/models?limit=1";
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    if (!endpoint) return { ok: false, message: "사내 API 주소는 https:// 로 시작하는 공개 주소여야 합니다." };
    url = `${endpoint}/models`;
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  try {
    const res = await fetch(url, { headers, redirect: provider === "custom" ? "manual" : "follow", signal: AbortSignal.timeout(15_000) });
    await res.body?.cancel();
    if (res.ok) return { ok: true, message: "키가 정상으로 확인되었습니다." };
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { ok: false, message: "키가 올바르지 않거나 사용 권한이 없습니다. 다시 확인해 주세요." };
    }
    if (res.status === 429) return { ok: false, message: "사용 한도를 넘었습니다. 잠시 후 다시 시도해 주세요." };
    if (provider === "custom") {
      return { ok: true, unverified: true, message: "키를 확인하는 주소가 없어 확인 없이 저장합니다. 실제 사용할 때 확인됩니다." };
    }
    return { ok: false, message: `키를 확인하지 못했습니다. (오류 ${res.status})` };
  } catch {
    if (provider === "custom") {
      return { ok: true, unverified: true, message: "사내 API에 연결해 확인하지 못했지만 저장합니다. 실제 사용할 때 확인됩니다." };
    }
    return { ok: false, message: "키를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/** 모델이 JSON 앞뒤에 붙인 설명이나 ```json 울타리를 걷어낸다 */
export function extractJsonText(text: string): string {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  if (!t.startsWith("{") && !t.startsWith("[")) {
    const s = t.indexOf("{");
    const e = t.lastIndexOf("}");
    if (s !== -1 && e > s) t = t.slice(s, e + 1);
  }
  return t;
}

/** AI 호출 기록(성능 지표용)을 남길 때 필요한 정보. 내용은 저장하지 않고 개수·시간만 기록 */
export interface AiLogContext {
  admin: any;
  userId: string;
  fn: string;
}

export interface LlmRequest {
  system: string;
  user: string;
  image?: { mimeType: string; base64: string };
  maxTokens?: number;
  temperature?: number;
  log?: AiLogContext;
}

/** 호출 기록 저장. 실패해도 본 기능에는 영향이 없다 */
async function recordAiCall(
  log: AiLogContext | undefined,
  cfg: { provider: string; model: string },
  startedAt: number,
  ok: boolean,
  errorCode: string | null,
  inChars: number,
  outChars: number,
): Promise<void> {
  if (!log) return;
  try {
    await log.admin.from("ai_call_logs").insert({
      user_id: log.userId,
      fn: log.fn,
      provider: cfg.provider,
      model: cfg.model,
      ok,
      error_code: errorCode,
      latency_ms: Math.max(0, Date.now() - startedAt),
      in_chars: inChars,
      out_chars: outChars,
    });
  } catch {
    /* 기록 실패는 무시 */
  }
}

/** 호출을 시간 재며 실행하고 성공·실패를 기록한다 */
async function withLog<T>(
  log: AiLogContext | undefined,
  cfg: { provider: string; model: string },
  inChars: number,
  work: () => Promise<T>,
  outChars: (r: T) => number,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const r = await work();
    await recordAiCall(log, cfg, startedAt, true, null, inChars, outChars(r));
    return r;
  } catch (e) {
    await recordAiCall(log, cfg, startedAt, false, e instanceof LlmError ? e.code : "ERROR", inChars, 0);
    throw e;
  }
}

function failFromStatus(status: number, text: string): never {
  if (status === 401 || status === 403 || (status === 400 && /API key|API_KEY|api_key|invalid x-api-key|Incorrect API key/i.test(text))) {
    throw new LlmError("AI_KEY_INVALID", LLM_INVALID_MESSAGE);
  }
  if (status === 429) throw new LlmError("AI_RATE_LIMIT", LLM_RATE_MESSAGE);
  if (status === 500 || status === 502 || status === 503 || status === 504 || status === 529) {
    console.error(`[llm] upstream busy ${status}:`, text.slice(0, 200));
    throw new LlmError("AI_BUSY", LLM_BUSY_MESSAGE);
  }
  if (status === 404) throw new LlmError("AI_CONFIG_INVALID", LLM_CONFIG_MESSAGE);
  console.error(`[llm] upstream error ${status}:`, text.slice(0, 300));
  throw new LlmError("AI_UPSTREAM", "AI 서비스 호출에 실패했습니다.");
}

async function postJsonOnce(url: string, headers: Record<string, string>, body: unknown, noRedirect: boolean): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      redirect: noRedirect ? "manual" : "follow",
      signal: AbortSignal.timeout(100_000),
    });
  } catch (e) {
    console.error("[llm] network error:", (e as Error)?.name);
    throw new LlmError("AI_UPSTREAM", "AI 서비스에 연결하지 못했습니다.");
  }
  if (res.status >= 300 && res.status < 400) throw new LlmError("AI_CONFIG_INVALID", LLM_CONFIG_MESSAGE);
  const text = await res.text();
  if (!res.ok) failFromStatus(res.status, text);
  try {
    return JSON.parse(text);
  } catch {
    throw new LlmError("AI_UPSTREAM", "AI 응답을 해석하지 못했습니다.");
  }
}

// 일시적으로 몰릴 때(503 등)는 잠깐 쉬었다가 두 번까지 다시 시도한다
async function postJson(url: string, headers: Record<string, string>, body: unknown, noRedirect: boolean): Promise<any> {
  const waits = [1500, 4000];
  for (let i = 0; ; i++) {
    try {
      return await postJsonOnce(url, headers, body, noRedirect);
    } catch (e) {
      if (e instanceof LlmError && e.code === "AI_BUSY" && i < waits.length) {
        await new Promise((r) => setTimeout(r, waits[i]));
        continue;
      }
      throw e;
    }
  }
}

/** 공급자에 맞게 호출하고, JSON 문자열(텍스트)만 돌려준다 */
export function callLlm(cfg: LlmConfig, req: LlmRequest): Promise<string> {
  return withLog(req.log, cfg, req.system.length + req.user.length, () => callLlmInner(cfg, req), (r) => r.length);
}

async function callLlmInner(cfg: LlmConfig, req: LlmRequest): Promise<string> {
  const maxTokens = req.maxTokens ?? 4096;
  const temperature = req.temperature ?? 0.1;
  let out: unknown;

  if (cfg.provider === "gemini") {
    const parts: unknown[] = [{ text: req.system }];
    if (req.user) parts.push({ text: req.user });
    if (req.image) parts.push({ inlineData: { mimeType: req.image.mimeType, data: req.image.base64 } });
    const json = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
      { "x-goog-api-key": cfg.apiKey },
      {
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", temperature, maxOutputTokens: maxTokens },
      },
      false,
    );
    out = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  } else if (cfg.provider === "anthropic") {
    const content: unknown[] = [];
    if (req.image) content.push({ type: "image", source: { type: "base64", media_type: req.image.mimeType, data: req.image.base64 } });
    content.push({ type: "text", text: req.user || "위 지시에 따라 JSON으로만 답하세요." });
    const json = await postJson(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
      { model: cfg.model, max_tokens: maxTokens, temperature, system: req.system, messages: [{ role: "user", content }] },
      false,
    );
    out = json?.content?.find((c: any) => c?.type === "text")?.text;
  } else {
    // OpenAI 및 OpenAI 호환 사내 API
    const isOpenAI = cfg.provider === "openai";
    const base = isOpenAI ? "https://api.openai.com/v1" : cfg.endpoint!;
    const userContent: unknown[] = [{ type: "text", text: req.user || "위 지시에 따라 JSON으로만 답하세요." }];
    if (req.image) userContent.push({ type: "image_url", image_url: { url: `data:${req.image.mimeType};base64,${req.image.base64}` } });
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: userContent },
      ],
    };
    if (isOpenAI) {
      body.max_completion_tokens = maxTokens;
      body.response_format = { type: "json_object" };
    } else {
      body.max_tokens = maxTokens;
      body.temperature = temperature;
    }
    const json = await postJson(`${base}/chat/completions`, { Authorization: `Bearer ${cfg.apiKey}` }, body, !isOpenAI);
    out = json?.choices?.[0]?.message?.content;
  }

  if (typeof out !== "string" || !out.trim()) {
    throw new LlmError("AI_UPSTREAM", "AI 응답 내용이 올바르지 않습니다.");
  }
  return extractJsonText(out);
}

/** 키·한도·설정 문제는 사용자가 이해할 수 있는 안내로 바꿔 돌려준다. 그 밖의 오류면 null */
export function llmErrorResponse(err: unknown, corsHeaders: Record<string, string>): Response | null {
  if (err instanceof LlmError) {
    if (err.code === "AI_UPSTREAM") return null;
    const status = err.code === "AI_RATE_LIMIT" || err.code === "AI_BUSY" ? 429 : 400;
    return Response.json({ success: false, error: err.message, code: err.code }, { status, headers: corsHeaders });
  }
  return null;
}

export function llmMissingResponse(corsHeaders: Record<string, string>): Response {
  return Response.json(
    { success: false, error: LLM_MISSING_MESSAGE, code: "CONFIG_ERROR" },
    { status: 400, headers: corsHeaders },
  );
}

// ---------- 음성 → 글자 (STT) ----------
export const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mp3",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  flac: "audio/flac",
  webm: "audio/webm",
};

export const STT_UNSUPPORTED_MESSAGE =
  "녹음 받아쓰기는 Google Gemini, OpenAI, 구글 클라우드 키로만 쓸 수 있습니다. Claude는 소리를 들을 수 없어요. 환경설정에서 받아쓰기용 키를 등록해 주세요.";

export type SttLang = "ko" | "en" | "ja" | "zh";
export type SttMode = "speech" | "interview";
export type SttEngine = "gemini" | "openai" | "googlecloud";
export const STT_LANGS: SttLang[] = ["ko", "en", "ja", "zh"];
export const STT_ENGINES: SttEngine[] = ["gemini", "openai", "googlecloud"];

export interface SttOptions {
  language: SttLang;
  mode: SttMode;
  /** 인터뷰에서 말하는 사람 수 (모르면 생략). Gemini 안내문에만 쓰인다 */
  speakers?: number;
  /** 받아쓰기에 쓸 모델 (글쓰기 모델과 따로 고름). 없으면 기본 모델 */
  model?: string;
}

export interface SttResult {
  text: string;
  /** 화자가 실제로 나뉘어 적혔는지 */
  diarized: boolean;
  /** 사용자에게 보여 줄 안내 (예: 화자 구분 없이 적었음) */
  note?: string;
}

const LANG_NAME: Record<SttLang, string> = { ko: "한국어", en: "영어", ja: "일본어", zh: "중국어" };
const GOOGLE_LANG: Record<SttLang, string> = { ko: "ko-KR", en: "en-US", ja: "ja-JP", zh: "cmn-Hans-CN" };

export function sanitizeSttOptions(body: any): SttOptions {
  const language = STT_LANGS.includes(body?.language) ? (body.language as SttLang) : "ko";
  const mode: SttMode = body?.mode === "interview" ? "interview" : "speech";
  const n = Number(body?.speakers);
  const speakers = Number.isInteger(n) && n >= 2 && n <= 6 ? n : undefined;
  const m = typeof body?.model === "string" ? body.model.trim() : "";
  const model = /^[A-Za-z0-9._:\/\-]{1,100}$/.test(m) ? m : undefined;
  return { language, mode, speakers, model };
}

/** 말한 사람별 조각을 "화자1: …" 줄로 정리한다. 같은 사람이 이어 말하면 한 줄로 합친다 */
function formatTurns(turns: { speaker: string | null; text: string }[], joiner: string): SttResult {
  const clean = turns.map((t) => ({ speaker: t.speaker, text: t.text.trim() })).filter((t) => t.text);
  if (clean.length === 0) return { text: "", diarized: false };
  if (!clean.some((t) => t.speaker)) {
    return { text: clean.map((t) => t.text).join("\n").trim(), diarized: false };
  }
  const order = new Map<string, number>();
  const merged: { n: number; text: string }[] = [];
  for (const t of clean) {
    const key = t.speaker ?? "?";
    if (!order.has(key)) order.set(key, order.size + 1);
    const n = order.get(key)!;
    const last = merged[merged.length - 1];
    if (last && last.n === n) last.text += joiner + t.text;
    else merged.push({ n, text: t.text });
  }
  return { text: merged.map((m) => `화자${m.n}: ${m.text}`).join("\n"), diarized: true };
}

async function postMultipart(url: string, headers: Record<string, string>, form: FormData): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body: form, signal: AbortSignal.timeout(150_000) });
  } catch {
    throw new LlmError("AI_UPSTREAM", "AI 서비스에 연결하지 못했습니다.");
  }
  const text = await res.text();
  if (!res.ok) failFromStatus(res.status, text);
  try {
    return JSON.parse(text);
  } catch {
    throw new LlmError("AI_UPSTREAM", "AI 응답을 해석하지 못했습니다.");
  }
}

function geminiSttPrompt(opts: SttOptions): string {
  const lang = LANG_NAME[opts.language];
  const base =
    `다음 녹음은 ${lang}로 말한 내용입니다. 들리는 말을 ${lang} 그대로 받아 적으세요. 번역하거나 요약하거나 덧붙이거나 고치지 마세요. `;
  const part = opts.mode === "interview"
    ? "여러 사람이 말하는 인터뷰입니다. 말하는 사람이 바뀔 때마다 줄을 바꾸고 '화자1:', '화자2:'처럼 표시하되, 같은 사람에게는 항상 같은 번호를 붙이세요." +
      (opts.speakers ? ` 말하는 사람은 ${opts.speakers}명입니다.` : "") + " "
    : "한 사람이 말하는 발표·강연입니다. 화자 표시는 하지 말고, 말의 흐름에 따라 문단을 나눠 적으세요. ";
  return base + part + "잘 들리지 않는 부분은 [불명확]으로 표시하세요. 받아 적은 글만 출력하세요.";
}

/** 녹음 파일을 글자로 받아 적는다 (Gemini 또는 OpenAI) */
export function transcribeAudio(
  cfg: LlmConfig,
  audio: { mimeType: string; base64: string; bytes: Uint8Array<ArrayBuffer> | null },
  opts: SttOptions,
  log?: AiLogContext,
): Promise<SttResult> {
  return withLog(log, cfg, audio.base64.length, async (): Promise<SttResult> => {
    let result: SttResult;
    if (cfg.provider === "gemini") {
      const json = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
        { "x-goog-api-key": cfg.apiKey },
        {
          contents: [{
            role: "user",
            parts: [{ text: geminiSttPrompt(opts) }, { inlineData: { mimeType: audio.mimeType, data: audio.base64 } }],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 16384 },
        },
        false,
      );
      const out = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("");
      const text = typeof out === "string" ? out.trim() : "";
      // 인터뷰 모드에서 '화자N:' 표시가 실제로 들어갔는지 확인
      result = { text, diarized: opts.mode === "interview" && /(^|\n)화자\d+\s*:/.test(text) };
    } else if (cfg.provider === "openai") {
      if (!audio.bytes) throw new LlmError("AI_UPSTREAM", "녹음 파일을 읽지 못했습니다.");
      const ext = Object.entries(AUDIO_MIME).find(([, m]) => m === audio.mimeType)?.[0] || "mp3";
      const headers = { Authorization: `Bearer ${cfg.apiKey}` };
      const url = "https://api.openai.com/v1/audio/transcriptions";
      const file = () => new Blob([audio.bytes!], { type: audio.mimeType });
      let done: SttResult | null = null;
      let note: string | undefined;

      // 고른 모델이 화자 구분 모델이거나 따로 고르지 않았을 때만 화자 구분을 시도한다
      const pickedDiarize = !opts.model || opts.model.includes("diarize");
      if (opts.mode === "interview" && pickedDiarize) {
        // 화자 구분 전용 모델을 먼저 시도하고, 쓸 수 없으면 일반 받아쓰기로 대신한다
        try {
          const form = new FormData();
          form.append("model", opts.model && opts.model.includes("diarize") ? opts.model : "gpt-4o-transcribe-diarize");
          form.append("response_format", "diarized_json");
          form.append("chunking_strategy", "auto");
          form.append("file", file(), `audio.${ext}`);
          const json = await postMultipart(url, headers, form);
          const segs = Array.isArray(json?.segments) ? json.segments : [];
          const turns = segs.map((s: any) => ({ speaker: s?.speaker != null ? String(s.speaker) : null, text: String(s?.text ?? "") }));
          const r = formatTurns(turns, opts.language === "ja" || opts.language === "zh" ? "" : " ");
          if (r.text) done = r;
        } catch (e) {
          if (e instanceof LlmError && (e.code === "AI_RATE_LIMIT" || e.code === "AI_BUSY")) throw e;
          console.error("[stt] openai diarize unavailable:", (e as Error)?.message);
        }
        if (!done) note = "OpenAI의 화자 구분 기능을 쓰지 못해 화자 구분 없이 받아 적었습니다.";
      } else if (opts.mode === "interview") {
        note = "고른 모델은 화자를 나누지 못해 화자 구분 없이 받아 적었습니다. 화자 구분 모델로 바꾸면 말한 사람별로 나뉩니다.";
      }
      if (!done) {
        const form = new FormData();
        form.append("model", (opts.model && !opts.model.includes("diarize") ? opts.model : "") || Deno.env.get("STT_MODEL_OPENAI") || "whisper-1");
        form.append("language", opts.language);
        form.append("response_format", "json");
        form.append("file", file(), `audio.${ext}`);
        const json = await postMultipart(url, headers, form);
        done = { text: typeof json?.text === "string" ? json.text.trim() : "", diarized: false, note };
      }
      result = done;
    } else {
      throw new LlmError("AI_CONFIG_INVALID", STT_UNSUPPORTED_MESSAGE);
    }
    if (!result.text) throw new LlmError("AI_UPSTREAM", "녹음에서 받아 적을 말을 찾지 못했습니다.");
    return result;
  }, (r) => r.text.length);
}

// ---------- 구글 클라우드 (서비스 계정 키 JSON) ----------
export interface GoogleServiceAccount {
  email: string;
  privateKey: string;
  projectId: string;
}

/** 서비스 계정 키(JSON 글자)를 검사해 필요한 값만 꺼낸다. 형식이 다르면 null */
export function parseGoogleServiceAccount(raw: string): GoogleServiceAccount | null {
  if (typeof raw !== "string" || raw.length < 200 || raw.length > 12_000) return null;
  let j: any;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (j?.type !== "service_account") return null;
  const email = String(j.client_email || "");
  const projectId = String(j.project_id || "");
  const privateKey = String(j.private_key || "");
  if (!/^[a-z0-9._-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/i.test(email)) return null;
  if (!/^[a-z][a-z0-9-]{4,60}[a-z0-9]$/.test(projectId)) return null;
  if (!/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(privateKey)) return null;
  return { email, privateKey, projectId };
}

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const GOOGLE_AUTH_MESSAGE =
  "구글 클라우드 서비스 계정 키를 확인하지 못했습니다. 키 파일(JSON) 전체를 다시 붙여 넣어 주세요.";

/** 서비스 계정으로 서명한 신청서를 보내 임시 출입증(액세스 토큰)을 받는다 */
async function googleAccessToken(sa: GoogleServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  let signature: Uint8Array;
  try {
    const der = fromB64(sa.privateKey.replace(/-----[A-Z ]+-----/g, "").replace(/\s/g, ""));
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claim}`)));
  } catch {
    throw new LlmError("AI_KEY_INVALID", GOOGLE_AUTH_MESSAGE);
  }
  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${head}.${claim}.${b64url(signature)}`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new LlmError("AI_UPSTREAM", "구글에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) throw new LlmError("AI_KEY_INVALID", GOOGLE_AUTH_MESSAGE);
    throw new LlmError("AI_UPSTREAM", "구글 인증에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }
  let token: unknown;
  try {
    token = JSON.parse(text)?.access_token;
  } catch { /* fallthrough */ }
  if (typeof token !== "string" || !token) throw new LlmError("AI_UPSTREAM", "구글 인증 응답을 해석하지 못했습니다.");
  return token;
}

/** 구글 클라우드 키 확인: 인증만 해 보며, 음성 인식 권한은 실제 변환 때 확인된다 */
export async function testGoogleCloudKey(raw: string): Promise<KeyTestResult> {
  const sa = parseGoogleServiceAccount(raw);
  if (!sa) {
    return { ok: false, message: "서비스 계정 키(JSON 파일 내용 전체)가 아닙니다. 파일을 메모장으로 열어 전체를 복사해 붙여 넣어 주세요." };
  }
  try {
    await googleAccessToken(sa);
    return {
      ok: true,
      unverified: true,
      message: "서비스 계정 키는 정상입니다. Speech-to-Text 사용 권한과 결제 설정은 실제로 받아쓸 때 확인됩니다.",
    };
  } catch (e) {
    if (e instanceof LlmError) return { ok: false, message: e.message };
    return { ok: false, message: "키를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

const GOOGLE_PERMISSION_MESSAGE =
  "구글 클라우드에서 받아쓰기를 허용하지 않았습니다. 해당 프로젝트에서 Speech-to-Text API 사용 설정, 결제 계정 연결, 서비스 계정 역할(Cloud Speech 클라이언트)을 확인해 주세요.";

/**
 * 구글 클라우드 Speech-to-Text(Chirp 3)로 받아 적는다.
 * 한 번에 약 1분 분량까지만 보낼 수 있어, 긴 녹음은 화면에서 잘라서 여러 번 호출한다.
 */
export function transcribeGoogleCloud(
  saJson: string,
  audio: { base64: string },
  opts: SttOptions,
  log?: AiLogContext,
): Promise<SttResult> {
  const sa = parseGoogleServiceAccount(saJson);
  if (!sa) return Promise.reject(new LlmError("AI_KEY_INVALID", GOOGLE_AUTH_MESSAGE));
  const logCfg = { provider: "googlecloud", model: "chirp_3" };
  return withLog(log, logCfg, audio.base64.length, async (): Promise<SttResult> => {
    const token = await googleAccessToken(sa);
    const envRegion = Deno.env.get("GOOGLE_STT_REGION") || "us";
    const region = envRegion === "eu" ? "eu" : "us";
    const url =
      `https://${region}-speech.googleapis.com/v2/projects/${encodeURIComponent(sa.projectId)}` +
      `/locations/${region}/recognizers/_:recognize`;
    const body = {
      config: {
        autoDecodingConfig: {},
        languageCodes: [GOOGLE_LANG[opts.language]],
        model: "chirp_3",
        features: opts.mode === "interview" ? { diarizationConfig: {} } : {},
      },
      content: audio.base64,
    };

    let res: Response | null = null;
    for (let i = 0; i < 3; i++) {
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(100_000),
        });
      } catch {
        throw new LlmError("AI_UPSTREAM", "구글 서비스에 연결하지 못했습니다.");
      }
      if ((res.status === 503 || res.status === 500) && i < 2) {
        await res.body?.cancel();
        await new Promise((r) => setTimeout(r, [1500, 4000][i]));
        continue;
      }
      break;
    }
    const text = await res!.text();
    if (!res!.ok) {
      console.error(`[stt] google error ${res!.status}:`, text.slice(0, 300));
      if (res!.status === 401 || res!.status === 403) throw new LlmError("AI_KEY_INVALID", GOOGLE_PERMISSION_MESSAGE);
      if (res!.status === 429) throw new LlmError("AI_RATE_LIMIT", LLM_RATE_MESSAGE);
      if (res!.status === 500 || res!.status === 503) throw new LlmError("AI_BUSY", LLM_BUSY_MESSAGE);
      if (res!.status === 404) throw new LlmError("AI_CONFIG_INVALID", "구글 클라우드에서 이 지역·모델을 찾지 못했습니다. 관리자에게 문의해 주세요.");
      if (/too long|exceed|duration|size/i.test(text)) {
        throw new LlmError("AI_UPSTREAM", "녹음 한 조각이 구글이 한 번에 처리하는 길이(약 1분)를 넘었습니다.");
      }
      throw new LlmError("AI_UPSTREAM", "구글 받아쓰기 호출에 실패했습니다.");
    }
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LlmError("AI_UPSTREAM", "구글 응답을 해석하지 못했습니다.");
    }

    const joiner = opts.language === "ja" || opts.language === "zh" ? "" : " ";
    const results: any[] = Array.isArray(json?.results) ? json.results : [];
    const hasLabels = opts.mode === "interview" &&
      results.some((r) => r?.alternatives?.[0]?.words?.some((w: any) => w?.speakerLabel));
    let out: SttResult;
    if (hasLabels) {
      const turns: { speaker: string | null; text: string }[] = [];
      for (const r of results) {
        for (const w of r?.alternatives?.[0]?.words ?? []) {
          const word = String(w?.word ?? "");
          if (!word) continue;
          const sp = w?.speakerLabel != null ? String(w.speakerLabel) : null;
          const last = turns[turns.length - 1];
          if (last && last.speaker === sp) last.text += joiner + word;
          else turns.push({ speaker: sp, text: word });
        }
      }
      out = formatTurns(turns, joiner);
    } else {
      const parts = results.map((r) => String(r?.alternatives?.[0]?.transcript ?? "").trim()).filter(Boolean);
      out = { text: parts.join("\n"), diarized: false };
      if (opts.mode === "interview" && out.text) out.note = "구글이 이 조각에서 화자를 나누지 못해 화자 표시 없이 적었습니다.";
    }
    // 조각 소리가 없는 경우(무음)는 오류가 아니라 빈 글로 돌려준다
    return out;
  }, (r) => r.text.length);
}

// ---------- 이미지 생성 ----------
export const IMAGE_UNSUPPORTED_MESSAGE =
  "이미지 만들기는 Google Gemini 또는 OpenAI 키로만 쓸 수 있습니다. 환경설정에서 공급자를 바꿔 주세요.";
const IMAGE_MODEL_NOT_AVAILABLE =
  "이 계정으로는 이미지 만들기 모델을 쓸 수 없습니다. 내 AI 계정에서 이미지 생성 사용 가능 여부(결제 설정 포함)를 확인해 주세요.";

/** 설명글로 이미지를 만든다. 결과는 { mimeType, base64 } */
export function generateImage(
  cfg: LlmConfig,
  prompt: string,
  log?: AiLogContext,
): Promise<{ mimeType: string; base64: string; model: string }> {
  // 사용 현황 표에는 글쓰기 모델이 아니라 실제로 부른 이미지 모델 이름을 남긴다
  const imageModel = cfg.provider === "gemini"
    ? (Deno.env.get("IMAGE_MODEL_GEMINI") || "gemini-3.1-flash-lite-image")
    : cfg.provider === "openai"
    ? (Deno.env.get("IMAGE_MODEL_OPENAI") || "gpt-image-2.5-flare")
    : cfg.model;
  return withLog(log, { provider: cfg.provider, model: imageModel }, prompt.length, async () => {
    if (cfg.provider === "gemini") {
      const model = imageModel;
      let json: any;
      try {
        json = await postJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          { "x-goog-api-key": cfg.apiKey },
          { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"] } },
          false,
        );
      } catch (e) {
        if (e instanceof LlmError && e.code === "AI_CONFIG_INVALID") throw new LlmError("AI_CONFIG_INVALID", IMAGE_MODEL_NOT_AVAILABLE);
        throw e;
      }
      const part = json?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData?.data || p?.inline_data?.data);
      const d = part?.inlineData || part?.inline_data;
      if (!d?.data) throw new LlmError("AI_UPSTREAM", "이미지가 만들어지지 않았습니다. 설명을 바꿔서 다시 시도해 주세요.");
      return { mimeType: String(d.mimeType || d.mime_type || "image/png"), base64: String(d.data), model };
    }
    if (cfg.provider === "openai") {
      const model = imageModel;
      let json: any;
      try {
        json = await postJson(
          "https://api.openai.com/v1/images/generations",
          { Authorization: `Bearer ${cfg.apiKey}` },
          { model, prompt, size: "1024x1024", n: 1 },
          false,
        );
      } catch (e) {
        if (e instanceof LlmError && e.code === "AI_KEY_INVALID") {
          // 이미지 모델은 별도 인증(조직 확인)이 필요한 경우가 있다
          throw new LlmError("AI_KEY_INVALID", IMAGE_MODEL_NOT_AVAILABLE);
        }
        throw e;
      }
      const b64 = json?.data?.[0]?.b64_json;
      if (!b64) throw new LlmError("AI_UPSTREAM", "이미지가 만들어지지 않았습니다. 설명을 바꿔서 다시 시도해 주세요.");
      return { mimeType: "image/png", base64: String(b64), model };
    }
    throw new LlmError("AI_CONFIG_INVALID", IMAGE_UNSUPPORTED_MESSAGE);
  }, () => 0);
}
