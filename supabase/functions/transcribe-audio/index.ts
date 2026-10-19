import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// 취재 녹음 파일을 글자로 받아 적는 서버 기능 (내 Gemini / OpenAI / 구글 클라우드 키 사용)
// - 언어(한국어·영어·일본어·중국어)와 발표/인터뷰(화자 구분) 방식을 고를 수 있습니다.
// - 녹음 파일은 저장하지 않고, 받아 적은 글만 돌려줍니다.
import {
  loadLlmConfig, loadProviderKey, transcribeAudio, transcribeGoogleCloud, sanitizeSttOptions,
  llmErrorResponse, llmMissingResponse, LLM_CORS_HEADERS, AUDIO_MIME, LLM_MISSING_MESSAGE,
  STT_UNSUPPORTED_MESSAGE, STT_ENGINES, LlmError, type LlmConfig, type SttEngine, type SttResult,
} from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": LLM_CORS_HEADERS,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const fail = (error: string, status = 400) => Response.json({ success: false, error }, { status, headers: corsHeaders });

  try {
    if (req.method !== "POST") return fail("POST 메서드만 지원합니다.", 405);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("인증 토큰이 필요합니다.", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return fail("유효하지 않은 사용자 세션입니다.", 401);

    // 승인 대기 계정은 서버에서 막는다 (본인이 바꿀 수 없는 app_metadata 기준)
    if ((user.app_metadata as Record<string, unknown> | undefined)?.approval === "pending") {
      return Response.json(
        { success: false, error: "인사부 승인 후에 사용할 수 있습니다.", code: "PENDING_APPROVAL" },
        { status: 403, headers: corsHeaders }
      );
    }

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: profile } = await admin.from("profiles").select("department, role").eq("id", user.id).single();
    if (!profile || profile.department === "인사부" || profile.role === "hr_admin") {
      return fail("이 계정은 녹음 변환을 사용할 수 없습니다.", 403);
    }

    let body: { fileName?: string; audioBase64?: string; engine?: string; language?: string; mode?: string; speakers?: number } = {};
    try { body = await req.json(); } catch { return fail("잘못된 요청입니다."); }

    const ext = (String(body.fileName || "").split(".").pop() || "").toLowerCase();
    const mimeType = AUDIO_MIME[ext];
    if (!mimeType) return fail("MP3, M4A, WAV, AAC, OGG, FLAC, WEBM 녹음 파일만 변환할 수 있습니다.");

    const base64 = String(body.audioBase64 || "").replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length < 100) return fail("녹음 파일을 읽지 못했습니다.");
    const approxBytes = Math.floor((base64.length * 3) / 4);
    if (approxBytes > MAX_AUDIO_BYTES) return fail("녹음 파일이 너무 큽니다. 10MB 이하로 줄이거나 나눠서 올려 주세요.");

    const opts = sanitizeSttOptions(body);
    const wanted = STT_ENGINES.includes(body.engine as SttEngine) ? (body.engine as SttEngine) : null;

    let result: SttResult;
    let engine: SttEngine;
    try {
      if (wanted === "googlecloud") {
        engine = "googlecloud";
        const saJson = await loadProviderKey(admin, user.id, "googlecloud");
        if (!saJson) {
          return Response.json(
            { success: false, error: "구글 클라우드 키가 등록되지 않았습니다. 환경설정의 AI 서비스 설정에서 등록해 주세요.", code: "CONFIG_ERROR" },
            { status: 400, headers: corsHeaders },
          );
        }
        result = await transcribeGoogleCloud(saJson, { base64 }, opts, { admin, userId: user.id, fn: "transcribe-audio" });
      } else {
        // 엔진을 따로 고르지 않으면 현재 쓰는 공급자를 따른다. 고르면 그 공급자의 키를 쓴다
        let llmCfg: LlmConfig | null;
        if (wanted) {
          const key = await loadProviderKey(admin, user.id, wanted);
          if (!key) {
            return Response.json(
              { success: false, error: LLM_MISSING_MESSAGE, code: "CONFIG_ERROR" },
              { status: 400, headers: corsHeaders },
            );
          }
          // 받아쓰기 모델은 글쓰기 모델과 따로 쓴다 (글쓰기 모델이 막혀도 받아쓰기는 되도록)
          llmCfg = { provider: wanted, apiKey: key, model: wanted === "gemini" ? (opts.model || "gemini-3.8-flash") : (opts.model || "whisper-1") };
        } else {
          llmCfg = await loadLlmConfig(admin, user.id);
          if (!llmCfg) return llmMissingResponse(corsHeaders);
        }
        if (llmCfg.provider !== "gemini" && llmCfg.provider !== "openai") {
          return Response.json({ success: false, error: STT_UNSUPPORTED_MESSAGE, code: "AI_CONFIG_INVALID" }, { status: 400, headers: corsHeaders });
        }
        if (!wanted && llmCfg.provider === "gemini" && opts.model) llmCfg.model = opts.model;
        engine = llmCfg.provider;
        let bytes: Uint8Array<ArrayBuffer> | null = null;
        if (llmCfg.provider === "openai") {
          const bin = atob(base64);
          bytes = new Uint8Array(new ArrayBuffer(bin.length));
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        }
        result = await transcribeAudio(llmCfg, { mimeType, base64, bytes }, opts, { admin, userId: user.id, fn: "transcribe-audio" });
      }
    } catch (e) {
      const known = llmErrorResponse(e, corsHeaders);
      if (known) return known;
      if (e instanceof LlmError) return fail(e.message, 502);
      console.error("[transcribe-audio] failed:", (e as Error)?.message);
      return fail("녹음을 글자로 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.", 502);
    }

    return Response.json(
      { success: true, data: { text: result.text.slice(0, 60000), chars: result.text.length, provider: engine, diarized: result.diarized, note: result.note ?? null } },
      { headers: corsHeaders },
    );
  } catch (e) {
    console.error("[transcribe-audio] error", (e as Error)?.name);
    return Response.json({ success: false, error: "처리 중 오류가 발생했습니다." }, { status: 500, headers: corsHeaders });
  }
});
