const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { createRecommendation } = require("./ai/deepseek");
const { readExhibitors, selectCandidates } = require("./data/exhibitors");
const { detectFacilityRequest } = require("./data/facility-intent");

const ROOT = path.resolve(__dirname, "..");

function loadEnv() {
  const filename = path.join(ROOT, ".env");
  if (!fs.existsSync(filename)) return;
  for (const sourceLine of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

const PORT = Number(process.env.PORT) || 8765;
const RATE_LIMIT = Math.max(1, Number(process.env.AI_RATE_LIMIT_PER_MINUTE) || 20);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".csv": "text/csv; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};
const rateBuckets = new Map();

function commonHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, commonHeaders("application/json; charset=utf-8"));
  response.end(JSON.stringify(payload));
}

function clientAddress(request) {
  return String(request.socket.remoteAddress || "unknown");
}

function consumeRateLimit(request) {
  const now = Date.now();
  const key = clientAddress(request);
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= 60000) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 32768) {
        const error = new Error("Request body too large");
        error.code = "BODY_TOO_LARGE";
        reject(error);
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        error.code = "INVALID_JSON";
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function fallbackRecommendation(query, candidates) {
  const matched = candidates.filter(item => item.retrievalScore > 0).slice(0, 3);
  return {
    answer: matched.length
      ? `已根据“${query}”进行本地关键词匹配，以下结果可用于界面和导航联调。`
      : "当前演示数据中没有找到足够明确的匹配，请换一个行业或产品关键词。",
    recommendations: matched.map(item => ({
      boothId: item.boothId,
      reason: `展商资料分类为“${item.industry}”，与输入关键词存在匹配。`,
      confidence: "medium"
    })),
    followUpSuggestions: ["新能源汽车", "智能制造", "新材料"]
  };
}

function normalizeRecommendation(result, candidates) {
  const allowed = new Map(candidates.map(item => [item.boothId, item]));
  const seen = new Set();
  const recommendations = [];
  for (const proposed of Array.isArray(result?.recommendations) ? result.recommendations : []) {
    const item = allowed.get(String(proposed?.boothId || ""));
    if (!item || seen.has(item.boothId) || recommendations.length >= 5) continue;
    seen.add(item.boothId);
    recommendations.push({
      exhibitorId: item.exhibitorId,
      boothId: item.boothId,
      boothCode: item.boothCode,
      floor: item.floor,
      hall: item.hall,
      shortName: item.shortName,
      company: item.company,
      industry: item.industry,
      summary: item.summary,
      sourceLevel: item.sourceLevel,
      simulated: item.simulated,
      reason: String(proposed.reason || `与“${item.industry}”相关。`).slice(0, 90),
      confidence: ["high", "medium", "low"].includes(proposed.confidence) ? proposed.confidence : "medium"
    });
  }
  return {
    answer: String(result?.answer || (recommendations.length ? "为你找到以下展商。" : "暂未找到足够相关的展商。" )).slice(0, 240),
    recommendations,
    followUpSuggestions: (Array.isArray(result?.followUpSuggestions) ? result.followUpSuggestions : [])
      .map(value => String(value).slice(0, 24))
      .filter(Boolean)
      .slice(0, 4)
  };
}

async function handleRecommendation(request, response) {
  if (!consumeRateLimit(request)) {
    sendJson(response, 429, { ok: false, code: "RATE_LIMITED", message: "请求过于频繁，请稍后再试。" });
    return;
  }
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, error.code === "BODY_TOO_LARGE" ? 413 : 400, { ok: false, code: error.code || "INVALID_REQUEST", message: "请求内容格式不正确。" });
    return;
  }
  const query = String(body.query || "").trim();
  if (query.length < 2 || query.length > 200) {
    sendJson(response, 400, { ok: false, code: "INVALID_QUERY", message: "请输入 2 到 200 个字符的参观需求。" });
    return;
  }
  const facilityRequest = detectFacilityRequest(query);
  if (facilityRequest) {
    sendJson(response, 200, {
      ok: true,
      mode: "map",
      intent: "facility",
      answer: "已根据当前起点筛选地图中的真实设施，可直接定位或开始导航。",
      facilityRequest,
      recommendations: [],
      followUpSuggestions: []
    });
    return;
  }
  const candidates = selectCandidates(query);
  const apiKey = String(process.env.DEEPSEEK_API_KEY || "").trim();
  let result;
  let mode = "ai";
  let warning = "";
  if (!apiKey) {
    result = fallbackRecommendation(query, candidates);
    mode = "fallback";
    warning = "DeepSeek API Key 尚未配置，当前使用本地关键词匹配。";
  } else {
    try {
      result = await createRecommendation({
        query,
        candidates,
        apiKey,
        baseUrl: process.env.DEEPSEEK_BASE_URL,
        model: process.env.DEEPSEEK_MODEL,
        timeoutMs: process.env.AI_REQUEST_TIMEOUT_MS
      });
    } catch (error) {
      console.error(`[AI] ${error.code || "DEEPSEEK_ERROR"}: ${error.message}`);
      result = fallbackRecommendation(query, candidates);
      mode = "fallback";
      warning = `AI服务暂时不可用，已使用本地匹配（${error.code || "请求失败"}）。`;
    }
  }
  sendJson(response, 200, { ok: true, mode, warning, ...normalizeRecommendation(result, candidates) });
}

function serveStatic(request, response, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (_) {
    response.writeHead(400).end("Bad request");
    return;
  }
  const target = path.resolve(ROOT, `.${decoded}`);
  if (target !== ROOT && !target.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.stat(target, (statError, stat) => {
    const filename = !statError && stat.isDirectory() ? path.join(target, "index.html") : target;
    fs.readFile(filename, (error, data) => {
      if (error) {
        response.writeHead(404, commonHeaders("text/plain; charset=utf-8"));
        response.end("Not found");
        return;
      }
      response.writeHead(200, commonHeaders(types[path.extname(filename).toLowerCase()] || "application/octet-stream"));
      response.end(data);
    });
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      aiConfigured: Boolean(String(process.env.DEEPSEEK_API_KEY || "").trim()),
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      exhibitorCount: readExhibitors().length
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/assistant/recommend") {
    await handleRecommendation(request, response);
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { ok: false, code: "NOT_FOUND", message: "API不存在。" });
    return;
  }
  serveStatic(request, response, url.pathname);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`本机访问：http://127.0.0.1:${PORT}/campus-all.html`);
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) console.log(`手机访问：http://${address.address}:${PORT}/campus-all.html`);
    }
  }
  console.log(process.env.DEEPSEEK_API_KEY ? "AI助手：DeepSeek 已配置" : "AI助手：未配置 Key，使用本地关键词匹配");
});
