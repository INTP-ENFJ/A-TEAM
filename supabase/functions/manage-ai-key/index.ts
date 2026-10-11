import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  LLM_CORS_HEADERS,
  KEY_PROVIDERS,
  parseGoogleServiceAccount,
  testGoogleCloudKey,
  loadProviderKey,
  encryptKey,
  isValidKeyFormat,
  sanitizeEndpoint,
  sanitizeModel,
  testLlmKey,
  LlmError,
  type LlmProvider,
  type KeyProvider,
} from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": LLM_CORS_HEADERS,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function fail(error: string, status = 400, code = "BAD_REQUEST"): Response {
  return Response.json({ success: false, error, code }, { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("POST 메서드만 지원합니다.", 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("인증 토큰이 필요합니다.", 401, "UNAUTHORIZED");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return fail("유효하지 않은 사용자 세션입니다.", 401, "UNAUTHORIZED");
    const admin = createClient(supabaseUrl, serviceKey);

    let body: any;
    try {
      body = await req.json();
    } catch {
      return fail("잘못된 요청입니다.");
    }
    const action = String(body?.action || "");

    const readProvider = (): KeyProvider | null => {
      const p = String(body?.provider || "").toLowerCase() as KeyProvider;
      return KEY_PROVIDERS.includes(p) ? p : null;
    };

    // 현재 설정과 등록 현황 (키 원문은 절대 돌려주지 않음)
    const status = async () => {
      const { data: prefs } = await admin
        .from("user_ai_prefs")
        .select("provider, model, endpoint")
        .eq("user_id", user.id)
        .maybeSingle();
      const { data: keys } = await admin
        .from("user_ai_keys")
        .select("provider, key_last4")
        .eq("user_id", user.id);
      const registered: Record<string, string> = {};
      for (const k of keys || []) registered[k.provider] = k.key_last4;
      return {
        prefs: prefs ? { provider: prefs.provider, model: prefs.model || "", endpoint: prefs.endpoint || "" } : null,
        keys: registered,
      };
    };

    const savePrefs = async (provider: LlmProvider, model: unknown, endpoint: unknown): Promise<string | null> => {
      let ep: string | null = null;
      if (provider === "custom") {
        ep = sanitizeEndpoint(endpoint);
        if (!ep) return "사내 API 주소는 https:// 로 시작하는 공개 주소여야 합니다.";
      }
      const { error } = await admin.from("user_ai_prefs").upsert({
        user_id: user.id,
        provider,
        model: sanitizeModel(provider, model),
        endpoint: ep,
        updated_at: new Date().toISOString(),
      });
      if (error) {
        console.error("[manage-ai-key] prefs save failed:", error.code);
        return "설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      }
      return null;
    };

    if (action === "status") {
      return Response.json({ success: true, ...(await status()) }, { headers: corsHeaders });
    }

    const provider = readProvider();
    if (!provider) return fail("지원하지 않는 AI 서비스입니다.");

    if (action === "save_prefs") {
      // 구글 클라우드는 받아쓰기 전용이라 '현재 쓰는 AI'로 고를 수 없다
      if (provider === "googlecloud") return fail("구글 클라우드는 받아쓰기 전용 키라 공급자로 고를 수 없습니다.");
      const err = await savePrefs(provider, body?.model, body?.endpoint);
      if (err) return fail(err);
      return Response.json({ success: true, ...(await status()) }, { headers: corsHeaders });
    }

    if (action === "delete_key") {
      await admin.from("user_ai_keys").delete().eq("user_id", user.id).eq("provider", provider);
      return Response.json({ success: true, ...(await status()) }, { headers: corsHeaders });
    }

    if (action === "save_key" || action === "test_key") {
      let key = typeof body?.key === "string" ? body.key.trim() : "";
      if (action === "test_key" && !key) {
        // 입력 없이 확인: 이미 저장된 키로 확인
        const stored = await loadProviderKey(admin, user.id, provider);
        if (!stored) return fail("등록된 키가 없습니다.");
        key = stored;
      }
      if (provider === "googlecloud") {
        const sa = parseGoogleServiceAccount(key);
        if (!sa) return fail("서비스 계정 키(JSON 파일 내용 전체)가 아닙니다. 파일을 메모장으로 열어 전체를 복사해 붙여 넣어 주세요.");
        const gcheck = await testGoogleCloudKey(key);
        if (!gcheck.ok) return fail(gcheck.message, 400, "AI_KEY_INVALID");
        if (action === "test_key") {
          return Response.json({ success: true, message: gcheck.message, unverified: true }, { headers: corsHeaders });
        }
        const g = await encryptKey(key);
        const { error: gerr } = await admin.from("user_ai_keys").upsert({
          user_id: user.id,
          provider,
          key_cipher: g.cipher,
          key_iv: g.iv,
          // 화면에 보여 줄 끝 4자리는 프로젝트 이름 끝부분을 쓴다 (키 원문 일부가 아님)
          key_last4: sa.projectId.slice(-4),
          updated_at: new Date().toISOString(),
        });
        if (gerr) {
          console.error("[manage-ai-key] key save failed:", gerr.code);
          return fail("키를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500, "SERVER_ERROR");
        }
        return Response.json({ success: true, message: gcheck.message, unverified: true, ...(await status()) }, { headers: corsHeaders });
      }
      if (!isValidKeyFormat(provider, key)) {
        return fail("키 형식이 올바르지 않습니다. 복사한 키를 그대로 붙여 넣어 주세요.");
      }
      let endpoint: string | undefined;
      if (provider === "custom") {
        const ep = sanitizeEndpoint(body?.endpoint);
        if (!ep) return fail("사내 API 주소는 https:// 로 시작하는 공개 주소여야 합니다.");
        endpoint = ep;
      }
      const check = await testLlmKey(provider, key, endpoint);
      if (!check.ok) return fail(check.message, 400, "AI_KEY_INVALID");

      if (action === "test_key") {
        return Response.json({ success: true, message: check.message, unverified: !!check.unverified }, { headers: corsHeaders });
      }

      const { cipher, iv } = await encryptKey(key);
      const { error } = await admin.from("user_ai_keys").upsert({
        user_id: user.id,
        provider,
        key_cipher: cipher,
        key_iv: iv,
        key_last4: key.slice(-4),
        updated_at: new Date().toISOString(),
      });
      if (error) {
        console.error("[manage-ai-key] key save failed:", error.code);
        return fail("키를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500, "SERVER_ERROR");
      }
      // 이 키를 쓰도록 공급자·모델도 함께 저장
      const perr = await savePrefs(provider, body?.model, body?.endpoint);
      if (perr) return fail(perr);
      return Response.json(
        { success: true, message: check.message, unverified: !!check.unverified, ...(await status()) },
        { headers: corsHeaders },
      );
    }

    return fail("알 수 없는 요청입니다.");
  } catch (err) {
    if (err instanceof LlmError) {
      return Response.json({ success: false, error: err.message, code: err.code }, { status: 400, headers: corsHeaders });
    }
    console.error("[manage-ai-key] unexpected error:", (err as Error)?.name);
    return fail("처리 중 오류가 발생했습니다.", 500, "SERVER_ERROR");
  }
});
