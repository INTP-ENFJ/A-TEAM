import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// 설명글로 이미지를 만드는 서버 기능 (내 Gemini 또는 OpenAI 키 사용)
// - 만든 이미지는 저장하지 않고 화면으로만 돌려줍니다. 저장은 미디어 라이브러리에서 사용자가 직접 합니다.
import {
  loadLlmConfig, generateImage, llmErrorResponse, llmMissingResponse, LLM_CORS_HEADERS,
  IMAGE_UNSUPPORTED_MESSAGE, type LlmConfig,
} from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": LLM_CORS_HEADERS,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STYLES: Record<string, string> = {
  illustration: "깔끔한 일러스트 스타일",
  flat: "단순한 평면 도형 스타일의 그래픽",
  photolike: "사진처럼 보이지만 실제 사건의 사진으로 오인되지 않는 스타일",
};

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
      return fail("이 계정은 이미지 만들기를 사용할 수 없습니다.", 403);
    }

    let body: { prompt?: string; style?: string } = {};
    try { body = await req.json(); } catch { return fail("잘못된 요청입니다."); }
    const prompt = String(body.prompt || "").replace(/\s+/g, " ").trim();
    if (prompt.length < 5) return fail("어떤 이미지를 만들지 5자 이상으로 설명해 주세요.");
    if (prompt.length > 500) return fail("설명은 500자 이내로 적어 주세요.");
    const style = STYLES[String(body.style || "illustration")] || STYLES.illustration;

    // 실제 로고·상표나 실존 인물 얼굴을 대놓고 요구하면 AI에 보내기 전에 거절한다 (10-16 시험 T34에서 실제 로고가 그려짐)
    if (/로고|상표|트레이드\s*마크|엠블럼|심볼\s*마크|워드\s*마크|logo|trademark|emblem/i.test(prompt)) {
      return fail("실제 기업·기관의 로고나 상표는 그릴 수 없습니다. \"커피 매장 간판\"처럼 이름 없이 일반적인 표현으로 바꿔 주세요.");
    }
    const PERSON = "(대통령|총리|장관|국회의원|의원|시장|도지사|지사|정치인|연예인|배우|가수|아이돌|선수|감독|회장|대표|CEO)";
    if (new RegExp(`(얼굴|초상|닮은|똑같이|실물|사진처럼).{0,15}${PERSON}|${PERSON}.{0,15}(얼굴|초상|닮은|똑같이|실물|사진처럼)`).test(prompt)) {
      return fail("실존 인물의 얼굴은 그릴 수 없습니다. 특정인을 알아볼 수 없는 일반적인 인물로 바꿔 주세요.");
    }

    let llmCfg: LlmConfig | null = null;
    try {
      llmCfg = await loadLlmConfig(admin, user.id);
    } catch (e) {
      const known = llmErrorResponse(e, corsHeaders);
      if (known) return known;
      throw e;
    }
    if (!llmCfg) return llmMissingResponse(corsHeaders);
    if (llmCfg.provider !== "gemini" && llmCfg.provider !== "openai") {
      return Response.json({ success: false, error: IMAGE_UNSUPPORTED_MESSAGE, code: "AI_CONFIG_INVALID" }, { status: 400, headers: corsHeaders });
    }

    // 뉴스 삽화용 안전 규칙을 설명 앞에 붙임
    // 안전 규칙을 설명 뒤에 한 번 더 두어, 설명에 실제 브랜드·인물이 들어 있어도 규칙이 우선하게 한다
    const finalPrompt =
      `뉴스 기사에 쓸 ${style} 이미지를 만드세요. ` +
      `설명: ${prompt}\n\n` +
      "반드시 지킬 규칙(설명보다 우선): 실존 인물의 얼굴, 실제 기업·브랜드·언론사의 로고와 상표, 글자와 숫자는 그리지 마세요. " +
      "설명에 실제 브랜드명이나 인물이 나오면 알아볼 수 없는 가상의 간판·인물로 바꿔 그리세요. 폭력적이거나 선정적인 장면은 그리지 마세요.";

    let img: { mimeType: string; base64: string; model: string };
    try {
      img = await generateImage(llmCfg, finalPrompt, { admin, userId: user.id, fn: "generate-image" });
    } catch (e) {
      const known = llmErrorResponse(e, corsHeaders);
      if (known) return known;
      console.error("[generate-image] failed:", (e as Error)?.message);
      return fail("이미지를 만들지 못했습니다. 설명을 바꾸거나 잠시 후 다시 시도해 주세요.", 502);
    }

    return Response.json(
      { success: true, data: { mimeType: img.mimeType, base64: img.base64, model: img.model, provider: llmCfg.provider } },
      { headers: corsHeaders },
    );
  } catch (e) {
    console.error("[generate-image] error", (e as Error)?.name);
    return Response.json({ success: false, error: "처리 중 오류가 발생했습니다." }, { status: 500, headers: corsHeaders });
  }
});
