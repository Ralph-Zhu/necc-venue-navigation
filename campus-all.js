(()=>{
  "use strict";
  const MODEL_STANDARD={
    version:"MGS-2.0-draft",
    floorThickness:.15,
    wallHeight:2.4,
    doorHeight:2.4,
    elevatorHeight:2.8,
    stairsSteps:7,
    stairsHeight:1,
    escalatorSteps:10,
    escalatorHeight:1.1,
    explodedFloorGap:24
  };
  const FLOOR_DEFS=[
    {id:"F1",source:"./assets/figma-f1-full-v3.svg?v=20260904-1",root:"F1",physicalElevation:0,overviewOffset:0,halls:["1.1","2.1","3.1","4.1","5.1","6.1","7.1","8.1"],color:0x4e9f92},
    {id:"F3",source:"./assets/figma-f3-full-v6.svg?v=20260903-2",root:"F3",physicalElevation:null,overviewOffset:MODEL_STANDARD.explodedFloorGap,halls:["1.2","2.2","3.2","4.2","5.2","6.2","7.2","8.2"],color:0x4d91aa}
  ];
  const viewParams=new URLSearchParams(location.search),requestedView=(viewParams.get("view")||viewParams.get("floor")||"ALL").toUpperCase();
  let viewMode=["ALL","F1","F3"].includes(requestedView)?requestedView:"ALL";
  const SCALE=.1,VIEW={w:8272,h:8274};
  const stage=document.querySelector("#mapStage"),canvas=document.querySelector("#mapCanvas"),labels=document.querySelector("#hallLabels");
  const loading=document.querySelector("#loading"),status=document.querySelector("#mapStatus"),startSelect=document.querySelector("#startSelect");
  const destinationSelect=document.querySelector("#destinationSelect"),routeState=document.querySelector("#routeState"),routeSummary=document.querySelector("#routeSummary");
  const clearRouteButton=document.querySelector("#clearRouteButton");
  const COLORS=[0x4e9f92,0x4d91aa,0x637dab,0x8a6fa8,0xa66f87,0xa9795c,0x6f9c74,0x4f8f9d];
  const TYPES=[
    {key:"stairs",label:"楼梯",pattern:/^STAIRS__/,color:0xaa9274,css:"#aa9274"},
    {key:"female",label:"女卫生间",pattern:/^WC_FEMALE__/,color:0xb8798d,css:"#b8798d"},
    {key:"male",label:"男卫生间",pattern:/^WC_MALE__/,color:0x6689ad,css:"#6689ad"},
    {key:"accessible",label:"无障碍卫生间",pattern:/^WC_ACCESSIBLE__/,color:0x6d9a78,css:"#6d9a78"},
    {key:"escalator",label:"扶梯",pattern:/^ESCALATORS?__/,color:0xc08a4d,css:"#c08a4d"},
    {key:"elevator",label:"电梯",pattern:/^ELEVATORS?__/,color:0x687da8,css:"#687da8"}
  ];
  const CONNECTORS=new Set(["elevator","escalator","stairs"]);
  const world=point=>new THREE.Vector3((point.x-VIEW.w/2)*SCALE,0,(point.y-VIEW.h/2)*SCALE);
  const distance2d=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

  function rootPoint(svg,node,x,y){
    const p=svg.createSVGPoint();p.x=x;p.y=y;
    const matrix=node.getCTM();if(!matrix)return{x,y};
    const result=p.matrixTransform(matrix);return{x:result.x,y:result.y};
  }
  function transformedPath(svg,node,spacing=18){
    let total=0;try{total=node.getTotalLength()}catch(_){return[]}
    if(!Number.isFinite(total)||total<=0)return[];
    const count=Math.max(12,Math.min(1800,Math.ceil(total/spacing))),points=[];
    for(let i=0;i<=count;i++){
      const local=node.getPointAtLength(total*i/count),point=rootPoint(svg,node,local.x,local.y);
      if(!points.length||Math.hypot(point.x-points.at(-1).x,point.y-points.at(-1).y)>.08)points.push(point);
    }
    return points;
  }
  function transformedSegments(svg,node,spacing=10){
    let total=0;try{total=node.getTotalLength()}catch(_){return[]}
    if(!Number.isFinite(total)||total<=0)return[];
    const count=Math.max(12,Math.min(2200,Math.ceil(total/spacing))),step=total/count,segments=[];let previousLocal=null,previousRoot=null;
    for(let i=0;i<=count;i++){
      const local=node.getPointAtLength(total*i/count),root=rootPoint(svg,node,local.x,local.y);
      if(previousLocal&&Math.hypot(local.x-previousLocal.x,local.y-previousLocal.y)<=step*4.5)segments.push([previousRoot,root]);
      previousLocal=local;previousRoot=root;
    }return segments;
  }
  function transformedSubpaths(svg,node,spacing=10){
    let total=0;try{total=node.getTotalLength()}catch(_){return[]}
    if(!Number.isFinite(total)||total<=0)return[];
    const count=Math.max(16,Math.min(2600,Math.ceil(total/spacing))),step=total/count,subpaths=[];let current=[],previousLocal=null;
    for(let i=0;i<=count;i++){
      const local=node.getPointAtLength(total*i/count),root=rootPoint(svg,node,local.x,local.y),jump=previousLocal&&Math.hypot(local.x-previousLocal.x,local.y-previousLocal.y)>step*4.5;
      if(jump&&current.length>2){subpaths.push(current);current=[]}if(!current.length||Math.hypot(root.x-current.at(-1).x,root.y-current.at(-1).y)>.08)current.push(root);previousLocal=local;
    }if(current.length>2)subpaths.push(current);return subpaths;
  }
  function shapeMesh(points,height,material){
    if(points.length<3)return null;
    const shape=new THREE.Shape();points.forEach((point,index)=>{const value=world(point);index?shape.lineTo(value.x,value.z):shape.moveTo(value.x,value.z)});shape.closePath();
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:true,bevelSize:.18,bevelThickness:.12,bevelSegments:1});
    const mesh=new THREE.Mesh(geometry,material);mesh.rotation.x=Math.PI/2;return mesh;
  }
  function drawShapePath(target,points){points.forEach((point,index)=>{const value=world(point);index?target.lineTo(value.x,value.z):target.moveTo(value.x,value.z)});target.closePath()}
  function polygonArea(points){return Math.abs(points.reduce((sum,point,index)=>{const next=points[(index+1)%points.length];return sum+point.x*next.y-next.x*point.y},0)/2)}
  function compoundShapeMesh(subpaths,height,material){
    const ordered=subpaths.filter(points=>points.length>=3).sort((a,b)=>polygonArea(b)-polygonArea(a));if(!ordered.length)return null;
    const shape=new THREE.Shape();drawShapePath(shape,ordered[0]);ordered.slice(1).forEach(points=>{const hole=new THREE.Path();drawShapePath(hole,points);shape.holes.push(hole)});
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:true,bevelSize:.16,bevelThickness:.1,bevelSegments:1}),mesh=new THREE.Mesh(geometry,material);mesh.rotation.x=Math.PI/2;return mesh;
  }
  function separateShapeMesh(subpaths,height,material){
    const shapes=subpaths.filter(points=>points.length>=3).map(points=>{const shape=new THREE.Shape();drawShapePath(shape,points);return shape});if(!shapes.length)return null;
    const geometry=new THREE.ExtrudeGeometry(shapes,{depth:height,bevelEnabled:true,bevelSize:.16,bevelThickness:.1,bevelSegments:1}),mesh=new THREE.Mesh(geometry,material);mesh.rotation.x=Math.PI/2;return mesh;
  }
  function pathSegments(points){return points.slice(1).map((point,index)=>[points[index],point])}
  function segmentBatch(segments,height,depth,material,baseY=0){
    const usable=segments.map(([a,b])=>{const p1=world(a),p2=world(b),dx=p2.x-p1.x,dz=p2.z-p1.z,length=Math.hypot(dx,dz);return{p1,p2,length,angle:-Math.atan2(dz,dx)}}).filter(item=>item.length>.08);
    if(!usable.length)return null;
    const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),material,usable.length),matrix=new THREE.Matrix4(),position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3(),axis=new THREE.Vector3(0,1,0);
    usable.forEach((item,index)=>{position.set((item.p1.x+item.p2.x)/2,baseY+height/2,(item.p1.z+item.p2.z)/2);quaternion.setFromAxisAngle(axis,item.angle);scale.set(item.length,height,depth);matrix.compose(position,quaternion,scale);mesh.setMatrixAt(index,matrix)});mesh.instanceMatrix.needsUpdate=true;return mesh;
  }
  function lineFromDoor(svg,node){
    return[rootPoint(svg,node,+node.getAttribute("x1"),+node.getAttribute("y1")),rootPoint(svg,node,+node.getAttribute("x2"),+node.getAttribute("y2"))];
  }
  function doorNumber(id){const match=String(id||"").trim().match(/__(\d{2,3})(?:\D|$)/);return match?+match[1]:null}
  function footprintFrame(svg,node){
    let box;try{box=node.getBBox()}catch(_){return null}if(!box||box.width<.1||box.height<.1)return null;
    const corners=[[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]].map(([x,y])=>world(rootPoint(svg,node,x,y)));
    const center=corners.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).multiplyScalar(.25);
    return{position:center,width:Math.max(.18,corners[0].distanceTo(corners[1])),depth:Math.max(.18,corners[1].distanceTo(corners[2])),rotation:-Math.atan2(corners[1].z-corners[0].z,corners[1].x-corners[0].x)};
  }
  function normalizedFacilityFrame(frame,type){
    const limits={
      elevator:{width:6,depth:6},
      stairs:{long:12,cross:6},
      escalator:{long:20,cross:6}
    }[type.key];
    if(!limits)return frame;
    const result={...frame,position:frame.position.clone()};
    if(limits.long){
      const alongDepth=result.depth>result.width;
      if(alongDepth){result.depth=Math.min(result.depth,limits.long);result.width=Math.min(result.width,limits.cross)}
      else{result.width=Math.min(result.width,limits.long);result.depth=Math.min(result.depth,limits.cross)}
    }else{
      result.width=Math.min(result.width,limits.width);result.depth=Math.min(result.depth,limits.depth);
    }
    return result;
  }
  function orientedBox(frame,height,color,baseY=0){const mesh=new THREE.Mesh(new THREE.BoxGeometry(frame.width,height,frame.depth),new THREE.MeshStandardMaterial({color,roughness:.62,metalness:.04}));mesh.position.set(frame.position.x,baseY+height/2,frame.position.z);mesh.rotation.y=frame.rotation;return mesh}
  function stairsObject(frame,color,escalator=false){
    const group=new THREE.Group(),alongDepth=frame.depth>frame.width,length=alongDepth?frame.depth:frame.width,cross=alongDepth?frame.width:frame.depth;group.position.set(frame.position.x,0,frame.position.z);group.rotation.y=frame.rotation+(alongDepth?-Math.PI/2:0);
    const material=new THREE.MeshStandardMaterial({color,roughness:.7,metalness:escalator?.12:0}),steps=escalator?MODEL_STANDARD.escalatorSteps:MODEL_STANDARD.stairsSteps,stepLength=length/steps,rise=escalator?MODEL_STANDARD.escalatorHeight:MODEL_STANDARD.stairsHeight;
    for(let index=0;index<steps;index++){const height=.1+rise*(index+1)/steps,step=new THREE.Mesh(new THREE.BoxGeometry(stepLength*1.04,height,Math.max(cross,.5)),material);step.position.set(-length/2+stepLength*(index+.5),height/2,0);group.add(step)}return group;
  }
  function facilityObject(sourceFrame,type){const frame=normalizedFacilityFrame(sourceFrame,type);if(["male","female","accessible"].includes(type.key))return orientedBox(frame,.02,type.color,.01);if(type.key==="elevator")return orientedBox(frame,MODEL_STANDARD.elevatorHeight,type.color,.02);if(type.key==="stairs")return stairsObject(frame,type.color,false);if(type.key==="escalator")return stairsObject(frame,type.color,true);return null}
  function semanticLeaves(root,pattern){
    const matches=[...root.querySelectorAll("[id]")].filter(node=>pattern.test((node.id||"").trim()));
    return matches.filter(node=>!matches.some(parent=>parent!==node&&parent.contains(node)));
  }
  function semanticGeometry(root,pattern){
    const selector="path,rect,polygon,polyline,circle,ellipse";
    const named=semanticLeaves(root,pattern).flatMap(node=>node.matches(selector)?[node]:[...node.querySelectorAll(selector)]);
    const unique=[];named.forEach(node=>{if(!unique.includes(node))unique.push(node)});return unique;
  }
  function facilityIcon(key){
    const icons={
      door:'<svg viewBox="0 0 24 24"><path d="M5 21V3h12v18M9 12h.01M17 21h3"/></svg>',
      male:'<svg viewBox="0 0 24 24"><circle cx="12" cy="4" r="2"/><path d="M8 21l1-7-2-5h10l-2 5 1 7M12 9v12"/></svg>',
      female:'<svg viewBox="0 0 24 24"><circle cx="12" cy="4" r="2"/><path d="m12 8-5 9h10l-5-9M9 21l1-4M15 21l-1-4"/></svg>',
      accessible:'<svg viewBox="0 0 24 24"><circle cx="10" cy="4.5" r="1.8"/><path d="M10 7v5h5l3 5M10 9H7M8 12a5 5 0 1 0 6 6M12 12l-2 6h5"/></svg>',
      elevator:'<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="1"/><path d="m9 8 3-3 3 3M15 16l-3 3-3-3M12 5v14"/></svg>',
      stairs:'<svg viewBox="0 0 24 24"><path d="M3 19h5v-4h4v-4h4V7h5"/></svg>',
      escalator:'<svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="1.7"/><path d="M4 20h4l8-10h4M7 8v5h4M20 10v4h-3"/></svg>'
    };return icons[key]||icons.elevator;
  }
  function addMarker(endpoint){
    const element=document.createElement("button");element.type="button";element.className=`navigation-marker ${endpoint.type}`;
    element.style.setProperty("--marker-color",endpoint.css);element.title=`设为终点：${endpoint.label}`;
    element.innerHTML=endpoint.type==="door"?String(endpoint.number).padStart(2,"0"):facilityIcon(endpoint.type);
    element.addEventListener("click",event=>{event.stopPropagation();destinationSelect.value=endpoint.id;destinationSelect.dispatchEvent(new Event("change"));document.querySelector("#routeButton").click()});
    labels.appendChild(element);endpoint.element=element;
  }

  async function start(){
    if(!window.THREE)throw new Error("3D组件加载失败，请联网刷新");
    const responses=await Promise.all(FLOOR_DEFS.map(def=>fetch(def.source)));
    responses.forEach((response,index)=>{if(!response.ok)throw new Error(`${FLOOR_DEFS[index].id} SVG读取失败`)});
    const texts=await Promise.all(responses.map(response=>response.text()));
    const svgs=texts.map((text,index)=>{const holder=document.querySelector(`#svgSource${FLOOR_DEFS[index].id}`);holder.innerHTML=text;return holder.querySelector("svg")});
    const compact=matchMedia("(max-width:720px)").matches;
    const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:"high-performance",logarithmicDepthBuffer:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,compact?1.15:1.45));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
    const scene=new THREE.Scene();scene.background=new THREE.Color(0x07111b);
    const camera=new THREE.PerspectiveCamera(42,1,.5,4000);scene.add(new THREE.HemisphereLight(0xd6f3ff,0x0c1b24,2.5));
    const sun=new THREE.DirectionalLight(0xfff5df,2.7);sun.position.set(-380,620,260);scene.add(sun);
    const rim=new THREE.DirectionalLight(0x57d9cc,1.15);rim.position.set(480,180,-360);scene.add(rim);
    const grid=new THREE.GridHelper(1120,28,0x28515e,0x132b35);grid.position.y=-2;scene.add(grid);
    const halls=[],endpoints=[],graph=new Map(),routeGroup=new THREE.Group(),floorModels=[],floorGroups=new Map(),wallObstacles=new Map(),walkableByFloor=new Map(),connectorPairs=[];scene.add(routeGroup);
    const floorDisplayOffset=floor=>viewMode==="ALL"?(FLOOR_DEFS.find(def=>def.id===floor)?.overviewOffset||0):0;
    const displayedPosition=(position,floor)=>position.clone().setY(position.y+floorDisplayOffset(floor));
    const ensureNode=node=>{if(!graph.has(node.id))graph.set(node.id,{node,edges:[]})};
    const edge=(a,b,weight,type="walk")=>{ensureNode(a);ensureNode(b);graph.get(a.id).edges.push({to:b.id,weight,type});graph.get(b.id).edges.push({to:a.id,weight,type})};

    FLOOR_DEFS.forEach((floorDef,floorIndex)=>{
      const svg=svgs[floorIndex],root=[...svg.children].find(node=>node.id===floorDef.root)||svg;
      const allGroups=[...root.querySelectorAll("g[id]")],hallNodes=floorDef.halls.map(id=>allGroups.find(node=>node.id===id)).filter(Boolean);
      const floorGroup=new THREE.Group();floorGroup.position.y=floorDef.overviewOffset;floorGroup.userData.floor=floorDef.id;floorGroup.userData.physicalElevation=floorDef.physicalElevation;scene.add(floorGroup);
      floorModels.push(floorGroup);floorGroups.set(floorDef.id,floorGroup);wallObstacles.set(floorDef.id,[]);walkableByFloor.set(floorDef.id,{ground:[],areas:[],blocked:[]});
      const groundContainer=[...root.children].find(child=>child.tagName?.toLowerCase()==="g"&&child.querySelector('path[id="Subtract"]'));
      const groundPath=groundContainer?.querySelector('path[id="Subtract"]');
      if(groundPath){
        const groundSubpaths=transformedSubpaths(svg,groundPath,8),groundMaterial=new THREE.MeshStandardMaterial({color:floorIndex?0x263a48:0x263f3f,roughness:.94,metalness:.01,transparent:true,opacity:.96});
        const groundMesh=compoundShapeMesh(groundSubpaths,MODEL_STANDARD.floorThickness,groundMaterial);if(groundMesh){groundMesh.position.y=-MODEL_STANDARD.floorThickness;floorGroup.add(groundMesh);floorGroup.userData.groundMesh=groundMesh}
        walkableByFloor.get(floorDef.id).ground=groundSubpaths.map(points=>points.map(world));
      }
      const mid={id:`${floorDef.id}:mid`,kind:"mid",floor:floorDef.id,position:new THREE.Vector3(0,.2,0)};ensureNode(mid);
      const centerNode=allGroups.find(node=>/^mid(?:_|$)/i.test(node.id||""));
      if(centerNode){
        const centerFloor=[...centerNode.children].find(node=>node.tagName?.toLowerCase()==="path"&&/^floor$/i.test(node.id||""))||[...root.children].find(node=>node.tagName?.toLowerCase()==="path"&&/^floor$/i.test(node.id||""));
        if(centerFloor){
          const subpaths=transformedSubpaths(svg,centerFloor,6),material=new THREE.MeshStandardMaterial({color:floorIndex?0x6c7f88:0x657e78,roughness:.8,metalness:.02});
          const evenodd=/evenodd/i.test(`${centerFloor.getAttribute("fill-rule")||""} ${centerFloor.getAttribute("clip-rule")||""}`),centerMesh=evenodd?compoundShapeMesh(subpaths,MODEL_STANDARD.floorThickness,material):separateShapeMesh(subpaths,MODEL_STANDARD.floorThickness,material);
          if(centerMesh){centerMesh.position.y=-MODEL_STANDARD.floorThickness;floorGroup.add(centerMesh)}
          const ordered=subpaths.filter(points=>points.length>=3).sort((a,b)=>polygonArea(b)-polygonArea(a));
          if(ordered[0])walkableByFloor.get(floorDef.id).areas.push(ordered[0].map(world));
          if(evenodd)walkableByFloor.get(floorDef.id).blocked.push(...ordered.slice(1).map(points=>points.map(world)));
        }
        const centerWall=[...centerNode.children].find(node=>/^WALLS?$/i.test((node.id||"").trim()));
        if(centerWall){
          const paths=centerWall.tagName.toLowerCase()==="path"?[centerWall]:[...centerWall.querySelectorAll("path")],segments=paths.flatMap(path=>transformedSegments(svg,path,7));
          [...centerWall.querySelectorAll?.("line")||[]].forEach(line=>segments.push(lineFromDoor(svg,line)));const mesh=segmentBatch(segments,MODEL_STANDARD.wallHeight,.26,new THREE.MeshStandardMaterial({color:0xe2edf0,roughness:.68}),0);if(mesh)floorGroup.add(mesh);wallObstacles.get(floorDef.id).push(...segments.map(([a,b])=>[world(a),world(b)]));
        }
        TYPES.filter(type=>CONNECTORS.has(type.key)).forEach(type=>semanticGeometry(centerNode,type.pattern).forEach(facility=>{const frame=footprintFrame(svg,facility),object=frame&&facilityObject(frame,type);if(object)floorGroup.add(object)}));
      }
      hallNodes.forEach((node,index)=>{
        const floor=node.querySelector('path[id^="FLOOR__"]');if(!floor)return;
        const floorPoints=transformedPath(svg,floor,18);if(floorPoints.length<3)return;
        walkableByFloor.get(floorDef.id).areas.push(floorPoints.map(world));
        const bounds=new THREE.Box3().setFromPoints(floorPoints.map(world)),center=bounds.getCenter(new THREE.Vector3());center.y=.2;
        const hall={id:node.id,floor:floorDef.id,node,center,bounds,group:new THREE.Group(),endpoints:[],materials:[]};hall.group.userData.hall=node.id;hall.group.userData.floor=floorDef.id;
        const cover=[...node.children].find(child=>child.tagName?.toLowerCase()==="path"&&/^(?:cover(?:_\d+)?|COVER__)/i.test((child.id||"").trim()))||floor;
        const coverPoints=transformedPath(svg,cover,18),coverMaterial=new THREE.MeshStandardMaterial({color:COLORS[index],roughness:.78,metalness:.02,transparent:true,opacity:floorIndex?.78:.92});
        const coverMesh=shapeMesh(coverPoints.length>=3?coverPoints:floorPoints,MODEL_STANDARD.floorThickness,coverMaterial);if(coverMesh){coverMesh.position.y=.03;coverMesh.userData.hall=node.id;coverMesh.userData.floor=floorDef.id;hall.group.add(coverMesh);hall.mesh=coverMesh;hall.coverMesh=coverMesh;hall.materials.push(coverMaterial)}
        const detailGroup=new THREE.Group();detailGroup.visible=false;hall.group.add(detailGroup);hall.detailGroup=detailGroup;
        const floorMaterial=new THREE.MeshStandardMaterial({color:COLORS[index],roughness:.72,metalness:.04,transparent:true,opacity:1});
        const floorMesh=shapeMesh(floorPoints,MODEL_STANDARD.floorThickness,floorMaterial);if(floorMesh){floorMesh.userData.hall=node.id;floorMesh.userData.floor=floorDef.id;detailGroup.add(floorMesh);hall.floorMesh=floorMesh}
        const wallMaterial=new THREE.MeshStandardMaterial({color:0xe2edf0,roughness:.68,transparent:true,opacity:.88});
        const wallContainer=[...node.children].find(child=>child.tagName?.toLowerCase()==="g"&&/^WALL(?:S)?(?:__|$)/i.test((child.id||"").trim()));
        const wallNodes=wallContainer?[...wallContainer.querySelectorAll("path")]:[...node.querySelectorAll('path[id^="WALLS__"],path[id^="WALL__"]')];
        const wallSegments=wallNodes.flatMap(wall=>transformedSegments(svg,wall,9));if(wallContainer)[...wallContainer.querySelectorAll("line")].forEach(wall=>wallSegments.push(lineFromDoor(svg,wall)));
        wallObstacles.get(floorDef.id).push(...wallSegments.map(([a,b])=>[world(a),world(b)]));
        const wallMesh=segmentBatch(wallSegments,MODEL_STANDARD.wallHeight,.26,wallMaterial,0);if(wallMesh){detailGroup.add(wallMesh);hall.wallMesh=wallMesh}
        const doorMaterial=new THREE.MeshPhysicalMaterial({color:0x89d9f2,roughness:.08,metalness:.05,transparent:true,opacity:.75,transmission:.2,depthWrite:false});
        floorGroup.add(hall.group);halls.push(hall);
        const centerNodeGraph={id:`${floorDef.id}:${node.id}:center`,kind:"hall",floor:floorDef.id,hall:node.id,position:center.clone()};ensureNode(centerNodeGraph);edge(centerNodeGraph,mid,distance2d(centerNodeGraph.position,mid.position)+16);
        const hallLabel=document.createElement("button");hallLabel.type="button";hallLabel.className="hall-label";hallLabel.textContent=node.id+"馆";hallLabel.style.pointerEvents="auto";
        hallLabel.addEventListener("click",()=>focusHall(hall));labels.appendChild(hallLabel);hall.label=hallLabel;
        const doorNodes=[...node.querySelectorAll('line[id*="DOOR"]')],doorSegments=doorNodes.map(door=>lineFromDoor(svg,door));
        const doorMesh=segmentBatch(doorSegments,MODEL_STANDARD.doorHeight,.1,doorMaterial,0);if(doorMesh){detailGroup.add(doorMesh);hall.doorMesh=doorMesh}
        doorNodes.forEach((door,doorIndex)=>{
          const [a,b]=doorSegments[doorIndex],position=world(a).add(world(b)).multiplyScalar(.5);position.y=.2;
          const number=doorNumber(door.id)||doorIndex+1,id=`${floorDef.id}:${node.id}:door:${number}:${doorIndex}`;
          const endpoint={id,kind:"endpoint",type:"door",floor:floorDef.id,hall:node.id,number,position,label:`${floorDef.id} · ${node.id}馆 · ${number}号门`,css:"#5cbdda"};
          endpoints.push(endpoint);hall.endpoints.push(endpoint);ensureNode(endpoint);edge(endpoint,centerNodeGraph,distance2d(position,center)+3);addMarker(endpoint);
        });
        TYPES.forEach(type=>{
          const counts={};semanticGeometry(node,type.pattern).forEach(facility=>{
            const frame=footprintFrame(svg,facility);if(!frame)return;counts[type.key]=(counts[type.key]||0)+1;
            const object=facilityObject(frame,type);if(object)detailGroup.add(object);
            const position=frame.position.clone();position.y=.2;
            const endpoint={id:`${floorDef.id}:${node.id}:${type.key}:${counts[type.key]}`,kind:"endpoint",type:type.key,floor:floorDef.id,hall:node.id,index:counts[type.key],position,label:`${floorDef.id} · ${node.id}馆 · ${type.label}${counts[type.key]}号`,css:type.css};
            endpoints.push(endpoint);hall.endpoints.push(endpoint);ensureNode(endpoint);edge(endpoint,centerNodeGraph,distance2d(position,center)+3);addMarker(endpoint);
          });
        });
      });
      const badge=document.createElement("span");badge.className=`floor-badge ${floorDef.id.toLowerCase()}`;badge.textContent=floorDef.id;labels.appendChild(badge);floorGroup.userData.badge=badge;floorGroup.userData.badgePosition=new THREE.Vector3(-430,8,-360);
    });

    const connectorTypes=["elevator","escalator","stairs"];
    connectorTypes.forEach(type=>{
      const lower=endpoints.filter(node=>node.floor==="F1"&&node.type===type),upper=endpoints.filter(node=>node.floor==="F3"&&node.type===type);
      lower.forEach(from=>{
        const sameWing=upper.filter(to=>to.hall.split(".")[0]===from.hall.split(".")[0]);
        const candidates=sameWing.length?sameWing:upper;if(!candidates.length)return;
        const to=candidates.reduce((best,item)=>!best||distance2d(from.position,item.position)<distance2d(from.position,best.position)?item:best,null);
        edge(from,to,MODEL_STANDARD.explodedFloorGap,type);connectorPairs.push({type,lower:from,upper:to});
      });
    });
    const defaultStartForView=mode=>{
      const floor=mode==="F3"?"F3":"F1",hall=floor==="F3"?"1.2":"1.1";
      return endpoints.find(node=>node.floor===floor&&node.hall===hall&&node.type==="door"&&node.number===1)||endpoints.find(node=>node.floor===floor&&node.hall===hall&&node.type==="door");
    };
    const defaultStart=defaultStartForView(viewMode);
    populateSelects(defaultStart);

    const modelBounds=new THREE.Box3();halls.forEach(hall=>modelBounds.union(hall.bounds));
    const campusHome=modelBounds.getCenter(new THREE.Vector3()),size=Math.max(modelBounds.max.x-modelBounds.min.x,modelBounds.max.z-modelBounds.min.z);campusHome.y=MODEL_STANDARD.explodedFloorGap/2;
    const homeForView=mode=>new THREE.Vector3(campusHome.x,mode==="ALL"?MODEL_STANDARD.explodedFloorGap/2:.2,campusHome.z);
    const WALL_BUCKET=20,GRID_STEP=7,wallIndexes=new Map();
    const bucketKey=(x,z)=>`${Math.floor(x/WALL_BUCKET)},${Math.floor(z/WALL_BUCKET)}`;
    wallObstacles.forEach((segments,floor)=>{
      const index=new Map();segments.forEach(segment=>{const [a,b]=segment,minX=Math.floor((Math.min(a.x,b.x)-2)/WALL_BUCKET),maxX=Math.floor((Math.max(a.x,b.x)+2)/WALL_BUCKET),minZ=Math.floor((Math.min(a.z,b.z)-2)/WALL_BUCKET),maxZ=Math.floor((Math.max(a.z,b.z)+2)/WALL_BUCKET);for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){const key=`${x},${z}`;if(!index.has(key))index.set(key,[]);index.get(key).push(segment)}});wallIndexes.set(floor,index);
    });
    let target=homeForView(viewMode),desiredTarget=homeForView(viewMode),distance=size*(compact?2.8:2.0),desiredDistance=distance,azimuth=-.78,polar=.72,focusedHall=null;
    const overviewDistance=distance,minDistance=size*.14,maxDistance=size*3.0,raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
    let activeRoute=[],selectedDestination=null,framePending=false,travel=0,last=[0,0],dragAction="orbit";const pointers=new Map();

    function setViewMode(mode,{updateUrl=true,manual=false}={}){
      if(!["ALL","F1","F3"].includes(mode))mode="ALL";
      if(manual&&mode!=="ALL"&&activeRoute.some(node=>node.floor!==mode))clearRoute();
      viewMode=mode;
      floorModels.forEach(group=>{group.visible=mode==="ALL"||group.userData.floor===mode;group.position.y=floorDisplayOffset(group.userData.floor)});
      grid.position.y=-2;
      document.querySelectorAll("[data-view]").forEach(link=>{const active=link.dataset.view===mode;link.classList.toggle("active",active);link.setAttribute("aria-current",active?"page":"false")});
      const code=document.querySelector("#viewCode"),name=document.querySelector("#viewName"),hint=document.querySelector("#viewHint");
      code.textContent=mode==="ALL"?"F1+F3":mode;name.textContent=mode==="ALL"?"F1 + F3 场馆总览":`${mode} 场馆层`;hint.textContent=mode==="ALL"?"楼层间距为示意距离":"本层可直接规划路线";
      document.querySelector("#fitButton").textContent=mode==="ALL"?"双层全景":`${mode}全景`;
      if(manual&&!activeRoute.length){
        const start=defaultStartForView(mode);if(start)startSelect.value=start.id;
        routeSummary.textContent=start?`默认起点：${start.label}`:"请选择导航起点";
      }
      if(updateUrl){const url=new URL(location.href);url.searchParams.set("view",mode);url.searchParams.delete("floor");history.replaceState({view:mode},"",url)}
      focusedHall=null;updateHallRendering();desiredTarget.copy(homeForView(mode));desiredDistance=overviewDistance;requestRender();
    }

    function populateSelects(start){
      const byFloor=floor=>endpoints.filter(node=>node.floor===floor);
      const options=FLOOR_DEFS.map(def=>`<optgroup label="${def.id}">${byFloor(def.id).map(node=>`<option value="${node.id}">${node.label.replace(`${def.id} · `,"")}</option>`).join("")}</optgroup>`).join("");
      startSelect.innerHTML=options;destinationSelect.innerHTML='<option value="">请选择门、厕所、电梯、扶梯或楼梯</option>'+options;
      if(start)startSelect.value=start.id;clearRouteButton.disabled=true;
    }
    function updateHallRendering(){
      const routeHalls=new Set(activeRoute.filter(node=>node.hall).map(node=>`${node.floor}:${node.hall}`));
      halls.forEach(item=>{
        const key=`${item.floor}:${item.id}`,onRoute=routeHalls.has(key),detailed=onRoute||(!activeRoute.length&&item===focusedHall),emphasized=onRoute||(!activeRoute.length&&(!focusedHall||item===focusedHall));
        if(item.coverMesh)item.coverMesh.visible=!detailed;if(item.detailGroup)item.detailGroup.visible=detailed;
        item.materials.forEach(material=>material.opacity=emphasized?(item.floor==="F3"?.78:.92):.14);
        item.label.classList.toggle("focused",onRoute||item===focusedHall);
      });
    }
    function focusHall(hall,move=true){
      focusedHall=hall||null;updateHallRendering();
      if(hall&&move){desiredTarget.copy(displayedPosition(hall.center,hall.floor));desiredDistance=size*.48}requestRender();
    }
    function setDestination(id){
      selectedDestination=endpoints.find(node=>node.id===id)||null;endpoints.forEach(node=>node.element.classList.toggle("selected",node===selectedDestination));
      if(selectedDestination){const hall=halls.find(item=>item.floor===selectedDestination.floor&&item.id===selectedDestination.hall);if(hall)focusHall(hall,false)}requestRender();
    }
    function routeWeights(preference,type){
      if(type==="walk")return 1;const defaults={elevator:1,escalator:1.08,stairs:1.22};if(preference==="default")return defaults[type]||1;
      return type===preference?.18:6;
    }
    function shortestPath(startId,endId,preference){
      const distances=new Map([...graph.keys()].map(id=>[id,Infinity])),previous=new Map(),unvisited=new Set(graph.keys());distances.set(startId,0);
      while(unvisited.size){
        let current=null,best=Infinity;unvisited.forEach(id=>{const value=distances.get(id);if(value<best){best=value;current=id}});if(current===null||current===endId)break;unvisited.delete(current);
        graph.get(current).edges.forEach(item=>{if(!unvisited.has(item.to))return;const alt=best+item.weight*routeWeights(preference,item.type);if(alt<distances.get(item.to)){distances.set(item.to,alt);previous.set(item.to,{id:current,type:item.type})}});
      }
      if(!previous.has(endId)&&startId!==endId)return null;const ids=[endId],types=[];while(ids[0]!==startId){const step=previous.get(ids[0]);if(!step)return null;types.unshift(step.type);ids.unshift(step.id)}return{nodes:ids.map(id=>graph.get(id).node),types,cost:distances.get(endId)};
    }
    function nearestEndpoint(origin,candidates){
      return candidates.reduce((best,item)=>!best||distance2d(origin.position,item.position)<distance2d(origin.position,best.position)?item:best,null);
    }
    function nearestDoor(origin,floor,hall){
      return nearestEndpoint(origin,endpoints.filter(node=>node.floor===floor&&node.hall===hall&&node.type==="door"));
    }
    function nearestReachableDoor(origin,floor,hall){
      const doors=endpoints.filter(node=>node.floor===floor&&node.hall===hall&&node.type==="door").sort((a,b)=>distance2d(origin.position,a.position)-distance2d(origin.position,b.position));
      return doors.find(door=>collisionAwarePath(origin.position,door.position,floor))||null;
    }
    function chooseConnector(start,end,preference,excludedTypes=new Set()){
      let candidates=connectorPairs.map(pair=>start.floor==="F1"?{type:pair.type,from:pair.lower,to:pair.upper}:{type:pair.type,from:pair.upper,to:pair.lower}).filter(pair=>pair.to.floor===end.floor&&!excludedTypes.has(pair.type));
      const sameHall=candidates.filter(pair=>pair.from.hall===start.hall);if(sameHall.length)candidates=sameHall;
      const assessed=candidates.map(pair=>{
        const arrivalDoors=pair.to.hall===end.hall?[]:endpoints.filter(node=>node.floor===pair.to.floor&&node.hall===pair.to.hall&&node.type==="door").sort((a,b)=>distance2d(pair.to.position,a.position)-distance2d(pair.to.position,b.position));
        const arrivalExit=arrivalDoors.find(door=>!movementBlocked(pair.to.position,door.position,pair.to.floor))||arrivalDoors[0]||null;
        const destinationBonus=pair.to.id===end.id?-10000:0,defaultPenalty={elevator:0,escalator:14,stairs:28}[pair.type]||0,preferencePenalty=preference!=="default"&&pair.type!==preference?10000:0;
        const blockedPenalty=movementBlocked(start.position,pair.from.position,start.floor)?1200:0,arrivalBlockedPenalty=arrivalExit&&movementBlocked(pair.to.position,arrivalExit.position,pair.to.floor)?1200:0;
        const score=distance2d(start.position,pair.from.position)+distance2d(pair.to.position,end.position)*.18+defaultPenalty+preferencePenalty+destinationBonus+blockedPenalty+arrivalBlockedPenalty;
        return{...pair,arrivalExit,score};
      }).sort((a,b)=>a.score-b.score);
      return assessed[0]||null;
    }
    function ruleBasedRoute(start,end,preference,excludedTypes=new Set()){
      const nodes=[start],types=[],steps=[];
      const append=(node,type="walk")=>{if(node&&node.id!==nodes.at(-1).id){types.push(type);nodes.push(node)}};
      if(start.floor===end.floor&&start.hall===end.hall){
        append(end);steps.push(`由${start.type==="door"?`${start.number}号门进入场馆`:"当前位置"}前往目标`);
        return{nodes,types,rule:"同馆导航",steps};
      }
      if(start.floor===end.floor){
        const sourceExit=start.type==="door"?start:nearestReachableDoor(start,start.floor,start.hall),targetEntry=end.type==="door"?end:nearestReachableDoor(end,end.floor,end.hall);
        if(!sourceExit||!targetEntry)return null;
        append(sourceExit);append(targetEntry);append(end);
        steps.push(`从${start.hall}馆${sourceExit.number}号门出馆`,`经${start.floor}公共区域步行`,`由${end.hall}馆${targetEntry.number}号门进入`);
        return{nodes,types,rule:"同层跨馆",steps};
      }
      const connector=chooseConnector(start,end,preference,excludedTypes);if(!connector)return null;
      const connectorName=TYPES.find(type=>type.key===connector.type)?.label||connector.type;
      append(connector.from);append(connector.to,connector.type);
      steps.push(`前往${start.hall}馆${connectorName}${connector.from.index}号`,`乘${connectorName}到${end.floor}`);
      if(connector.to.hall!==end.hall){
        const arrivalExit=connector.arrivalExit||nearestReachableDoor(connector.to,connector.to.floor,connector.to.hall),targetEntry=end.type==="door"?end:nearestReachableDoor(end,end.floor,end.hall);
        if(!arrivalExit||!targetEntry)return null;
        append(arrivalExit);append(targetEntry);append(end);
        steps.push(`从${connector.to.hall}馆${arrivalExit.number}号门出馆`,`经${end.floor}公共区域步行`,`由${end.hall}馆${targetEntry.number}号门进入`);
      }else{
        append(end);steps.push(`在${end.hall}馆内前往目标`);
      }
      return{nodes,types,rule:"跨层导航",steps,connector:connector.type};
    }
    function pointInPolygon(point,polygon){
      let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j],cross=(a.z>point.z)!==(b.z>point.z)&&point.x<(b.x-a.x)*(point.z-a.z)/(b.z-a.z||1e-9)+a.x;if(cross)inside=!inside}return inside;
    }
    function isWalkable(point,floor){
      const regions=walkableByFloor.get(floor);if(!regions||regions.blocked.some(polygon=>pointInPolygon(point,polygon)))return false;if(regions.areas.some(polygon=>pointInPolygon(point,polygon)))return true;
      return regions.ground.reduce((inside,polygon)=>inside!==pointInPolygon(point,polygon),false);
    }
    function distanceToSegment(point,a,b){const dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz;if(!length)return Math.hypot(point.x-a.x,point.z-a.z);const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.z-a.z)*dz)/length)),x=a.x+t*dx,z=a.z+t*dz;return Math.hypot(point.x-x,point.z-z)}
    function isWallBlocked(point,floor){
      const index=wallIndexes.get(floor),cx=Math.floor(point.x/WALL_BUCKET),cz=Math.floor(point.z/WALL_BUCKET);if(!index)return false;
      for(let x=cx-1;x<=cx+1;x++)for(let z=cz-1;z<=cz+1;z++)for(const [a,b] of index.get(`${x},${z}`)||[])if(distanceToSegment(point,a,b)<1.45)return true;return false;
    }
    function segmentsIntersect(a,b,c,d){
      const orient=(p,q,r)=>(q.x-p.x)*(r.z-p.z)-(q.z-p.z)*(r.x-p.x),o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b);return o1*o2<0&&o3*o4<0;
    }
    function movementBlocked(from,to,floor){
      const index=wallIndexes.get(floor);if(!index)return false;const minX=Math.floor(Math.min(from.x,to.x)/WALL_BUCKET),maxX=Math.floor(Math.max(from.x,to.x)/WALL_BUCKET),minZ=Math.floor(Math.min(from.z,to.z)/WALL_BUCKET),maxZ=Math.floor(Math.max(from.z,to.z)/WALL_BUCKET),seen=new Set();
      for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++)for(const segment of index.get(`${x},${z}`)||[]){if(seen.has(segment))continue;seen.add(segment);if(segmentsIntersect(from,to,segment[0],segment[1]))return true}return false;
    }
    const gridPoint=(gx,gz,floor)=>new THREE.Vector3(modelBounds.min.x+gx*GRID_STEP,.2,modelBounds.min.z+gz*GRID_STEP);
    function nearestGrid(point,floor){
      const baseX=Math.round((point.x-modelBounds.min.x)/GRID_STEP),baseZ=Math.round((point.z-modelBounds.min.z)/GRID_STEP);
      for(let radius=0;radius<15;radius++)for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius;dz<=radius;dz++){if(radius&&Math.abs(dx)!==radius&&Math.abs(dz)!==radius)continue;const p=gridPoint(baseX+dx,baseZ+dz,floor);if(isWalkable(p,floor)&&!isWallBlocked(p,floor))return{gx:baseX+dx,gz:baseZ+dz,point:p}}return null;
    }
    function collisionAwarePath(from,to,floor){
      const start=nearestGrid(from,floor),goal=nearestGrid(to,floor);if(!start||!goal)return null;
      const key=(x,z)=>`${x},${z}`,startKey=key(start.gx,start.gz),goalKey=key(goal.gx,goal.gz),open=new Set([startKey]),nodes=new Map([[startKey,start]]),g=new Map([[startKey,0]]),f=new Map([[startKey,Math.hypot(start.gx-goal.gx,start.gz-goal.gz)]]),came=new Map();let iterations=0;
      const directions=[[-1,0,1],[1,0,1],[0,-1,1],[0,1,1],[-1,-1,1.414],[-1,1,1.414],[1,-1,1.414],[1,1,1.414]];
      while(open.size&&iterations++<30000){
        let current=null,best=Infinity;open.forEach(id=>{const score=f.get(id)??Infinity;if(score<best){best=score;current=id}});if(current===goalKey){const result=[];let cursor=current;while(cursor){result.unshift(nodes.get(cursor).point);cursor=came.get(cursor)}const exactStart=isWalkable(from,floor)&&!isWallBlocked(from,floor)&&!movementBlocked(from,result[0],floor),exactEnd=isWalkable(to,floor)&&!isWallBlocked(to,floor)&&!movementBlocked(result.at(-1),to,floor);if(exactStart)result.unshift(from.clone());if(exactEnd)result.push(to.clone());return result}
        open.delete(current);const node=nodes.get(current);
        for(const [dx,dz,cost] of directions){const gx=node.gx+dx,gz=node.gz+dz,id=key(gx,gz),point=gridPoint(gx,gz,floor);if(!isWalkable(point,floor)||isWallBlocked(point,floor)||movementBlocked(node.point,point,floor))continue;const tentative=(g.get(current)||0)+cost;if(tentative>=(g.get(id)??Infinity))continue;nodes.set(id,{gx,gz,point});came.set(id,current);g.set(id,tentative);f.set(id,tentative+Math.hypot(gx-goal.gx,gz-goal.gz));open.add(id)}
      }return null;
    }
    function simplifyGridPath(points){
      if(points.length<3)return points;const result=[points[0]];for(let i=1;i<points.length-1;i++){const a=result.at(-1),b=points[i],c=points[i+1],cross=(b.x-a.x)*(c.z-b.z)-(b.z-a.z)*(c.x-b.x);if(Math.abs(cross)>.01)result.push(b)}result.push(points.at(-1));return result;
    }
    function collisionAwareRoute(result){
      const points=[];for(let index=0;index<result.nodes.length-1;index++){const from=result.nodes[index],to=result.nodes[index+1];if(from.floor!==to.floor){const fromPoint=displayedPosition(from.position,from.floor),toPoint=displayedPosition(to.position,to.floor);if(!points.length||!points.at(-1).equals(fromPoint))points.push(fromPoint);points.push(toPoint);continue}const section=collisionAwarePath(from.position,to.position,from.floor);if(!section){result.failedSegment={from,to};return null}const simplified=simplifyGridPath(section).map(point=>displayedPosition(point,from.floor));points.push(...(points.length?simplified.slice(1):simplified))}return points;
    }
    function drawRoute(result){
      routeGroup.clear();if(!result)return false;const points=collisionAwareRoute(result);if(!points||!points.length)return false;if(points.length===1)points.push(points[0].clone().add(new THREE.Vector3(0,.1,0)));
      const curve=new THREE.CatmullRomCurve3(points,false,"centripetal",.12),tube=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(24,points.length*14),.72,7,false),new THREE.MeshBasicMaterial({color:0xffd35b,transparent:true,opacity:.96}));routeGroup.add(tube);
      [points[0],points.at(-1)].forEach((point,index)=>{const marker=new THREE.Mesh(new THREE.SphereGeometry(index?2.2:1.7,18,12),new THREE.MeshBasicMaterial({color:index?0xff7a68:0x5ff1d2}));marker.position.copy(point);routeGroup.add(marker)});
      return true;
    }
    function planRoute(){
      const start=endpoints.find(node=>node.id===startSelect.value),end=endpoints.find(node=>node.id===destinationSelect.value);if(!start||!end){routeSummary.textContent="请先选择导航终点";return}
      const requiredView=start.floor===end.floor?start.floor:"ALL";if(requiredView!==viewMode)setViewMode(requiredView,{updateUrl:true});
      const preference=document.querySelector('input[name="routePreference"]:checked').value;let result=ruleBasedRoute(start,end,preference),routeDrawn=drawRoute(result);
      if(result&&!routeDrawn&&start.floor!==end.floor&&preference!=="default"){
        result=ruleBasedRoute(start,end,"default",new Set([preference]));if(result)result.fallbackFrom=preference;routeDrawn=drawRoute(result);
      }
      activeRoute=result?.nodes||[];setDestination(end.id);updateHallRendering();
      if(!result){routeState.textContent="不可达";routeState.classList.remove("active");routeSummary.textContent="当前数据中没有可用的跨层连接";return}
      if(!routeDrawn){activeRoute=[];updateHallRendering();routeState.textContent="不可达";routeState.classList.remove("active");routeSummary.textContent=result.failedSegment?`${result.failedSegment.from.label} → ${result.failedSegment.to.label} 被墙体或地面边界阻挡`:"墙体或地面边界阻挡了当前路线，请更换终点或换层方式";return}
      const vertical=result.types.find(type=>CONNECTORS.has(type)),preferenceNames={default:"默认",elevator:"优先电梯",escalator:"优先扶梯",stairs:"优先楼梯"};
      routeState.textContent="导航中";routeState.classList.add("active");clearRouteButton.disabled=false;
      const fallback=result.fallbackFrom?`（${preferenceNames[result.fallbackFrom]}不可达，已自动改道）`:"";
      routeSummary.textContent=`${result.rule} · ${preferenceNames[preference]}${fallback}${vertical?` · 经${TYPES.find(type=>type.key===vertical)?.label||vertical}`:""}｜${result.steps.join(" → ")}`;
      const displayedStart=displayedPosition(start.position,start.floor),displayedEnd=displayedPosition(end.position,end.floor);desiredTarget.copy(displayedStart).add(displayedEnd).multiplyScalar(.5);desiredDistance=Math.max(size*.55,displayedStart.distanceTo(displayedEnd)*1.35);requestRender();
    }
    function clearRoute(){routeGroup.clear();activeRoute=[];selectedDestination=null;destinationSelect.value="";endpoints.forEach(node=>node.element.classList.remove("selected"));routeState.textContent="未开始";routeState.classList.remove("active");const start=endpoints.find(node=>node.id===startSelect.value);routeSummary.textContent=start?`当前起点：${start.label}`:"请选择导航起点";clearRouteButton.disabled=true;focusHall(null,false);requestRender()}
    document.querySelector("#routeButton").addEventListener("click",planRoute);clearRouteButton.addEventListener("click",clearRoute);destinationSelect.addEventListener("change",()=>setDestination(destinationSelect.value));
    document.querySelectorAll('input[name="routePreference"]').forEach(input=>input.addEventListener("change",()=>{if(activeRoute.length)planRoute()}));
    document.querySelector("#fitButton").addEventListener("click",()=>{focusHall(null,false);desiredTarget.copy(homeForView(viewMode));desiredDistance=overviewDistance;requestRender()});
    document.querySelectorAll("[data-view]").forEach(link=>link.addEventListener("click",event=>{event.preventDefault();setViewMode(link.dataset.view,{updateUrl:true,manual:true})}));

    function pan(dx,dy){const wpp=2*distance*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/Math.max(stage.clientHeight,1),forward=new THREE.Vector3(-Math.sin(azimuth),0,-Math.cos(azimuth)).normalize(),right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();desiredTarget.addScaledVector(right,-dx*wpp).addScaledVector(forward,dy*wpp)}
    canvas.addEventListener("contextmenu",event=>event.preventDefault());
    canvas.addEventListener("pointerdown",event=>{if(event.button>2)return;event.preventDefault();canvas.setPointerCapture(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});last=[event.clientX,event.clientY];travel=0;dragAction=event.pointerType==="mouse"?(event.button===2?"orbit":"pan"):"orbit"});
    canvas.addEventListener("pointermove",event=>{if(!pointers.has(event.pointerId))return;const prev=pointers.get(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});const dx=event.clientX-prev.x,dy=event.clientY-prev.y;travel+=Math.hypot(dx,dy);if(pointers.size>1){pan(dx/2,dy/2)}else if(dragAction==="pan")pan(dx,dy);else{azimuth-=dx*.006;polar=THREE.MathUtils.clamp(polar+dy*.005,.17,1.28)}requestRender()});
    const pointerUp=event=>{pointers.delete(event.pointerId);try{canvas.releasePointerCapture(event.pointerId)}catch(_){}};canvas.addEventListener("pointerup",pointerUp);canvas.addEventListener("pointercancel",pointerUp);
    canvas.addEventListener("wheel",event=>{event.preventDefault();desiredDistance=THREE.MathUtils.clamp(desiredDistance*Math.exp(event.deltaY*.001),minDistance,maxDistance);requestRender()},{passive:false});
    canvas.addEventListener("click",event=>{if(travel>6)return;const rect=canvas.getBoundingClientRect();pointer.x=(event.clientX-rect.left)/rect.width*2-1;pointer.y=-(event.clientY-rect.top)/rect.height*2+1;raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(halls.filter(hall=>viewMode==="ALL"||hall.floor===viewMode).map(hall=>hall.coverMesh?.visible?hall.coverMesh:hall.floorMesh).filter(Boolean),false)[0];if(hit){const hall=halls.find(item=>item.id===hit.object.userData.hall&&item.floor===hit.object.userData.floor);if(hall)focusHall(hall)}});

    function resize(){const rect=stage.getBoundingClientRect();renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();requestRender()}
    function requestRender(){if(!framePending){framePending=true;requestAnimationFrame(tick)}}
    function tick(){
      framePending=false;target.lerp(desiredTarget,.16);distance=THREE.MathUtils.lerp(distance,desiredDistance,.15);const sin=Math.sin(polar);camera.position.set(target.x+distance*sin*Math.sin(azimuth),target.y+distance*Math.cos(polar),target.z+distance*sin*Math.cos(azimuth));camera.lookAt(target);camera.updateMatrixWorld();renderer.render(scene,camera);
      const rect=stage.getBoundingClientRect(),occupied=[];halls.forEach(hall=>{if(viewMode!=="ALL"&&hall.floor!==viewMode){hall.label.style.display="none";return}const p=displayedPosition(hall.center,hall.floor).add(new THREE.Vector3(0,6,0)).project(camera),x=(p.x*.5+.5)*rect.width,y=(-p.y*.5+.5)*rect.height,visible=p.z>-1&&p.z<1&&x>30&&x<rect.width-30&&y>24&&y<rect.height-24;hall.label.style.display=visible?"block":"none";if(visible){hall.label.style.left=x+"px";hall.label.style.top=y+"px"}});
      FLOOR_DEFS.forEach(def=>{const group=floorGroups.get(def.id);if(!group)return;if(viewMode!=="ALL"&&def.id!==viewMode){group.userData.badge.style.display="none";return}group.userData.badge.style.display="block";const p=displayedPosition(group.userData.badgePosition,def.id).project(camera),x=(p.x*.5+.5)*rect.width,y=(-p.y*.5+.5)*rect.height;group.userData.badge.style.left=x+"px";group.userData.badge.style.top=y+"px"});
      const showMarkers=focusedHall||distance<size*.62;endpoints.forEach(node=>{const onVisibleFloor=viewMode==="ALL"||node.floor===viewMode,allowed=onVisibleFloor&&showMarkers&&(focusedHall?node.floor===focusedHall.floor&&node.hall===focusedHall.id:true);if(!allowed){node.element.style.display="none";return}const p=displayedPosition(node.position,node.floor).project(camera),x=Math.round((p.x*.5+.5)*rect.width),y=Math.round((-p.y*.5+.5)*rect.height),inView=p.z>-1&&p.z<1&&x>18&&x<rect.width-18&&y>18&&y<rect.height-18,overlap=occupied.some(point=>Math.abs(point.x-x)<27&&Math.abs(point.y-y)<27);const important=node===selectedDestination||node.id===startSelect.value,visible=inView&&(important||!overlap);node.element.style.display=visible?"grid":"none";if(visible){node.element.style.left=x+"px";node.element.style.top=y+"px";occupied.push({x,y})}});
      if(target.distanceToSquared(desiredTarget)>.001||Math.abs(distance-desiredDistance)>.02)requestRender();
    }
    addEventListener("resize",resize);setViewMode(viewMode,{updateUrl:false});resize();loading.classList.add("hidden");status.textContent=`已识别 ${halls.length} 个展馆、${endpoints.length} 个可导航终点`;requestRender();
  }
  start().catch(error=>{console.error(error);loading.textContent=error.message;status.textContent="多层地图生成失败"});
})();
