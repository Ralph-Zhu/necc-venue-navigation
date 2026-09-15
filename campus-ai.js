(() => {
  const stage = document.querySelector("#mapStage");
  const launcher = document.querySelector("#aiAssistantLauncher");
  const panel = document.querySelector("#aiAssistantPanel");
  const closeButton = document.querySelector("#aiAssistantClose");
  const form = document.querySelector("#aiAssistantForm");
  const input = document.querySelector("#aiAssistantInput");
  const sendButton = document.querySelector("#aiAssistantSend");
  const answer = document.querySelector("#aiAssistantAnswer");
  const results = document.querySelector("#aiAssistantResults");
  const status = document.querySelector("#aiAssistantStatus");
  const connection = document.querySelector("#aiAssistantConnection");
  if (!stage || !launcher || !panel || !form) return;

  let activeRequest = null;

  function setOpen(open) {
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    stage.classList.toggle("ai-assistant-open", open);
    if (open) {
      const navigationPanel = document.querySelector(".navigation-panel");
      const navigationToggle = document.querySelector("#navigationToggle");
      if (matchMedia("(max-width:720px)").matches && navigationPanel && !navigationPanel.classList.contains("is-collapsed")) navigationToggle?.click();
      setTimeout(() => input.focus(), 0);
    } else {
      launcher.focus();
    }
  }

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle("is-error", error);
  }

  function createButton(text, action, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    if (className) button.className = className;
    button.addEventListener("click", action);
    return button;
  }

  function showBooth(item) {
    window.dispatchEvent(new CustomEvent("necc:show-booth", { detail: { boothId: item.boothId } }));
    setOpen(false);
  }

  function navigateToBooth(item) {
    window.dispatchEvent(new CustomEvent("necc:navigate", { detail: { boothId: item.boothId } }));
    setOpen(false);
  }

  function showFacility(item) {
    window.dispatchEvent(new CustomEvent("necc:show-destination", { detail: { endpointId: item.endpointId } }));
    setOpen(false);
  }

  function navigateToFacility(item) {
    window.dispatchEvent(new CustomEvent("necc:navigate", { detail: { endpointId: item.endpointId } }));
    setOpen(false);
  }

  function renderFacilityResponse(payload) {
    const facilities = window.venueNavigation?.findFacilities(payload.facilityRequest) || [];
    answer.hidden = false;
    answer.replaceChildren(document.createTextNode(facilities.length
      ? `${payload.answer} 共显示 ${facilities.length} 个优先结果。`
      : "地图中暂未找到符合楼层或场馆条件的设施，请换一种说法。"));
    results.replaceChildren();
    for (const item of facilities) {
      const card = document.createElement("article");
      card.className = "ai-result ai-facility-result";
      const head = document.createElement("div");
      head.className = "ai-result-head";
      const title = document.createElement("h3");
      title.textContent = item.name;
      const location = document.createElement("span");
      location.className = "ai-result-location";
      location.textContent = item.typeLabel;
      head.append(title, location);
      const meta = document.createElement("div");
      meta.className = "ai-result-meta";
      meta.textContent = `${item.floor} · ${item.area}`;
      const reason = document.createElement("p");
      reason.className = "ai-result-reason";
      reason.textContent = item.sameFloor
        ? `距当前起点直线约 ${item.distanceMeters} 米，实际路线以地图规划结果为准。`
        : `位于其他楼层，将自动切换双层视图并选择换层设施。`;
      const actions = document.createElement("div");
      actions.className = "ai-result-actions";
      actions.append(createButton("地图定位", () => showFacility(item)), createButton("到这里", () => navigateToFacility(item)));
      card.append(head, meta, reason, actions);
      results.appendChild(card);
    }
  }

  function renderResponse(payload) {
    if (payload.intent === "facility") {
      renderFacilityResponse(payload);
      return;
    }
    answer.hidden = false;
    answer.replaceChildren(document.createTextNode(payload.answer || "暂未找到相关展商。"));
    if (payload.warning) {
      const warning = document.createElement("span");
      warning.className = "ai-warning";
      warning.textContent = payload.warning;
      answer.appendChild(warning);
    }
    results.replaceChildren();
    for (const item of payload.recommendations || []) {
      const card = document.createElement("article");
      card.className = "ai-result";
      const head = document.createElement("div");
      head.className = "ai-result-head";
      const title = document.createElement("h3");
      title.textContent = item.shortName || item.company;
      const location = document.createElement("span");
      location.className = "ai-result-location";
      location.textContent = `${item.hall}馆 · ${item.boothCode}`;
      head.append(title, location);
      const meta = document.createElement("div");
      meta.className = "ai-result-meta";
      meta.textContent = `${item.industry || "未分类"} · ${item.company || ""}`;
      const reason = document.createElement("p");
      reason.className = "ai-result-reason";
      reason.textContent = item.reason;
      const note = document.createElement("div");
      note.className = "ai-result-note";
      note.textContent = item.simulated ? "当前为模拟展商资料，不代表真实参展信息" : "推荐依据以资料状态标识为准";
      const actions = document.createElement("div");
      actions.className = "ai-result-actions";
      actions.append(createButton("地图定位", () => showBooth(item)), createButton("到这里", () => navigateToBooth(item)));
      card.append(head, meta, reason, note, actions);
      results.appendChild(card);
    }
  }

  async function submitQuery(query) {
    const normalized = String(query || "").trim();
    if (normalized.length < 2) {
      setStatus("请至少输入两个字符。", true);
      input.focus();
      return;
    }
    activeRequest?.abort();
    activeRequest = new AbortController();
    sendButton.disabled = true;
    setStatus("正在分析展商资料…");
    try {
      const response = await fetch("/api/assistant/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: normalized, currentLocation: document.querySelector("#startSelect")?.value || "" }),
        signal: activeRequest.signal
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || "AI后端没有返回有效结果");
      renderResponse(payload);
      setStatus(payload.intent === "facility" ? "地图设施已找到" : payload.mode === "ai" ? "DeepSeek推荐完成" : "本地演示匹配完成");
      if (payload.mode !== "map") {
        connection.textContent = payload.mode === "ai" ? "AI已连接" : "演示模式";
        connection.classList.toggle("is-online", payload.mode === "ai");
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      setStatus("AI后端尚未启动或无法访问，请运行 node server/index.js。", true);
    } finally {
      sendButton.disabled = false;
      activeRequest = null;
    }
  }

  launcher.addEventListener("click", () => setOpen(true));
  closeButton.addEventListener("click", () => setOpen(false));
  form.addEventListener("submit", event => {
    event.preventDefault();
    submitQuery(input.value);
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  document.querySelectorAll("[data-ai-query]").forEach(button => button.addEventListener("click", () => {
    input.value = button.dataset.aiQuery;
    submitQuery(input.value);
  }));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) setOpen(false);
  });
  fetch("/api/health")
    .then(response => response.ok ? response.json() : Promise.reject(new Error("offline")))
    .then(payload => {
      connection.textContent = payload.aiConfigured ? "AI已连接" : "演示模式";
      connection.classList.toggle("is-online", payload.aiConfigured);
    })
    .catch(() => {
      connection.textContent = "后端离线";
    });
})();
