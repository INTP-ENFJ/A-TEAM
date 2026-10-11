import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// CORS 헤더 (인증은 Authorization JWT 헤더로 엄격히 수행)
import { loadLlmConfig, callLlm, llmErrorResponse, llmMissingResponse, type LlmConfig } from "../_shared/llm.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-ai-key, x-user-ai-provider, x-user-ai-model, x-user-ai-endpoint",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// analyze-media-image와 동일한 검증된 최신 고속 모델 사용

// 4대 허용 카테고리 화이트리스트
const ALLOWED_CATEGORIES = [
  "spelling",
  "grammar",
  "title_mismatch",
  "style_guide",
] as const;

type AllowedCategory = typeof ALLOWED_CATEGORIES[number];

interface AiReviewRawItem {
  blockId: string;
  sourceText: string;
  category: string;
  subCategory?: string;
  reason?: string;
  checkPoint?: string;
  suggestionExample?: string;
}

interface ValidatedReviewItem {
  blockId: string;
  sourceText: string;
  category: AllowedCategory;
  subCategory: string;
  reason: string;
  checkPoint: string;
  suggestionExample: string;
}

Deno.serve(async (req) => {
  // CORS Preflight 처리
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return Response.json(
        { error: "POST 메서드만 지원합니다." },
        { status: 405, headers: corsHeaders }
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json(
        { error: "인증 토큰이 필요합니다.", code: "UNAUTHORIZED" },
        { status: 401, headers: corsHeaders }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1. 사용자 JWT 인증 확인
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return Response.json(
        { error: "유효하지 않은 사용자 세션입니다.", code: "UNAUTHORIZED" },
        { status: 401, headers: corsHeaders }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 2. 프로필 및 권한 검증 (HR 계정 배제)
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("department, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return Response.json(
        { error: "사용자 프로필을 조회할 수 없습니다.", code: "FORBIDDEN" },
        { status: 403, headers: corsHeaders }
      );
    }

    if (profile.department === "인사부" || profile.role === "hr_admin") {
      return Response.json(
        { error: "인사부 계정은 뉴스룸 기사 AI 검수를 실행할 수 없습니다.", code: "FORBIDDEN" },
        { status: 403, headers: corsHeaders }
      );
    }

    // 3. 요청 본문 파싱 ({ articleId: string })
    let body: { articleId?: string } = {};
    try {
      body = await req.json();
    } catch {
      return Response.json(
        { error: "잘못된 JSON 요청 본문입니다.", code: "INVALID_REQUEST" },
        { status: 400, headers: corsHeaders }
      );
    }

    const { articleId } = body;
    if (!articleId || typeof articleId !== "string") {
      return Response.json(
        { error: "articleId는 필수 문자열입니다.", code: "INVALID_ARTICLE_ID" },
        { status: 400, headers: corsHeaders }
      );
    }

    // 4. 기사 접근 권한 사전 검증 (호출자가 can_access_article 권한을 보유했는지 RPC로 엄격히 검증)
    const { data: hasAccess, error: accessError } = await adminClient
      .rpc("can_access_article", {
        p_article_id: articleId,
        p_uid: user.id,
      });

    if (accessError || !hasAccess) {
      return Response.json(
        { error: "해당 기사에 대한 접근 권한이 없습니다.", code: "FORBIDDEN" },
        { status: 403, headers: corsHeaders }
      );
    }

    // 5. 기사 메타데이터(title, subtitle) 조회
    const { data: articleRow, error: articleError } = await adminClient
      .from("articles")
      .select("id, project_id, title, subtitle, author_id, status, projects!inner(id, owner_id)")
      .eq("id", articleId)
      .single();

    if (articleError || !articleRow) {
      return Response.json(
        { error: "기사를 찾을 수 없습니다.", code: "ARTICLE_NOT_FOUND" },
        { status: 404, headers: corsHeaders }
      );
    }

    // 5. article_blocks에서 paragraph 블록만 position_index 순서로 조회
    const { data: blockRows, error: blocksError } = await adminClient
      .from("article_blocks")
      .select("id, type, text, position_index")
      .eq("article_id", articleId)
      .eq("type", "paragraph")
      .order("position_index", { ascending: true });

    if (blocksError) {
      console.error("[review-article-content] Blocks query error:", blocksError);
      return Response.json(
        { error: "본문 블록을 조회하지 못했습니다.", code: "BLOCKS_FETCH_FAILED" },
        { status: 500, headers: corsHeaders }
      );
    }

    const titleText = (articleRow.title || "").trim();
    const subtitleText = (articleRow.subtitle || "").trim();
    const paragraphBlocks = (blockRows || []).map((b: any) => ({
      id: b.id as string,
      text: (b.text || "").trim(),
    }));

    if (!titleText && paragraphBlocks.length === 0) {
      return Response.json(
        {
          success: true,
          articleId,
          reviews: [],
          message: "검토할 기사 제목 및 본문 내용이 없습니다.",
        },
        { headers: corsHeaders }
      );
    }

    // 6. 개인 AI 키 확인
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

    // 7. PRESS-CMS 기사 작성·표기 가이드라인 및 검수 원칙 주입
    const systemInstruction = `당신은 대한민국 정론 언론사의 뉴스룸 CMS AI 기사 검수 에디터입니다.
기자가 작성하여 저장한 기사의 제목, 부제목, 본문 문단을 정밀하게 대조·분석하여 기자가 참고할 구조화된 검수 항목을 도출하세요.

[핵심 원칙 (절대 준수)]
1. 기자 원문 우선 (수정 금지): AI는 기사를 새로 작성하거나 전체 기사를 재작성(Rewrite)하지 않습니다. 완성본 기사를 반환하지 마세요.
2. 제안 및 참고용 예시 제공: 제안(suggestionExample)은 기자가 참고할 문맥적 예시일 뿐이며 기자의 승인 없이 자동 반영되지 않습니다.
3. [편집 정책 결정 필요] 항목 처리:
   - 복합명사 띄어쓰기(예: '의료 인력' vs '의료인력'), 인명 재언급 호칭('이 총재' vs '이창용 총재' vs '이씨'), 국가명 한자 약칭('韓·美'), 천 단위 쉼표, 백분율 기호(%) 등 사내 편집 정책 결정이 필요한 항목은 절대로 '오류'로 단정하지 마세요.
   - 이러한 항목은 subCategory를 '사내정책확인'으로 지정하고 reason을 '사내 편집 정책 확인 필요'로 온건하게 기술하며, checkPoint를 통해 사내 용어집/편집 방침을 확인하도록 안내하세요.
4. 사실 확인과 낚시성 방지:
   - 제목과 본문 불일치(본문에 없는 내용이 제목에 있거나 수치/인물/기관 불일치)를 엄격히 감지하세요.
   - 확정되지 않은 사안(소위 심사 전, 검토 중)에 대해 '확정', '합의' 등 단정적 어조가 쓰인 경우 '잠정 합의', '가닥' 등으로 완화하도록 안내하세요.
5. 4대 카테고리 분류:
   - "spelling": 한글 맞춤법, 오탈자, 띄어쓰기
   - "grammar": 주어·서술어 불일치, 목적어 누락, 조사 오류, 수식 관계 모호, 지나치게 긴 문장, 시제 불일치, 이중피동, 불필요한 명사화 등
   - "title_mismatch": 제목 내용이 본문에 없음, 인물/기관/수치 불일치, 본문 근거 부족, 단정적 제목 등
   - "style_guide": 외래어 표기, 영문 약칭 최초 한글 병기, 직책 표기 순서, 숫자(만/억/조), 날짜(한글 표기), 시간(12시간제), 통화 한글 표기, 인용부호 등

[입력 데이터 구조]
- 제목 ID: "title"
- 부제목 ID: "subtitle"
- 본문 문단 ID: 각 문단에 부여된 고유 블록 ID (예: "blk_...")

[JSON 출력 스키마]
반드시 마크다운 코드블록(\`\`\`json)이나 부가 텍스트 없이 오직 순수한 단일 JSON 객체만 반환하세요:
{
  "reviews": [
    {
      "blockId": "문제 문장이 위치한 블록 ID (title, subtitle 또는 본문 블록 ID)",
      "sourceText": "문제가 발견된 원문의 정확한 구절 (최대 100자 이내)",
      "category": "spelling" | "grammar" | "title_mismatch" | "style_guide",
      "subCategory": "세부 유형명 (예: '주어·서술어 불일치', '영문 약칭', '사내정책확인' 등)",
      "reason": "가이드라인에 의거한 구체적인 문제 이유",
      "checkPoint": "기자가 취재 수첩이나 팩트를 재확인해야 할 핵심 포인트",
      "suggestionExample": "가이드라인에 부합하는 참고용 수정 예시 (선택)"
    }
  ]
}`;

    // 기사 콘텐츠 프롬프트 구성 (불필요한 미디어 메타 제외)
    let articleContentPrompt = `[검토 대상 기사]\n제목 (blockId: "title"): ${titleText}\n`;
    if (subtitleText) {
      articleContentPrompt += `부제목 (blockId: "subtitle"): ${subtitleText}\n`;
    }
    articleContentPrompt += `\n[본문 문단 목록]\n`;
    for (const p of paragraphBlocks) {
      articleContentPrompt += `문단 (blockId: "${p.id}"):\n${p.text}\n\n`;
    }

    // 사용자가 고른 공급자·모델로 호출 (Gemini / OpenAI / Anthropic / 사내 API)
    const rawContent = await callLlm(llmCfg, {
      log: { admin: adminClient, userId: user.id, fn: "review-article-content" },
      system: systemInstruction,
      user: articleContentPrompt,
      maxTokens: 8192,
      temperature: 0.1,
    });

    // 8. Runtime Schema Validation (신뢰할 수 없는 AI 응답 정밀 검증)
    let parsedJson: any;
    try {
      parsedJson = JSON.parse(rawContent.trim());
    } catch {
      console.error("[review-article-content] JSON parse failed:", rawContent);
      throw new Error("AI 응답을 JSON 형식으로 해석하지 못했습니다.");
    }

    const rawReviews: AiReviewRawItem[] = Array.isArray(parsedJson.reviews)
      ? parsedJson.reviews
      : Array.isArray(parsedJson)
      ? parsedJson
      : [];

    // 유효 블록 맵 (blockId -> text)
    const validBlockMap = new Map<string, string>();
    if (titleText) validBlockMap.set("title", titleText);
    if (subtitleText) validBlockMap.set("subtitle", subtitleText);
    for (const b of paragraphBlocks) {
      validBlockMap.set(b.id, b.text);
    }

    const validatedReviews: ValidatedReviewItem[] = [];

    for (const item of rawReviews) {
      if (!item || typeof item !== "object") continue;

      // 1) blockId 검증
      let targetBlockId = typeof item.blockId === "string" ? item.blockId.trim() : "";
      if (!validBlockMap.has(targetBlockId)) {
        // blockId가 매핑되지 않았을 때 제목 관련 카테고리면 'title'로 보정, 아니면 스킵
        if (item.category === "title_mismatch") {
          targetBlockId = "title";
        } else {
          continue;
        }
      }

      // 2) category 화이트리스트 검증
      let targetCategory: AllowedCategory | null = null;
      if (typeof item.category === "string" && ALLOWED_CATEGORIES.includes(item.category as AllowedCategory)) {
        targetCategory = item.category as AllowedCategory;
      } else {
        targetCategory = "grammar";
      }

      // 3) sourceText 검증
      const blockText = validBlockMap.get(targetBlockId) || "";
      let targetSourceText = typeof item.sourceText === "string" ? item.sourceText.trim() : "";
      if (!targetSourceText) {
        // sourceText가 누락된 경우 블록 첫 부분 50자로 완화
        targetSourceText = blockText.slice(0, 50);
      }

      // 4) subCategory, reason, checkPoint, suggestionExample 정제 및 길이 제한
      const subCategory = (typeof item.subCategory === "string" ? item.subCategory.trim() : "일반 검토")
        .slice(0, 50);

      const reason = (typeof item.reason === "string" ? item.reason.trim() : "기사 작성 가이드라인 확인 필요")
        .slice(0, 500);

      const checkPoint = (typeof item.checkPoint === "string" ? item.checkPoint.trim() : "해당 문맥의 팩트와 표현을 확인하세요.")
        .slice(0, 500);

      const suggestionExample = (typeof item.suggestionExample === "string" ? item.suggestionExample.trim() : "")
        .slice(0, 500);

      validatedReviews.push({
        blockId: targetBlockId,
        sourceText: targetSourceText.slice(0, 300),
        category: targetCategory,
        subCategory,
        reason,
        checkPoint,
        suggestionExample,
      });

      // 안전을 위해 최대 30개 검수 항목 제한
      if (validatedReviews.length >= 30) {
        break;
      }
    }

    return Response.json(
      {
        success: true,
        articleId,
        model: llmCfg.model,
        reviews: validatedReviews,
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    console.error("[review-article-content] Execution error:", err?.message || err);

    const llmResp = llmErrorResponse(err, corsHeaders);
    if (llmResp) return llmResp;

    // API 키나 내부 스택을 클라이언트에 노출하지 않고 정제된 에러 반환
    return Response.json(
      {
        error: "AI 기사 검수 처리에 실패했습니다. 잠시 후 다시 시도해주세요.",
        code: "REVIEW_FAILED",
      },
      { status: 500, headers: corsHeaders }
    );
  }
});
