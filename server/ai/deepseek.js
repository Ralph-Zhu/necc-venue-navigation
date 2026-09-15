const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";

function stripJsonFence(content) {
  return String(content || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

async function createRecommendation({ query, candidates, apiKey, baseUrl, model, timeoutMs }) {
  const allowed = candidates.map(item => ({
    boothId: item.boothId,
    boothCode: item.boothCode,
    floor: item.floor,
    hall: item.hall,
    company: item.company,
    shortName: item.shortName,
    industry: item.industry,
    products: item.products,
    summary: item.summary,
    sourceLevel: item.sourceLevel
  }));
  const system = [
    "你是国家会展中心的观展推荐助手。",
    "只能从给定候选展商中推荐，不得编造展商、展位号、产品或本届展品。",
    "企业简介只代表现有资料，不能把一般业务描述成已确认的本届展品。",
    "推荐 1 到 5 个真正相关的候选；没有足够相关结果时应明确说明，不要凑数。",
    "reason 控制在 45 个汉字以内。answer 控制在 90 个汉字以内。",
    "必须只输出合法 json 对象，不要输出 Markdown。",
    "json 格式：{\"answer\":\"回答\",\"recommendations\":[{\"boothId\":\"候选中的完整 boothId\",\"reason\":\"推荐理由\",\"confidence\":\"high|medium|low\"}],\"followUpSuggestions\":[\"追问建议\"]}"
  ].join("\n");
  const endpoint = `${String(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `游客需求：${query}\n\n候选展商 JSON：\n${JSON.stringify(allowed)}` }
      ],
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 1200,
      stream: false
    }),
    signal: AbortSignal.timeout(Number(timeoutMs) || 25000)
  });
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`DeepSeek request failed (${response.status})`);
    error.code = `DEEPSEEK_${response.status}`;
    error.detail = detail.slice(0, 400);
    throw error;
  }
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    const error = new Error("DeepSeek returned empty content");
    error.code = "DEEPSEEK_EMPTY";
    throw error;
  }
  try {
    return JSON.parse(stripJsonFence(content));
  } catch (cause) {
    const error = new Error("DeepSeek returned invalid JSON");
    error.code = "DEEPSEEK_INVALID_JSON";
    error.cause = cause;
    throw error;
  }
}

module.exports = { createRecommendation };
