const fs = require("fs");
const path = require("path");

const BOOTH_FILE = path.resolve(__dirname, "..", "..", "assets", "booths-1.1.json");

const INTENT_TERMS = [
  { pattern: /新能源|电池|储能|充电|电驱|汽车/, terms: ["新能源汽车", "新能源", "电池", "储能", "充电", "汽车"] },
  { pattern: /智能制造|制造|工业|自动化|机器人|机械/, terms: ["智能制造", "制造", "工业", "自动化", "机器人", "机械"] },
  { pattern: /材料|复合材料|金属|化工/, terms: ["新材料", "材料", "复合材料", "金属", "化工"] },
  { pattern: /医疗|医药|健康|器械|生物/, terms: ["医疗科技", "医疗", "医药", "健康", "器械", "生物"] },
  { pattern: /数字|软件|人工智能|AI|数据|云|芯片/i, terms: ["数字技术", "软件", "人工智能", "AI", "数据", "云", "芯片"] }
];

let cache = { modifiedAt: 0, exhibitors: [] };

function readExhibitors() {
  const modifiedAt = fs.statSync(BOOTH_FILE).mtimeMs;
  if (cache.modifiedAt === modifiedAt) return cache.exhibitors;
  const payload = JSON.parse(fs.readFileSync(BOOTH_FILE, "utf8"));
  cache = {
    modifiedAt,
    exhibitors: payload.booths.map((booth, index) => ({
      exhibitorId: `SIM-1.1-${String(index + 1).padStart(3, "0")}`,
      boothId: `F1:1.1:booth:${booth.code}`,
      boothCode: booth.code,
      floor: booth.floor || "F1",
      hall: booth.hall || "1.1",
      shortName: booth.shortName || booth.company || booth.code,
      company: booth.company || booth.shortName || booth.code,
      industry: booth.industry || "未分类",
      products: booth.products || [],
      summary: booth.intro || "暂无企业简介。",
      sourceLevel: booth.sourceLevel || "demo",
      simulated: payload.simulated !== false
    }))
  };
  return cache.exhibitors;
}

function queryTerms(query) {
  const value = String(query || "").trim();
  const terms = new Set(
    value
      .split(/[\s,，。；;、/]+/)
      .map(term => term.trim())
      .filter(term => term.length >= 2 && !/^(我想|我要|看看|参观|推荐|相关|企业|展位|展商)$/.test(term))
  );
  for (const rule of INTENT_TERMS) {
    if (rule.pattern.test(value)) rule.terms.forEach(term => terms.add(term));
  }
  return [...terms];
}

function selectCandidates(query, limit = 24) {
  const exhibitors = readExhibitors();
  const terms = queryTerms(query);
  const ranked = exhibitors.map((item, index) => {
    const searchable = `${item.company} ${item.shortName} ${item.industry} ${item.products.join(" ")} ${item.summary}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const normalized = term.toLowerCase();
      if (item.industry.toLowerCase().includes(normalized)) score += 10;
      if (item.company.toLowerCase().includes(normalized) || item.shortName.toLowerCase().includes(normalized)) score += 7;
      if (searchable.includes(normalized)) score += 4;
    }
    return { item, score, index };
  });
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.slice(0, limit).map(entry => ({ ...entry.item, retrievalScore: entry.score }));
}

module.exports = { readExhibitors, selectCandidates };
