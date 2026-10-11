import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// 기사 속 숫자를 뽑아 인포그래픽(그림) 재료로 돌려주는 서버 기능
// - 기사를 고치거나 저장하지 않고, 읽기만 합니다.
import { loadLlmConfig, callLlm, llmErrorResponse, llmMissingResponse, type LlmConfig } from "../_shared/llm.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-ai-key, x-user-ai-provider, x-user-ai-model, x-user-ai-endpoint",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") {
      return Response.json({ success: false, error: "POST 메서드만 지원합니다." }, { status: 405, headers: corsHeaders });
    }
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json({ success: false, error: "인증 토큰이 필요합니다." }, { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return Response.json({ success: false, error: "유효하지 않은 사용자 세션입니다." }, { status: 401, headers: corsHeaders });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await adminClient.from("profiles").select("department, role").eq("id", user.id).single();
    if (!profile || profile.department === "인사부" || profile.role === "hr_admin") {
      return Response.json({ success: false, error: "이 계정은 인포그래픽을 만들 수 없습니다." }, { status: 403, headers: corsHeaders });
    }

    let body: { title?: string; text?: string } = {};
    try { body = await req.json(); } catch {
      return Response.json({ success: false, error: "잘못된 요청입니다." }, { status: 400, headers: corsHeaders });
    }
    const title = String(body.title || "").slice(0, 200);
    const text = String(body.text || "").slice(0, 20000);
    if (text.trim().length < 20) {
      return Response.json({ success: false, error: "기사 본문이 너무 짧습니다." }, { status: 400, headers: corsHeaders });
    }
    // 개인 AI 설정: 계정에 암호화되어 저장된 공급자·키·모델을 읽는다
    let llmCfg: LlmConfig | null = null;
    try {
      llmCfg = await loadLlmConfig(adminClient, user.id);
    } catch (e) {
      const known = llmErrorResponse(e, corsHeaders);
      if (known) return known;
      throw e;
    }
    if (!llmCfg) {
      return llmMissingResponse(corsHeaders);
    }

    const instruction = `당신은 뉴스룸의 인포그래픽 담당 에디터입니다.
기사 본문에 "실제로 적혀 있는" 숫자만 뽑아 한 장짜리 차트의 재료를 만드세요.

[규칙]
1. 본문에 없는 숫자를 만들거나 계산해서 새로 만들지 마세요. 추정·반올림 금지.
2. 한 차트에는 같은 단위의 숫자만 담으세요. 가장 중요하고 비교 가능한 한 묶음을 고르세요.
3. 항목은 2~6개. 이름표(label)는 12자 이내의 짧은 한국어로.
4. 단위(unit)는 '%', '명', '억 원' 같은 짧은 표기. 단위가 없으면 빈 문자열.
5. 차트 제목(title)은 40자 이내의 중립적인 문장. 과장·단정 금지.
6. 비교할 만한 숫자가 2개 미만이면 items를 빈 배열로 돌려주세요.
7. 반드시 JSON만 출력: {"title": string, "unit": string, "items": [{"label": string, "value": number}]}`;

    // 사용자가 고른 공급자·모델로 호출 (Gemini / OpenAI / Anthropic / 사내 API)
    let raw: string;
    try {
      raw = await callLlm(llmCfg, {
        log: { admin: adminClient, userId: user.id, fn: "extract-infographic-data" },
        system: instruction,
        user: `[기사 제목]\n${title}\n\n[기사 본문]\n${text}`,
        maxTokens: 2048,
        temperature: 0.1,
      });
    } catch (e) {
      const known = llmErrorResponse(e, corsHeaders);
      if (known) return known;
      console.error("[extract-infographic-data] AI call failed:", (e as Error)?.message);
      return Response.json({ success: false, error: "AI 호출에 실패했습니다." }, { status: 502, headers: corsHeaders });
    }
    let parsed: any;
    try { parsed = JSON.parse(String(raw).trim()); } catch {
      return Response.json({ success: false, error: "AI 응답을 해석하지 못했습니다." }, { status: 502, headers: corsHeaders });
    }

    // 검증: 본문에 실제로 있는 숫자만 통과 (AI가 지어낸 숫자 차단)
    const plain = text.replace(/,/g, "");
    const items = (Array.isArray(parsed?.items) ? parsed.items : [])
      .map((i: any) => ({ label: String(i?.label ?? "").slice(0, 20), value: Number(i?.value) }))
      .filter((i: any) => i.label && Number.isFinite(i.value) && plain.includes(String(i.value)))
      .slice(0, 6);

    return Response.json(
      { success: true, data: { title: String(parsed?.title || title).slice(0, 60), unit: String(parsed?.unit ?? "").slice(0, 10), items } },
      { headers: corsHeaders },
    );
  } catch (e) {
    console.error("[extract-infographic-data] error", e);
    return Response.json({ success: false, error: "처리 중 오류가 발생했습니다." }, { status: 500, headers: corsHeaders });
  }
});
