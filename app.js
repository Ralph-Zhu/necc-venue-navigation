(function () {
  "use strict";

  const source = window.VENUE_DATA;
  const state = {
    floor: "F1",
    view: "2d",
    tool: "select",
    cameraMode: "single",
    booths: JSON.parse(JSON.stringify(source.booths)),
    floors: JSON.parse(JSON.stringify(source.floors)),
    selectedId: null,
    route: null,
    undo: [],
    draft: null,
    polygon: [],
    roadDraft: [],
    background: {},
    backgroundOpacity: .42,
    visibleLayers: { shell: true, roads: true, vertical: true, facilities: true },
    viewBox: { x: -8, y: -8, w: 292.2, h: 141.1 }
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const svg = $("#mapSvg");
  const ns = "http://www.w3.org/2000/svg";
  let toastTimer;
  let drag = null;

  function el(name, attrs = {}, text = "") {
    const node = document.createElementNS(ns, name);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    if (text) node.textContent = text;
    return node;
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function snapshot() {
    state.undo.push(JSON.stringify({ booths: state.booths, floors: state.floors }));
    if (state.undo.length > 30) state.undo.shift();
  }

  function undo() {
    const last = state.undo.pop();
    if (!last) return showToast("没有可撤销的操作");
    const previous = JSON.parse(last);
    state.booths = previous.booths;
    state.floors = previous.floors;
    state.selectedId = null;
    state.route = null;
    renderAll();
    showToast("已撤销上一步操作");
  }

  function currentFloor() { return state.floors[state.floor]; }
  function currentBooths() { return state.booths.filter(b => b.floor === state.floor); }
  function selectedBooth() { return state.booths.find(b => b.id === state.selectedId); }

  function setViewBox() {
    svg.setAttribute("viewBox", `${state.viewBox.x} ${state.viewBox.y} ${state.viewBox.w} ${state.viewBox.h}`);
  }

  function renderShell() {
    const layer = $("#shellLayer");
    layer.innerHTML = "";
    if (!state.visibleLayers.shell) return;
    const floor = currentFloor();
    layer.appendChild(el("rect", { x: 0, y: 0, width: floor.width, height: floor.depth, rx: .8, class: "cad-floor-fill" }));
    if (floor.isPlaceholder) {
      layer.appendChild(el("rect", { x: 2, y: 2, width: floor.width - 4, height: floor.depth - 4, rx: 2, class: "cad-placeholder" }));
      layer.appendChild(el("text", { x: floor.width / 2, y: floor.depth / 2 - 2, class: "placeholder-title" }, "F2 公共夹层预留"));
      layer.appendChild(el("text", { x: floor.width / 2, y: floor.depth / 2 + 6, class: "placeholder-subtitle" }, "等待补充道路、小房间及连接关系"));
      return;
    }
    floor.geometry.structure.forEach(points => {
      const d = points.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
      layer.appendChild(el("path", { d, class: "cad-line cad-structure" }));
    });
  }

  function renderRooms() {
    const layer = $("#roomLayer");
    layer.innerHTML = "";
    currentFloor().rooms.forEach((room, index) => {
      layer.appendChild(el("rect", { x: room.x, y: room.y, width: room.w, height: room.h, rx: 1.4, class: "room" }));
      if (room.w > 35 && room.h > 20) layer.appendChild(el("text", { x: room.x + room.w / 2, y: room.y + room.h / 2, class: "room-label" }, state.floor === "F2" ? "预留小房间" : `固定功能区 ${index + 1}`));
    });
  }

  function renderRoads() {
    const layer = $("#roadLayer");
    layer.innerHTML = "";
    if (!state.visibleLayers.roads) return;
    const floor = currentFloor();
    if (floor.geometry) floor.geometry.circulation.forEach(points => {
      const d = points.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
      layer.appendChild(el("path", { d, class: "cad-line cad-circulation" }));
    });
    floor.roads.forEach(points => {
      const d = points.map((p, i) => `${i ? "L" : "M"} ${p[0]} ${p[1]}`).join(" ");
      layer.appendChild(el("path", { d, class: "road" }));
      layer.appendChild(el("path", { d, class: "road-center" }));
    });
  }

  function boothPath(booth) {
    if (booth.points && booth.points.length > 2) return booth.points.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ") + " Z";
    return `M${booth.x},${booth.y}h${booth.w}v${booth.h}h-${booth.w}Z`;
  }

  function boothCenter(booth) {
    if (booth.points && booth.points.length) {
      return booth.points.reduce((a, p) => [a[0] + p[0] / booth.points.length, a[1] + p[1] / booth.points.length], [0, 0]);
    }
    return [booth.x + booth.w / 2, booth.y + booth.h / 2];
  }

  function renderBooths() {
    const layer = $("#boothLayer");
    layer.innerHTML = "";
    currentBooths().forEach(booth => {
      const group = el("g", { class: `booth-group${booth.id === state.selectedId ? " selected" : ""}`, "data-id": booth.id });
      const [cx, cy] = boothCenter(booth);
      group.appendChild(el("path", { d: boothPath(booth), class: "booth-shape", fill: booth.color + "38", stroke: booth.color }));
      group.appendChild(el("path", { d: boothPath(booth), class: "selection-outline" }));
      group.appendChild(el("text", { x: cx, y: cy - (booth.company ? 1.9 : 0), class: "booth-label" }, booth.number));
      if (booth.company) group.appendChild(el("text", { x: cx, y: cy + 2.3, class: "booth-company" }, booth.company.length > 10 ? booth.company.slice(0, 10) + "…" : booth.company));
      layer.appendChild(group);
    });
  }

  function facilityGlyph(type) { return type === "elevator" ? "↕" : type === "entrance" ? "入" : "WC"; }
  function renderFacilities() {
    const layer = $("#facilityLayer");
    layer.innerHTML = "";
    currentFloor().facilities.forEach(item => {
      if ((item.type === "elevator" && !state.visibleLayers.vertical) || (item.type !== "elevator" && !state.visibleLayers.facilities)) return;
      const group = el("g", { class: `facility-node ${item.type}` });
      group.appendChild(el("circle", { cx: item.x, cy: item.y, r: item.type === "entrance" ? 4.8 : 3.7 }));
      group.appendChild(el("text", { x: item.x, y: item.y + .25 }, facilityGlyph(item.type)));
      if (item.type === "entrance") group.appendChild(el("text", { x: item.x, y: item.y - 7, class: "facility-label" }, item.label));
      const title = el("title", {}, item.label); group.appendChild(title);
      layer.appendChild(group);
    });
  }

  function renderRoute() {
    const layer = $("#routeLayer");
    layer.innerHTML = "";
    if (!state.route || state.route.floor !== state.floor) return;
    const d = state.route.points.map((p, i) => `${i ? "L" : "M"} ${p[0]} ${p[1]}`).join(" ");
    layer.appendChild(el("path", { d, class: "route-line" }));
  }

  function renderBackground() {
    const layer = $("#backgroundLayer");
    layer.innerHTML = "";
    if (!state.background[state.floor]) return;
    const floor = currentFloor();
    layer.appendChild(el("image", { href: state.background[state.floor], x: 0, y: 0, width: floor.width, height: floor.depth, opacity: state.backgroundOpacity, preserveAspectRatio: "none" }));
  }

  function renderDraft() {
    const layer = $("#draftLayer");
    layer.innerHTML = "";
    if (state.draft) layer.appendChild(el("rect", { x: state.draft.x, y: state.draft.y, width: state.draft.w, height: state.draft.h, class: "draft-shape" }));
    const points = state.tool === "polygon" ? state.polygon : state.roadDraft;
    if (points.length) {
      layer.appendChild(el("polyline", { points: points.map(p => p.join(",")).join(" "), class: "draft-shape", fill: state.tool === "polygon" ? "rgba(24,213,189,.12)" : "none" }));
      points.forEach(p => layer.appendChild(el("circle", { cx: p[0], cy: p[1], r: 1.2, fill: "#18d5bd" })));
    }
  }

  function render2D() {
    renderBackground(); renderShell(); renderRoads(); renderRooms(); renderBooths(); renderRoute(); renderFacilities(); renderDraft();
  }

  function renderInspector() {
    const booth = selectedBooth();
    $("#inspectorEmpty").classList.toggle("hidden", !!booth);
    $("#inspectorContent").classList.toggle("hidden", !booth);
    if (!booth) return;
    $("#inspectorTitle").textContent = booth.number;
    $("#boothNumber").value = booth.number;
    $("#boothCompany").value = booth.company || "";
    $("#boothType").value = booth.type || "standard";
    $("#boothWidth").value = Math.round(booth.w * 10) / 10;
    $("#boothDepth").value = Math.round(booth.h * 10) / 10;
    $$("#colorRow button").forEach(button => button.classList.toggle("active", button.dataset.color === booth.color));
  }

  function renderAll() {
    render2D(); renderInspector();
    if (state.view === "3d" && three.ready) build3DModel();
  }

  function svgPoint(event) {
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const result = point.matrixTransform(svg.getScreenCTM().inverse());
    const floor = currentFloor();
    return [Math.max(0, Math.min(floor.width, result.x)), Math.max(0, Math.min(floor.depth, result.y))];
  }

  function nextNumber() {
    const prefix = state.floor === "F1" ? "A" : state.floor === "F2" ? "B" : "C";
    const max = state.booths.filter(b => b.floor === state.floor && b.number.startsWith(prefix)).reduce((n, b) => Math.max(n, parseInt(b.number.slice(1), 10) || 0), 0);
    return prefix + String(max + 1).padStart(3, "0");
  }

  function makeBooth(props) {
    const number = nextNumber();
    return { id: "booth-" + Date.now() + "-" + Math.random().toString(16).slice(2), number, company: "待匹配展商", floor: state.floor, color: "#21d4a7", type: "standard", ...props };
  }

  svg.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    const [x, y] = svgPoint(event);
    const boothNode = event.target.closest(".booth-group");
    if (state.tool === "select") {
      if (!boothNode) { state.selectedId = null; renderAll(); return; }
      const booth = state.booths.find(b => b.id === boothNode.dataset.id);
      state.selectedId = booth.id;
      const origin = booth.points ? booth.points.map(p => [...p]) : [booth.x, booth.y];
      drag = { booth, start: [x, y], origin, moved: false };
      svg.setPointerCapture(event.pointerId);
      renderAll();
    } else if (state.tool === "rect") {
      state.draft = { x, y, w: 0, h: 0, startX: x, startY: y };
      svg.setPointerCapture(event.pointerId); renderDraft();
    }
  });

  svg.addEventListener("pointermove", event => {
    const [x, y] = svgPoint(event);
    if (drag) {
      if (!drag.moved) { snapshot(); drag.moved = true; }
      const dx = x - drag.start[0], dy = y - drag.start[1];
      if (drag.booth.points) drag.booth.points = drag.origin.map(p => [p[0] + dx, p[1] + dy]);
      else { drag.booth.x = drag.origin[0] + dx; drag.booth.y = drag.origin[1] + dy; }
      renderBooths(); renderInspector();
    } else if (state.draft) {
      state.draft.x = Math.min(state.draft.startX, x); state.draft.y = Math.min(state.draft.startY, y);
      state.draft.w = Math.abs(x - state.draft.startX); state.draft.h = Math.abs(y - state.draft.startY); renderDraft();
    }
  });

  svg.addEventListener("pointerup", () => {
    if (drag) { drag = null; if (state.view === "3d") build3DModel(); }
    if (state.draft) {
      if (state.draft.w >= 2 && state.draft.h >= 2) {
        snapshot(); const booth = makeBooth({ x: state.draft.x, y: state.draft.y, w: state.draft.w, h: state.draft.h });
        state.booths.push(booth); state.selectedId = booth.id; showToast(`已创建展位 ${booth.number}`);
      }
      state.draft = null; setTool("select"); renderAll();
    }
  });

  svg.addEventListener("click", event => {
    if (state.tool !== "polygon" && state.tool !== "route") return;
    const point = svgPoint(event);
    if (state.tool === "polygon") state.polygon.push(point); else state.roadDraft.push(point);
    renderDraft();
  });

  svg.addEventListener("dblclick", event => {
    event.preventDefault();
    if (state.tool === "polygon" && state.polygon.length >= 3) {
      snapshot();
      const xs = state.polygon.map(p => p[0]), ys = state.polygon.map(p => p[1]);
      const booth = makeBooth({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), points: state.polygon.slice(), type: "special", color: "#8b6cff" });
      state.booths.push(booth); state.selectedId = booth.id; state.polygon = []; setTool("select"); renderAll(); showToast(`已创建多边形展位 ${booth.number}`);
    } else if (state.tool === "route" && state.roadDraft.length >= 2) {
      snapshot(); currentFloor().roads.push(state.roadDraft.slice()); state.roadDraft = []; setTool("select"); renderAll(); showToast("已添加本楼层道路");
    }
  });

  function setTool(tool) {
    state.tool = tool; state.draft = null; state.polygon = []; state.roadDraft = [];
    svg.dataset.tool = tool;
    $$("[data-tool]").forEach(button => button.classList.toggle("active", button.dataset.tool === tool));
    $("#stageHint").textContent = tool === "polygon" ? "单击加点，双击完成多边形" : tool === "rect" ? "按住并拖动绘制矩形展位" : tool === "route" ? "单击设置道路节点，双击完成" : "选择或拖动展位";
    renderDraft();
  }

  function selectFloor(floor) {
    state.floor = floor; state.selectedId = null; state.route = null;
    $$(".floor-item").forEach(button => button.classList.toggle("active", button.dataset.floor === floor));
    $("#stageFloorName").textContent = `${floor} · ${currentFloor().name}`;
    renderAll();
  }

  function selectBooth(id) { state.selectedId = id; renderAll(); }

  function planRoute() {
    const booth = selectedBooth(); if (!booth) return;
    const start = currentFloor().entrance, end = boothCenter(booth);
    const primaryY = currentFloor().depth * .52;
    state.route = { floor: state.floor, points: [start, [start[0], primaryY], [end[0], primaryY], end] };
    renderRoute(); if (state.view === "3d" && three.ready) build3DModel();
    showToast(`路线已生成：南主入口 → ${booth.number}`);
  }

  function updateSelected(key, value) {
    const booth = selectedBooth(); if (!booth) return;
    booth[key] = value; render2D(); renderInspector(); if (state.view === "3d" && three.ready) build3DModel();
  }

  function deleteSelected() {
    if (!state.selectedId) return; snapshot();
    state.booths = state.booths.filter(b => b.id !== state.selectedId); state.selectedId = null; state.route = null; renderAll(); showToast("展位已删除");
  }

  function importRows(rows) {
    if (!rows.length) return showToast("表格中没有可读取的数据");
    snapshot(); let matched = 0, created = 0;
    rows.forEach(row => {
      const normalized = {}; Object.entries(row).forEach(([k, v]) => normalized[String(k).trim().toLowerCase()] = v);
      const number = String(normalized["展位号"] || normalized["展位编号"] || normalized.booth_no || normalized.number || "").trim();
      const company = String(normalized["展商名称"] || normalized["公司名称"] || normalized.company || normalized.name || "").trim();
      const floor = String(normalized["楼层"] || normalized.floor || state.floor).toUpperCase();
      if (!number) return;
      const booth = state.booths.find(b => b.number === number && b.floor === floor);
      if (booth) { booth.company = company || booth.company; matched++; }
      else if (normalized.x !== undefined && normalized.y !== undefined) {
        state.booths.push(makeBooth({ number, company: company || "待补充展商", floor, x: Number(normalized.x), y: Number(normalized.y), w: Number(normalized.width || normalized["宽度"] || 9), h: Number(normalized.height || normalized["深度"] || 9) })); created++;
      }
    });
    renderAll(); showToast(`Excel导入完成：匹配 ${matched} 个，新建 ${created} 个`);
  }

  async function handleExcel(file) {
    try {
      if (window.XLSX) {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        importRows(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" }));
      } else if (file.name.toLowerCase().endsWith(".csv")) {
        const text = await file.text(); const lines = text.split(/\r?\n/).filter(Boolean); const headers = lines.shift().split(",");
        importRows(lines.map(line => Object.fromEntries(line.split(",").map((v, i) => [headers[i], v]))));
      } else showToast("Excel组件未加载，请联网后重试或导入CSV");
    } catch (error) { console.error(error); showToast("文件读取失败，请检查表头和格式"); }
  }

  function exportData() {
    const payload = { version: "prototype-1", building: source.building, floors: state.floors, booths: state.booths, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "国家会展中心-场馆方案.json"; a.click(); URL.revokeObjectURL(a.href);
    showToast("场馆方案已导出");
  }

  // Three.js preview ------------------------------------------------------
  const three = { ready: false, model: null, boothMeshes: [], route: null, azimuth: -.55, polar: .94, distance: 185, targetY: 8, dragging: false, last: [0,0] };
  function worldPoint(x, y, elevation = 0) { return new THREE.Vector3((x - source.building.width / 2) * .62, elevation, (y - source.building.depth / 2) * .62); }

  function initThree() {
    if (three.ready) return;
    const message = $("#threeMessage");
    if (!window.THREE) { message.innerHTML = "<span>3D组件加载失败，请连接网络后刷新页面</span>"; return; }
    const canvas = $("#threeCanvas");
    three.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    three.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    three.renderer.outputColorSpace = THREE.SRGBColorSpace;
    three.renderer.toneMapping = THREE.ACESFilmicToneMapping; three.renderer.toneMappingExposure = 1.08;
    three.scene = new THREE.Scene(); three.scene.background = new THREE.Color(0x081421); three.scene.fog = new THREE.Fog(0x081421, 180, 330);
    three.camera = new THREE.PerspectiveCamera(42, 1, .1, 1000);
    three.scene.add(new THREE.HemisphereLight(0x9ddaff, 0x10151d, 2.25));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.position.set(-80,130,70); three.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x27e0ca, 1.5); rim.position.set(100,45,-100); three.scene.add(rim);
    const grid = new THREE.GridHelper(260, 26, 0x27475d, 0x142a3b); grid.position.y = -.5; three.scene.add(grid); three.grid = grid;
    three.model = new THREE.Group(); three.scene.add(three.model);
    three.raycaster = new THREE.Raycaster(); three.mouse = new THREE.Vector2();
    canvas.addEventListener("pointerdown", e => { three.dragging = true; three.moved = false; three.last = [e.clientX,e.clientY]; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", e => { if (!three.dragging) return; const dx=e.clientX-three.last[0],dy=e.clientY-three.last[1]; if(Math.abs(dx)+Math.abs(dy)>2)three.moved=true; three.azimuth-=dx*.007; three.polar=Math.max(.2,Math.min(1.42,three.polar+dy*.006)); three.last=[e.clientX,e.clientY]; });
    canvas.addEventListener("pointerup", e => { three.dragging=false; if(!three.moved) pick3D(e); });
    canvas.addEventListener("wheel", e => { e.preventDefault(); three.distance=Math.max(65,Math.min(300,three.distance+e.deltaY*.12)); }, { passive:false });
    window.addEventListener("resize", resizeThree);
    three.ready = true; message.classList.add("hidden"); build3DModel(); resizeThree(); animateThree();
  }

  function clearGroup(group) { while(group.children.length){ const obj=group.children.pop(); obj.traverse(child=>{ if(child.geometry)child.geometry.dispose(); if(child.material){ const mats=Array.isArray(child.material)?child.material:[child.material]; mats.forEach(m=>m.dispose()); } }); } }

  function floorY(floor) {
    if (state.cameraMode === "single") return 0;
    return floor === "F1" ? 0 : floor === "F2" ? 24 : 48;
  }

  function makePlate(floor, y) {
    const data = state.floors[floor];
    const shape = new THREE.Shape();
    [[0,0],[data.width,0],[data.width,data.depth],[0,data.depth]].forEach((p,i)=>{ const wp=worldPoint(p[0],p[1]); if(i===0)shape.moveTo(wp.x,wp.z);else shape.lineTo(wp.x,wp.z); });
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape,{depth:1.2,bevelEnabled:true,bevelSize:.45,bevelThickness:.35,bevelSegments:2}); geometry.rotateX(Math.PI/2);
    const material = new THREE.MeshStandardMaterial({color: floor==="F2"?0x132c3f:0x17374b,metalness:.18,roughness:.66,transparent:true,opacity:state.cameraMode==="explode"?.88:1});
    const mesh = new THREE.Mesh(geometry,material); mesh.position.y=y; return mesh;
  }

  function segmentBox(a,b,width,height,color,y,opacity=1) {
    const p1=worldPoint(a[0],a[1]),p2=worldPoint(b[0],b[1]); const dx=p2.x-p1.x,dz=p2.z-p1.z,len=Math.hypot(dx,dz);
    const geo=new THREE.BoxGeometry(len,height,width*.62); const mat=new THREE.MeshStandardMaterial({color,roughness:.8,transparent:opacity<1,opacity}); const mesh=new THREE.Mesh(geo,mat);
    mesh.position.set((p1.x+p2.x)/2,y+height/2,(p1.z+p2.z)/2); mesh.rotation.y=-Math.atan2(dz,dx); return mesh;
  }

  function addFloorModel(floorKey) {
    if (state.cameraMode === "single" && floorKey !== state.floor) return;
    const floor = state.floors[floorKey], y = floorY(floorKey); const group = new THREE.Group(); group.userData.floor=floorKey;
    group.add(makePlate(floorKey,y));
    floor.rooms.forEach(room=>{ const geo=new THREE.BoxGeometry(room.w*.62,2.3,room.h*.62); const mat=new THREE.MeshStandardMaterial({color:0x26485d,roughness:.7,transparent:true,opacity:.72}); const mesh=new THREE.Mesh(geo,mat); const p=worldPoint(room.x+room.w/2,room.y+room.h/2); mesh.position.set(p.x,y+1.7,p.z); group.add(mesh); });
    if (floor.geometry && state.visibleLayers.shell) floor.geometry.structure.forEach(path => {
      for (let i = 1; i < path.length; i++) {
        const length = Math.hypot(path[i][0] - path[i-1][0], path[i][1] - path[i-1][1]);
        if (length > .18) group.add(segmentBox(path[i-1], path[i], .32, 3.2, 0x6f9db7, y + 1.15, .82));
      }
    });
    if (floor.geometry && state.visibleLayers.roads) {
      const positions = [];
      floor.geometry.circulation.forEach(path => { for (let i=1;i<path.length;i++) { const a=worldPoint(path[i-1][0],path[i-1][1]), b=worldPoint(path[i][0],path[i][1]); positions.push(a.x,y+1.38,a.z,b.x,y+1.38,b.z); } });
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions,3));
      group.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0x365c73,transparent:true,opacity:.58})));
    }
    if(state.visibleLayers.roads) floor.roads.forEach(points=>{ for(let i=1;i<points.length;i++) group.add(segmentBox(points[i-1],points[i],10,.16,0x2b5770,y+1.25,.95)); });
    state.booths.filter(b=>b.floor===floorKey).forEach(booth=>{
      const [cx,cy]=boothCenter(booth); const geo=new THREE.BoxGeometry(Math.max(booth.w*.62,.8),booth.type==="special"?5.4:3.8,Math.max(booth.h*.62,.8)); const color=new THREE.Color(booth.color);
      const mat=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:booth.id===state.selectedId?.3:.08,metalness:.12,roughness:.47,transparent:true,opacity:.94}); const mesh=new THREE.Mesh(geo,mat); const p=worldPoint(cx,cy);
      mesh.position.set(p.x,y+1.25+geo.parameters.height/2,p.z); mesh.userData={boothId:booth.id}; group.add(mesh); three.boothMeshes.push(mesh);
      const edge=new THREE.LineSegments(new THREE.EdgesGeometry(geo),new THREE.LineBasicMaterial({color:booth.id===state.selectedId?0xffffff:0x9cefff,transparent:true,opacity:booth.id===state.selectedId?.95:.22})); edge.position.copy(mesh.position); edge.userData={boothId:booth.id}; group.add(edge);
    });
    floor.facilities.forEach(item=>{
      if ((item.type==="elevator"&&!state.visibleLayers.vertical)||(item.type!=="elevator"&&!state.visibleLayers.facilities)) return;
      const p=worldPoint(item.x,item.y); const color=item.type==="elevator"?0x9877ff:item.type==="entrance"?0x3ca9ff:0x39d7ae;
      const geo=item.type==="entrance"?new THREE.ConeGeometry(1.3,3,5):new THREE.CylinderGeometry(1.2,1.2,2.5,12); const mat=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.35}); const mesh=new THREE.Mesh(geo,mat); mesh.position.set(p.x,y+3,p.z); group.add(mesh);
    });
    if(state.route&&state.route.floor===floorKey){ const points=state.route.points.map(p=>{const v=worldPoint(p[0],p[1]);v.y=y+2.2;return v}); const curve=new THREE.CatmullRomCurve3(points,false,"catmullrom",.1); const geo=new THREE.TubeGeometry(curve,80,.48,7,false); const mat=new THREE.MeshBasicMaterial({color:0xffcf57}); group.add(new THREE.Mesh(geo,mat)); }
    three.model.add(group);
  }

  function build3DModel() {
    if(!three.ready)return; clearGroup(three.model); three.boothMeshes=[];
    ["F1","F2","F3"].forEach(addFloorModel);
    three.grid.visible = state.cameraMode === "single";
    three.targetY = state.cameraMode === "explode" ? 22 : 4;
  }

  function resizeThree() { if(!three.ready)return; const rect=$("#canvas3d").getBoundingClientRect(); if(!rect.width||!rect.height)return; three.renderer.setSize(rect.width,rect.height,false); three.camera.aspect=rect.width/rect.height; three.camera.updateProjectionMatrix(); }
  function animateThree() { requestAnimationFrame(animateThree); const sin=Math.sin(three.polar); three.camera.position.set(Math.sin(three.azimuth)*sin*three.distance,three.targetY+Math.cos(three.polar)*three.distance,Math.cos(three.azimuth)*sin*three.distance); three.camera.lookAt(0,three.targetY,0); three.renderer.render(three.scene,three.camera); }
  function pick3D(event) { const rect=$("#threeCanvas").getBoundingClientRect(); three.mouse.x=((event.clientX-rect.left)/rect.width)*2-1; three.mouse.y=-((event.clientY-rect.top)/rect.height)*2+1; three.raycaster.setFromCamera(three.mouse,three.camera); const hit=three.raycaster.intersectObjects(three.boothMeshes,false)[0]; if(hit){ const booth=state.booths.find(b=>b.id===hit.object.userData.boothId); if(booth){ if(booth.floor!==state.floor)selectFloor(booth.floor); selectBooth(booth.id); build3DModel(); } } }

  // UI bindings ----------------------------------------------------------
  $$(".floor-item").forEach(button => button.addEventListener("click", () => selectFloor(button.dataset.floor)));
  $$("[data-view]").forEach(button => button.addEventListener("click", () => {
    state.view=button.dataset.view; $$("[data-view]").forEach(b=>b.classList.toggle("active",b===button));
    $("#canvas2d").classList.toggle("active",state.view==="2d"); $("#canvas3d").classList.toggle("active",state.view==="3d");
    $("#editorTools").style.opacity=state.view==="2d"?"1":".35"; if(state.view==="3d"){initThree();setTimeout(resizeThree,10);build3DModel();}
  }));
  $$("[data-tool]").forEach(button=>button.addEventListener("click",()=>setTool(button.dataset.tool)));
  $$("[data-camera]").forEach(button=>button.addEventListener("click",()=>{state.cameraMode=button.dataset.camera;$$("[data-camera]").forEach(b=>b.classList.toggle("active",b===button));if(state.view==="3d"){initThree();build3DModel();}}));
  $$("[data-layer]").forEach(input=>input.addEventListener("change",()=>{state.visibleLayers[input.dataset.layer]=input.checked;renderAll();}));
  $("#undoBtn").addEventListener("click",undo); $("#deleteBtn").addEventListener("click",deleteSelected); $("#planRouteBtn").addEventListener("click",planRoute);
  $("#boothNumber").addEventListener("change",e=>{snapshot();updateSelected("number",e.target.value.trim()||nextNumber())});
  $("#boothCompany").addEventListener("change",e=>{snapshot();updateSelected("company",e.target.value.trim())});
  $("#boothType").addEventListener("change",e=>{snapshot();updateSelected("type",e.target.value)});
  $("#boothWidth").addEventListener("change",e=>{snapshot();updateSelected("w",Math.max(1,Number(e.target.value)||1))});
  $("#boothDepth").addEventListener("change",e=>{snapshot();updateSelected("h",Math.max(1,Number(e.target.value)||1))});
  $$("#colorRow button").forEach(button=>button.addEventListener("click",()=>{snapshot();updateSelected("color",button.dataset.color)}));
  $("#backgroundBtn").addEventListener("click",()=>$("#backgroundInput").click());
  $("#backgroundInput").addEventListener("change",e=>{const file=e.target.files[0];if(!file)return;state.background[state.floor]=URL.createObjectURL(file);renderBackground();showToast(`${state.floor} 背景图已加入`)});
  $("#excelBtn").addEventListener("click",()=>$("#excelInput").click()); $("#excelInput").addEventListener("change",e=>{const file=e.target.files[0];if(file)handleExcel(file);e.target.value=""});
  $("#exportBtn").addEventListener("click",exportData); $("#publishBtn").addEventListener("click",()=>showToast("当前版本已保存到浏览器会话"));
  $("#zoomIn").addEventListener("click",()=>{state.viewBox.w*=.82;state.viewBox.h*=.82;setViewBox()}); $("#zoomOut").addEventListener("click",()=>{state.viewBox.w*=1.22;state.viewBox.h*=1.22;setViewBox()}); $("#zoomFit").addEventListener("click",()=>{state.viewBox={x:-8,y:-8,w:292.2,h:141.1};setViewBox()});
  $$("[data-theme]").forEach(button=>button.addEventListener("click",()=>{const themes={ocean:["#18d5bd","#2f8cff"],violet:["#8d58ff","#eb56b2"],sunset:["#ff7b54","#ffc857"]};const c=themes[button.dataset.theme];document.documentElement.style.setProperty("--accent",c[0]);document.documentElement.style.setProperty("--accent-2",c[1]);document.documentElement.style.setProperty("--gradient",`linear-gradient(135deg, ${c[0]}, ${c[1]})`);$$("[data-theme]").forEach(b=>b.classList.toggle("active",b===button));showToast("渐变主题已切换")}));
  $$("[data-mobile-view]").forEach(button=>button.addEventListener("click",()=>{const mode=button.dataset.mobileView;$(".left-panel").classList.toggle("mobile-open",mode==="floors");$(".right-panel").classList.toggle("mobile-open",mode==="info");$$("[data-mobile-view]").forEach(b=>b.classList.toggle("active",b===button));}));
  document.addEventListener("keydown",event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="z"){event.preventDefault();undo()}if(event.key==="Delete"&&state.selectedId)deleteSelected();if(event.key==="Escape")setTool("select")});

  setViewBox(); setTool("select"); renderAll();
})();
