const FACILITY_RULES = [
  { type: "accessible", pattern: /无障碍(?:卫生间|厕所)|accessible/i },
  { type: "female", pattern: /女(?:卫生间|厕所|洗手间)|女士洗手间|women(?:'s)?\s*(?:room|toilet)/i },
  { type: "male", pattern: /男(?:卫生间|厕所|洗手间)|男士洗手间|men(?:'s)?\s*(?:room|toilet)/i },
  { type: "elevator", pattern: /电梯|升降梯|直梯|lift|elevator/i },
  { type: "escalator", pattern: /扶梯|自动扶梯|escalator/i },
  { type: "stairs", pattern: /楼梯|步梯|安全梯|stairs?/i },
  { type: "door", pattern: /出入口|入口|出口|门口|大门|\d+\s*号门|entrance|exit/i }
];

function detectFacilityRequest(query) {
  const value = String(query || "").trim();
  const types = FACILITY_RULES.filter(rule => rule.pattern.test(value)).map(rule => rule.type);
  const genericToilet = /厕所|卫生间|洗手间|方便一下|方便的地方|restroom|toilet/i.test(value);
  if (genericToilet && !types.some(type => ["male", "female", "accessible"].includes(type))) {
    types.push("female", "male", "accessible");
  }
  if (!types.length) return null;

  const hallMatch = value.match(/(?:^|[^\d])([1-8])\s*[.．]\s*([12])\s*号?馆/) || value.match(/\b(NH)\s*馆?/i);
  const hall = hallMatch ? (hallMatch[1].toUpperCase() === "NH" ? "NH" : `${hallMatch[1]}.${hallMatch[2]}`) : "";
  let floor = "";
  if (/\bF1\b|一层|一楼/i.test(value)) floor = "F1";
  if (/\bF3\b|三层|三楼/i.test(value)) floor = "F3";
  if (hall && !floor) floor = hall === "NH" || hall.endsWith(".1") ? "F1" : "F3";

  return {
    types: [...new Set(types)],
    floor,
    hall,
    nearest: /最近|附近|就近|离我近|nearest|nearby/i.test(value) || !hall,
    limit: 5
  };
}

module.exports = { detectFacilityRequest };
