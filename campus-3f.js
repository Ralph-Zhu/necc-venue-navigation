(function(){
  "use strict";

  const FLOOR_CONFIGS={
    F1:{source:"./assets/figma-f1-full-v3.svg?v=20260904-1",root:"F1",name:"一楼展馆层",halls:["1.1","2.1","3.1","4.1","5.1","6.1","7.1","8.1"]},
    F3:{source:"./assets/figma-f3-full-v6.svg?v=20260903-2",root:"F3",name:"三楼展馆层",halls:["1.2","2.2","3.2","4.2","5.2","6.2","7.2","8.2"]}
  };
  const requestedFloor=(new URLSearchParams(location.search).get("floor")||"F3").toUpperCase();
  const FLOOR=FLOOR_CONFIGS[requestedFloor]?requestedFloor:"F3";
  const FLOOR_CONFIG=FLOOR_CONFIGS[FLOOR];
  const SOURCE=FLOOR_CONFIG.source;
  const SCALE=.1;
  let VIEW={w:8272,h:8274};
  const HALL_ORDER=FLOOR_CONFIG.halls;
  const COLORS=[0x4e9f92,0x4d91aa,0x637dab,0x8a6fa8,0xa66f87,0xa9795c,0x6f9c74,0x4f8f9d];
  const sourceHolder=document.querySelector("#svgSource");
  const canvas=document.querySelector("#mapCanvas");
  const stage=document.querySelector("#mapStage");
  const labelLayer=document.querySelector("#hallLabels");
  const status=document.querySelector("#mapStatus");
  const loading=document.querySelector("#loading");
  const focusCard=document.querySelector("#focusCard");
  const focusName=document.querySelector("#focusName");
  const enterHall=document.querySelector("#enterHall");
  const pageTitle=document.querySelector("#pageTitle");
  const floorCode=document.querySelector("#floorCode");
  const floorName=document.querySelector("#floorName");
  const hallSwitcher=document.querySelector("#hallSwitcher");
  const quickEntry=document.querySelector("#quickEntry");

  document.title=`国家会展中心 · ${FLOOR}场馆总览`;
  pageTitle.textContent=`${FLOOR} 场馆总览`;
  floorCode.textContent=FLOOR;floorName.textContent=FLOOR_CONFIG.name;
  status.textContent=`正在识别 ${FLOOR} SVG…`;
  quickEntry.hidden=FLOOR!=="F3";
  document.querySelectorAll("[data-floor]").forEach(link=>link.classList.toggle("active",link.dataset.floor===FLOOR));
  hallSwitcher.innerHTML=['<button type="button" class="active" data-hall="all">全部</button>',...HALL_ORDER.map(id=>`<button type="button" data-hall="${id}">${id}</button>`)].join("");

  function parsePath(d){
    const tokens=d.match(/[MLHVZmlhvz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)||[];
    const subpaths=[],segments=[];
    let current=[],i=0,cmd="",x=0,y=0,start=null;
    const isCmd=value=>/^[MLHVZmlhvz]$/.test(value);
    const move=p=>{if(current.length)subpaths.push(current);current=[p];start=p;x=p[0];y=p[1]};
    const line=p=>{if(!current.length)move([x,y]);segments.push([[x,y],p]);current.push(p);x=p[0];y=p[1]};
    while(i<tokens.length){
      if(isCmd(tokens[i]))cmd=tokens[i++];
      if(!cmd)break;
      const upper=cmd.toUpperCase(),relative=cmd===cmd.toLowerCase();
      if(upper==="Z"){
        if(start&&(x!==start[0]||y!==start[1]))segments.push([[x,y],start]);
        if(current.length)subpaths.push(current);current=[];start=null;cmd="";continue;
      }
      if(upper==="M"||upper==="L"){
        if(i+1>=tokens.length||isCmd(tokens[i])){cmd="";continue}
        const nx=Number(tokens[i++]),ny=Number(tokens[i++]);
        const point=[relative?x+nx:nx,relative?y+ny:ny];
        if(upper==="M"){move(point);cmd=relative?"l":"L"}else line(point);
      }else if(upper==="H"){
        const nx=Number(tokens[i++]);line([relative?x+nx:nx,y]);
      }else if(upper==="V"){
        const ny=Number(tokens[i++]);line([x,relative?y+ny:ny]);
      }else cmd="";
    }
    if(current.length)subpaths.push(current);
    return{subpaths,segments};
  }

  const world=point=>new THREE.Vector3((point.x-VIEW.w/2)*SCALE,0,(point.y-VIEW.h/2)*SCALE);

  function rootPoint(svg,node,x,y){
    const p=svg.createSVGPoint();p.x=x;p.y=y;
    const matrix=node.getCTM();
    if(!matrix)return{x,y};
    const result=p.matrixTransform(matrix);
    return{x:result.x,y:result.y};
  }

  function sampledCurvePath(svg,node,sampleSpacing=16){
    const total=node.getTotalLength(),sampleCount=Math.max(16,Math.min(2400,Math.ceil(total/sampleSpacing)));
    const sampleStep=total/sampleCount,subpaths=[],segments=[];
    let current=[],previousLocal=null,previousRoot=null;
    for(let index=0;index<=sampleCount;index++){
      const local=node.getPointAtLength(Math.min(total,index*sampleStep));
      const point=rootPoint(svg,node,local.x,local.y);
      const jump=previousLocal&&Math.hypot(local.x-previousLocal.x,local.y-previousLocal.y)>sampleStep*4;
      if(jump){if(current.length)subpaths.push(current);current=[point]}
      else{
        if(previousRoot)segments.push([previousRoot,point]);
        current.push(point);
      }
      previousLocal={x:local.x,y:local.y};previousRoot=point;
    }
    if(current.length)subpaths.push(current);
    return{subpaths,segments};
  }

  function transformedPath(svg,node,sampleSpacing=16){
    const d=node.getAttribute("d")||"";
    if(/[CcSsQqTtAa]/.test(d)&&typeof node.getTotalLength==="function")return sampledCurvePath(svg,node,sampleSpacing);
    const parsed=parsePath(d);
    return{
      subpaths:parsed.subpaths.map(path=>path.map(([x,y])=>rootPoint(svg,node,x,y))),
      segments:parsed.segments.map(segment=>segment.map(([x,y])=>rootPoint(svg,node,x,y)))
    };
  }

  function shapeMesh(points,height,material){
    const shape=new THREE.Shape();
    points.forEach((point,index)=>{
      const value=world(point);
      if(index===0)shape.moveTo(value.x,value.z);else shape.lineTo(value.x,value.z);
    });
    shape.closePath();
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:true,bevelSize:.22,bevelThickness:.16,bevelSegments:1});
    geometry.rotateX(Math.PI/2);
    return new THREE.Mesh(geometry,material);
  }

  function compoundShapeMesh(subpaths,height,material,smoothPrimaryHole=false){
    const usable=subpaths.filter(points=>points.length>=3);
    if(!usable.length)return null;
    const area=points=>Math.abs(points.reduce((sum,point,index)=>{
      const next=points[(index+1)%points.length];
      return sum+point.x*next.y-next.x*point.y;
    },0));
    const ordered=[...usable].sort((a,b)=>area(b)-area(a));
    const draw=(target,points)=>{
      points.forEach((point,index)=>{
        const value=world(point);
        if(index===0)target.moveTo(value.x,value.z);else target.lineTo(value.x,value.z);
      });
      target.closePath();
    };
    const shape=new THREE.Shape();draw(shape,ordered[0]);
    ordered.slice(1).forEach((points,index)=>{
      const hole=new THREE.Path();
      if(smoothPrimaryHole&&index===0){
        const values=points.map(world);
        const minX=Math.min(...values.map(value=>value.x)),maxX=Math.max(...values.map(value=>value.x));
        const minZ=Math.min(...values.map(value=>value.z)),maxZ=Math.max(...values.map(value=>value.z));
        const radius=Math.min(maxX-minX,maxZ-minZ)/2;
        hole.absellipse((minX+maxX)/2,(minZ+maxZ)/2,radius,radius,0,Math.PI*2,true,0);
      }else draw(hole,points);
      shape.holes.push(hole);
    });
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:true,bevelSize:.22,bevelThickness:.16,bevelSegments:1});
    geometry.rotateX(Math.PI/2);
    return new THREE.Mesh(geometry,material);
  }

  function separateShapeMesh(subpaths,height,material){
    const shapes=subpaths.filter(points=>points.length>=3).map(points=>{
      const shape=new THREE.Shape();
      points.forEach((point,index)=>{
        const value=world(point);
        if(index===0)shape.moveTo(value.x,value.z);else shape.lineTo(value.x,value.z);
      });
      shape.closePath();return shape;
    });
    if(!shapes.length)return null;
    const geometry=new THREE.ExtrudeGeometry(shapes,{depth:height,bevelEnabled:true,bevelSize:.22,bevelThickness:.16,bevelSegments:1});
    geometry.rotateX(Math.PI/2);
    return new THREE.Mesh(geometry,material);
  }

  function lineFromDoor(svg,node){
    return[
      rootPoint(svg,node,Number(node.getAttribute("x1")),Number(node.getAttribute("y1"))),
      rootPoint(svg,node,Number(node.getAttribute("x2")),Number(node.getAttribute("y2")))
    ];
  }

  function doorNumber(id){
    const match=String(id||"").trim().match(/__(\d{2,3})(?:\D|$)/);
    return match?Number(match[1]):0;
  }

  function segmentBatch(segments,height,depth,material,baseY=0){
    const usable=segments.map(([a,b])=>{
      const p1=world(a),p2=world(b),dx=p2.x-p1.x,dz=p2.z-p1.z,length=Math.hypot(dx,dz);
      return{p1,p2,dx,dz,length};
    }).filter(item=>item.length>=.04);
    if(!usable.length)return null;
    const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),material,usable.length);
    const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();
    const axis=new THREE.Vector3(0,1,0);
    usable.forEach((item,index)=>{
      position.set((item.p1.x+item.p2.x)/2,baseY+height/2,(item.p1.z+item.p2.z)/2);
      quaternion.setFromAxisAngle(axis,-Math.atan2(item.dz,item.dx));
      scale.set(item.length,height,depth);matrix.compose(position,quaternion,scale);mesh.setMatrixAt(index,matrix);
    });
    mesh.instanceMatrix.needsUpdate=true;mesh.frustumCulled=false;
    return mesh;
  }

  function semanticLeaves(root,pattern){
    const matches=[...root.querySelectorAll("[id]")].filter(node=>pattern.test(node.id.trim()));
    return matches.filter(node=>![...node.querySelectorAll("[id]")].some(child=>pattern.test(child.id.trim())));
  }

  function semanticGeometry(root,pattern){
    const selector="path,rect,polygon,polyline,circle,ellipse";
    const named=semanticLeaves(root,pattern).flatMap(node=>node.matches(selector)?[node]:[...node.querySelectorAll(selector)]);
    const containers=[...root.querySelectorAll("g[id]")].filter(node=>pattern.test(node.id.trim()));
    return[...new Set([...named,...containers.flatMap(node=>[...node.querySelectorAll(selector)])])];
  }

  function footprintFrame(svg,node){
    let box;try{box=node.getBBox()}catch{return null}
    if(!box||box.width<=0||box.height<=0)return null;
    const points=[
      rootPoint(svg,node,box.x,box.y),rootPoint(svg,node,box.x+box.width,box.y),
      rootPoint(svg,node,box.x+box.width,box.y+box.height),rootPoint(svg,node,box.x,box.y+box.height)
    ];
    const values=points.map(world),p0=values[0],p1=values[1],p2=values[2];
    const position=values.reduce((sum,value)=>sum.add(value),new THREE.Vector3()).multiplyScalar(.25);
    return{position,width:Math.max(.18,p0.distanceTo(p1)),depth:Math.max(.18,p1.distanceTo(p2)),rotation:-Math.atan2(p1.z-p0.z,p1.x-p0.x)};
  }

  function orientedBox(frame,height,color,baseY=0){
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(frame.width,height,frame.depth),new THREE.MeshStandardMaterial({color,roughness:.62,metalness:.04}));
    mesh.position.set(frame.position.x,baseY+height/2,frame.position.z);mesh.rotation.y=frame.rotation;return mesh;
  }

  function stairsObject(frame,color,escalator=false){
    const group=new THREE.Group(),alongDepth=frame.depth>frame.width;
    const length=alongDepth?frame.depth:frame.width,cross=alongDepth?frame.width:frame.depth;
    group.position.set(frame.position.x,0,frame.position.z);group.rotation.y=frame.rotation+(alongDepth?-Math.PI/2:0);
    const material=new THREE.MeshStandardMaterial({color,roughness:.7,metalness:escalator ? 0.12 : 0});
    const steps=escalator?9:7,stepLength=length/steps,rise=escalator?1.2:1.05;
    for(let index=0;index<steps;index++){
      const height=.1+rise*(index+1)/steps;
      const step=new THREE.Mesh(new THREE.BoxGeometry(stepLength*1.04,height,Math.max(cross,.5)),material);
      step.position.set(-length/2+stepLength*(index+.5),height/2,0);group.add(step);
    }
    if(escalator){
      const railMaterial=new THREE.MeshStandardMaterial({color:0xdbe9ed,roughness:.28,metalness:.35});
      for(const side of [-1,1]){
        const rail=new THREE.Mesh(new THREE.BoxGeometry(length,.09,.07),railMaterial);
        rail.rotation.z=Math.atan2(rise,length);rail.position.set(0,rise/2+.42,side*cross*.48);group.add(rail);
      }
    }
    return group;
  }

  function facilityIcon(key){
    const icons={
      male:'<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><path d="M8.5 21v-7h-2l2-6h7l2 6h-2v7M12 8v13"/></svg>',
      female:'<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><path d="M9.5 8h5l2.5 8h-3v5M10 21v-5H7l2.5-8"/></svg>',
      accessible:'<svg viewBox="0 0 24 24"><circle cx="10" cy="4.5" r="1.8"/><path d="M10 7v5h5l3 5M10 9H7M8 12a5 5 0 1 0 6 6M12 12l-2 6h5"/></svg>',
      elevator:'<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="1"/><path d="m9 8 3-3 3 3M15 16l-3 3-3-3M12 5v14"/></svg>',
      stairs:'<svg viewBox="0 0 24 24"><path d="M3 19h5v-4h4v-4h4V7h5"/></svg>',
      escalator:'<svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="1.7"/><path d="M4 20h4l8-10h4M7 8v5h4M20 10v4h-3"/></svg>'
    };return icons[key]||icons.elevator;
  }

  function facilityObject(frame,type){
    if(type.key==="male"||type.key==="female"||type.key==="accessible")return orientedBox(frame,.08,type.color,.02);
    if(type.key==="elevator")return orientedBox(frame,3.15,type.color,.02);
    if(type.key==="stairs")return stairsObject(frame,type.color,false);
    if(type.key==="escalator")return stairsObject(frame,type.color,true);
    return null;
  }

  async function start(){
    if(!window.THREE)throw new Error("3D组件加载失败，请联网刷新");
    const response=await fetch(SOURCE);
    if(!response.ok)throw new Error(`${FLOOR} SVG读取失败`);
    sourceHolder.innerHTML=await response.text();
    const svg=sourceHolder.querySelector("svg");
    const root=[...svg.children].find(node=>node.id===FLOOR_CONFIG.root)||svg;
    const viewBox=(svg.getAttribute("viewBox")||"0 0 8272 8274").trim().split(/[ ,]+/).map(Number);
    VIEW={w:viewBox[2]||8272,h:viewBox[3]||8274};
    const allGroups=[...root.querySelectorAll("g[id]")];
    const hallNodes=HALL_ORDER.map(id=>allGroups.find(node=>node.id===id)).filter(Boolean);
    if(!hallNodes.length)throw new Error(`没有识别到${FLOOR}场馆分组`);

    const compactView=matchMedia("(max-width:720px)").matches;
    const renderer=new THREE.WebGLRenderer({
      canvas,antialias:true,alpha:true,
      powerPreference:"high-performance",
      logarithmicDepthBuffer:true
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio,compactView?1.25:1.5));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.12;
    const scene=new THREE.Scene();
    scene.background=new THREE.Color(0x07111b);
    const camera=new THREE.PerspectiveCamera(40,1,.5,4000);
    scene.add(new THREE.HemisphereLight(0xd6f3ff,0x0c1b24,2.4));
    const sun=new THREE.DirectionalLight(0xfff5df,2.8);sun.position.set(-380,620,260);scene.add(sun);
    const rim=new THREE.DirectionalLight(0x57d9cc,1.2);rim.position.set(480,180,-360);scene.add(rim);

    const hallContainers=new Set(hallNodes);
    const basePath=[...root.querySelectorAll("path")].find(path=>{
      const owner=path.closest("g[id]");
      return ![...hallContainers].some(hall=>hall.contains(path))&&!/^mid(?:_|$)/i.test(owner?.id||"");
    });
    if(basePath){
      const basePoints=transformedPath(svg,basePath).subpaths.sort((a,b)=>b.length-a.length)[0];
      const base=shapeMesh(basePoints,1.4,new THREE.MeshStandardMaterial({color:0x22343d,roughness:.9,metalness:.02}));
      base.position.y=-1.4;scene.add(base);
    }
    const grid=new THREE.GridHelper(1120,28,0x28515e,0x132b35);grid.position.y=-1.6;scene.add(grid);

    const halls=[];
    const facilityTypes=[
      {key:"stairs",label:"楼梯",pattern:/^STAIRS__/,color:0xaa9274,css:"#aa9274",priority:70},
      {key:"female",label:"女卫生间",pattern:/^WC_FEMALE__/,color:0xb8798d,css:"#b8798d",priority:50},
      {key:"male",label:"男卫生间",pattern:/^WC_MALE__/,color:0x6689ad,css:"#6689ad",priority:50},
      {key:"accessible",label:"无障碍卫生间",pattern:/^WC_ACCESSIBLE__/,color:0x6d9a78,css:"#6d9a78",priority:80},
      {key:"escalator",label:"扶梯",pattern:/^ESCALATORS?__/,color:0xc08a4d,css:"#c08a4d",priority:90},
      {key:"elevator",label:"电梯",pattern:/^ELEVATORS?__/,color:0x687da8,css:"#687da8",priority:100}
    ];

    const centerNode=allGroups.find(node=>/^mid(?:_|$)/i.test(node.id||""));
    let centerDetailGroup=null;
    if(centerNode){
      const centerGroup=new THREE.Group();centerGroup.userData.hall="mid";
      centerDetailGroup=new THREE.Group();centerGroup.add(centerDetailGroup);
      const centerFloor=[...centerNode.children].find(node=>node.tagName?.toLowerCase()==="path"&&/^floor$/i.test(node.id||""))||
        [...root.children].find(node=>node.tagName?.toLowerCase()==="path"&&/^floor$/i.test(node.id||""));
      if(centerFloor){
        const paths=transformedPath(svg,centerFloor,6).subpaths;
        const material=new THREE.MeshStandardMaterial({color:0x70858a,roughness:.78,metalness:.03});
        const usesHoles=/evenodd/i.test(`${centerFloor.getAttribute("fill-rule")||""} ${centerFloor.getAttribute("clip-rule")||""}`);
        const mesh=usesHoles?compoundShapeMesh(paths,1.2,material,FLOOR==="F3"):separateShapeMesh(paths,1.2,material);
        if(mesh){mesh.position.y=-.02;centerGroup.add(mesh)}
      }
      const centerWall=[...centerNode.children].find(node=>/^WALLS?$/i.test(node.id||""));
      if(centerWall){
        const wallPaths=centerWall.tagName.toLowerCase()==="path"?[centerWall]:[...centerWall.querySelectorAll("path")];
        const segments=wallPaths.flatMap(node=>transformedPath(svg,node,8).segments);
        if(centerWall.tagName.toLowerCase()==="line")segments.push(lineFromDoor(svg,centerWall));
        [...centerWall.querySelectorAll?.("line")||[]].forEach(node=>segments.push(lineFromDoor(svg,node)));
        const mesh=segmentBatch(segments,3.6,.28,new THREE.MeshStandardMaterial({color:0xe2edf0,roughness:.68}),0);
        if(mesh)(FLOOR==="F1"?centerGroup:centerDetailGroup).add(mesh);
      }
      facilityTypes.forEach(type=>semanticGeometry(centerNode,type.pattern).forEach(node=>{
        const frame=footprintFrame(svg,node);if(!frame)return;
        const object=facilityObject(frame,type);if(object)centerDetailGroup.add(object);
      }));
      scene.add(centerGroup);
    }

    hallNodes.forEach((node,index)=>{
      const floor=node.querySelector('path[id^="FLOOR__"]');
      if(!floor)return;
      const floorPoints=transformedPath(svg,floor).subpaths.sort((a,b)=>b.length-a.length)[0];
      if(!floorPoints||floorPoints.length<3)return;
      const points3d=floorPoints.map(world);
      const bounds=new THREE.Box3().setFromPoints(points3d);
      const center=bounds.getCenter(new THREE.Vector3());center.y=0;
      const group=new THREE.Group();group.userData.hall=node.id;
      const floorMaterial=new THREE.MeshStandardMaterial({color:COLORS[index],roughness:.72,metalness:.04,transparent:true,opacity:1});
      const wallMaterial=new THREE.MeshStandardMaterial({color:0xe2edf0,roughness:.68,transparent:true,opacity:.82});
      const doorMaterial=new THREE.MeshPhysicalMaterial({color:0x89d9f2,roughness:.08,metalness:.05,transparent:true,opacity:.72,transmission:.22,depthWrite:false});
      const coverMaterial=new THREE.MeshStandardMaterial({
        color:COLORS[index],roughness:.76,metalness:.025,
        polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2
      });
      const floorMesh=shapeMesh(floorPoints,1.25,floorMaterial);floorMesh.userData.hall=node.id;group.add(floorMesh);
      const coverNode=[...node.children].find(child=>child.tagName.toLowerCase()==="path"&&/^(?:cover(?:_\d+)?|COVER__)/i.test((child.id||"").trim()));
      let coverMesh=null;
      if(coverNode){
        const coverPoints=transformedPath(svg,coverNode).subpaths.sort((a,b)=>b.length-a.length)[0];
        if(coverPoints?.length>=3){
          coverMesh=shapeMesh(coverPoints,.34,coverMaterial);
          coverMesh.position.y=.18;
          coverMesh.userData.hall=node.id;group.add(coverMesh);
        }
      }
      const wallContainer=[...node.children].find(child=>child.tagName.toLowerCase()==="g"&&/^WALL(?:S)?(?:__|$)/i.test((child.id||"").trim()));
      const wallNodes=wallContainer?[...wallContainer.querySelectorAll("path")]:[...node.querySelectorAll('path[id^="WALLS__"],path[id^="WALL__"]')];
      const wallSegments=wallNodes.flatMap(wall=>transformedPath(svg,wall).segments);
      if(wallContainer)[...wallContainer.querySelectorAll("line")].forEach(wall=>wallSegments.push(lineFromDoor(svg,wall)));
      const wallMesh=segmentBatch(wallSegments,3.6,.28,wallMaterial,0);if(wallMesh)group.add(wallMesh);
      const doorNodes=[...node.querySelectorAll('line[id*="DOOR"]')];
      const doorSegments=doorNodes.map(door=>lineFromDoor(svg,door));
      const doorMesh=segmentBatch(doorSegments,2.7,.12,doorMaterial,0);if(doorMesh)group.add(doorMesh);
      const doorMarkers=doorNodes.map((door,doorIndex)=>{
        const [a,b]=doorSegments[doorIndex],p1=world(a),p2=world(b),number=doorNumber(door.id)||doorIndex+1;
        const element=document.createElement("span");element.className="door-marker";
        element.textContent="门"+String(number).padStart(2,"0");element.title=`${node.id}馆 ${number}号出入口`;
        labelLayer.appendChild(element);
        // Keep the DOM label anchored to the door footprint. Projecting a tall
        // world-space Y value makes the label appear to drift at oblique angles.
        return{number,featured:[4,7,16,19].includes(number),position:p1.add(p2).multiplyScalar(.5).setY(.55),element};
      });
      const detailGroup=new THREE.Group();detailGroup.visible=false;group.add(detailGroup);
      const facilityMarkers=[];
      facilityTypes.forEach(type=>semanticGeometry(node,type.pattern).forEach(facility=>{
        const frame=footprintFrame(svg,facility);if(!frame)return;
        const object=facilityObject(frame,type);if(object)detailGroup.add(object);
        const element=document.createElement("span");element.className=`facility-icon facility-${type.key}`;
        element.innerHTML=facilityIcon(type.key);element.title=`${type.label} · ${node.id}`;
        element.style.setProperty("--facility-color",type.css);labelLayer.appendChild(element);
        // Icons describe a map coordinate, so every type uses the same low
        // anchor height instead of following the rendered object's height.
        const position=frame.position.clone();position.y=.55;
        facilityMarkers.push({position,element,priority:type.priority});
      }));
      facilityMarkers.sort((a,b)=>b.priority-a.priority);
      group.traverse(object=>{if(object.isMesh)object.userData.hall=node.id});
      scene.add(group);
      const label=document.createElement("span");label.className="hall-label";label.textContent=node.id+"馆";labelLayer.appendChild(label);
      halls.push({id:node.id,group,floorMesh,wallMesh,doorMesh,coverMesh,materials:[floorMaterial,wallMaterial,doorMaterial],detailGroup,facilityMarkers,doorMarkers,center,bounds,label});
    });

    const modelBounds=new THREE.Box3();halls.forEach(item=>modelBounds.union(item.bounds));
    const homeTarget=modelBounds.getCenter(new THREE.Vector3());homeTarget.y=0;
    const modelSize=Math.max(modelBounds.max.x-modelBounds.min.x,modelBounds.max.z-modelBounds.min.z);
    const overviewDistance=modelSize*(compactView?2.7:2.0);
    const hallFocusDistance=modelSize*(compactView ? 0.96 : 0.52);
    let target=homeTarget.clone(),desiredTarget=homeTarget.clone();
    let distance=overviewDistance,desiredDistance=distance;
    let azimuth=-.72,polar=.58,focused=null;
    const minDistance=modelSize*.16,maxDistance=modelSize*2.7,focusDistance=hallFocusDistance,clearDistance=modelSize*(compactView?1.55:.86);
    const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
    let drag=false,dragAction="orbit",travel=0,last=[0,0],activePointer=null,pinchState=null,frameRequested=false;
    const pointers=new Map();

    function applyFocus(id,moveCamera=true){
      focused=id&&id!=="all"?halls.find(item=>item.id===id)||null:null;
      if(centerDetailGroup)centerDetailGroup.visible=Boolean(focused);
      halls.forEach(item=>{
        const active=!focused||item===focused;
        if(item.coverMesh)item.coverMesh.visible=!focused;
        item.floorMesh.visible=Boolean(focused)||!item.coverMesh;
        if(item.wallMesh)item.wallMesh.visible=Boolean(focused);
        if(item.doorMesh)item.doorMesh.visible=Boolean(focused);
        item.detailGroup.visible=Boolean(focused&&item===focused);
        item.facilityMarkers.forEach(marker=>marker.element.style.display="none");
        item.doorMarkers.forEach(marker=>marker.element.style.display="none");
        item.materials.forEach((material,materialIndex)=>{
          material.opacity=active?(materialIndex===0?1:(materialIndex===1 ? 0.82 : 0.72)):0.1;
          material.depthWrite=active;
        });
        item.label.classList.toggle("focused",item===focused);
      });
      document.querySelectorAll("[data-hall]").forEach(button=>button.classList.toggle("active",button.dataset.hall===(focused?.id||"all")));
      focusCard.hidden=!focused;
      if(focused){
        focusName.textContent=focused.id+"号馆";
        const hasHallDetail=FLOOR==="F3"&&focused.id==="7.2";
        enterHall.hidden=!hasHallDetail;
        enterHall.textContent=hasHallDetail?"进入 7.2 馆":"馆内模型待制作";
        if(moveCamera){desiredTarget.copy(focused.center);desiredDistance=focusDistance;}
        status.textContent=`已聚焦 ${focused.id}号馆 · 其他场馆半透明`;
      }else{
        if(moveCamera){desiredTarget.copy(homeTarget);desiredDistance=overviewDistance;}
        status.textContent=`已从SVG识别 ${halls.length} 个场馆 · 拉近或点击场馆聚焦`;
      }
      requestRender();
    }

    function nearestHall(){
      return halls.reduce((best,item)=>!best||item.center.distanceToSquared(desiredTarget)<best.center.distanceToSquared(desiredTarget)?item:best,null);
    }
    function pickHall(event){
      const rect=canvas.getBoundingClientRect();
      pointer.set((event.clientX-rect.left)/rect.width*2-1,-((event.clientY-rect.top)/rect.height*2-1));
      raycaster.setFromCamera(pointer,camera);
      const hit=raycaster.intersectObjects(halls.map(item=>item.coverMesh?.visible?item.coverMesh:item.floorMesh),false)[0];
      return hit?halls.find(item=>item.id===hit.object.userData.hall):null;
    }
    function pan(dx,dy){
      const worldPerPixel=2*distance*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/Math.max(stage.clientHeight,1);
      const forward=new THREE.Vector3(-Math.sin(azimuth),0,-Math.cos(azimuth)).normalize();
      const right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();
      desiredTarget.addScaledVector(right,-dx*worldPerPixel).addScaledVector(forward,dy*worldPerPixel);
      requestRender();
    }
    document.querySelectorAll("[data-hall]").forEach(button=>button.addEventListener("click",()=>applyFocus(button.dataset.hall)));
    document.querySelector("#overviewButton").addEventListener("click",()=>applyFocus(null));
    canvas.addEventListener("pointerdown",event=>{
      if(event.button>2)return;event.preventDefault();canvas.focus({preventScroll:true});
      const action=event.pointerType==="mouse"?(event.button===2?"orbit":"pan"):"orbit";
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY,action});canvas.setPointerCapture(event.pointerId);
      if(pointers.size===1){drag=true;dragAction=action;activePointer=event.pointerId;last=[event.clientX,event.clientY];travel=0;pinchState=null}
      else if(pointers.size===2){
        const values=[...pointers.values()];
        pinchState={x:(values[0].x+values[1].x)/2,y:(values[0].y+values[1].y)/2,distance:Math.hypot(values[1].x-values[0].x,values[1].y-values[0].y)};
        drag=false;activePointer=null;travel=99;
      }
    });
    canvas.addEventListener("pointermove",event=>{
      if(!pointers.has(event.pointerId))return;
      const previous=pointers.get(event.pointerId);
      pointers.set(event.pointerId,{...previous,x:event.clientX,y:event.clientY});
      if(pointers.size===2){
        const values=[...pointers.values()];
        const next={x:(values[0].x+values[1].x)/2,y:(values[0].y+values[1].y)/2,distance:Math.hypot(values[1].x-values[0].x,values[1].y-values[0].y)};
        if(pinchState){
          pan(next.x-pinchState.x,next.y-pinchState.y);
          desiredDistance=Math.max(minDistance,Math.min(maxDistance,desiredDistance*pinchState.distance/Math.max(next.distance,1)));
        }
        pinchState=next;travel=99;requestRender();return;
      }
      if(!drag||activePointer!==event.pointerId)return;
      const dx=event.clientX-last[0],dy=event.clientY-last[1];travel+=Math.hypot(dx,dy);
      if(dragAction==="pan")pan(dx,dy);
      else{azimuth-=dx*.006;polar=Math.max(.28,Math.min(1.22,polar+dy*.005));requestRender();}
      last=[event.clientX,event.clientY];
    });
    function pointerEnd(event){
      pointers.delete(event.pointerId);pinchState=null;
      if(pointers.size===1){
        const [id,value]=pointers.entries().next().value;
        drag=true;dragAction=value.action||"orbit";activePointer=id;last=[value.x,value.y];travel=99;
      }else if(!pointers.size){drag=false;activePointer=null}
    }
    canvas.addEventListener("pointerup",pointerEnd);canvas.addEventListener("pointercancel",pointerEnd);
    canvas.addEventListener("contextmenu",event=>event.preventDefault());
    canvas.addEventListener("click",event=>{if(travel>6)return;const hall=pickHall(event);if(hall)applyFocus(hall.id)});
    canvas.addEventListener("dblclick",event=>{const hall=pickHall(event);if(hall)applyFocus(hall.id)});
    canvas.addEventListener("wheel",event=>{
      event.preventDefault();desiredDistance=Math.max(minDistance,Math.min(maxDistance,desiredDistance*Math.exp(event.deltaY*.0011)));
      if(desiredDistance<focusDistance*1.08&&!focused)applyFocus(nearestHall().id,false);
      else if(desiredDistance>clearDistance&&focused)applyFocus(null,false);
      requestRender();
    },{passive:false});
    canvas.addEventListener("keydown",event=>{
      if(event.key==="Escape"||event.key==="0")applyFocus(null);
      else if(event.key==="ArrowLeft")pan(-34,0);else if(event.key==="ArrowRight")pan(34,0);
      else if(event.key==="ArrowUp")pan(0,-34);else if(event.key==="ArrowDown")pan(0,34);else return;
      event.preventDefault();
    });

    function resize(){const rect=stage.getBoundingClientRect();renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();requestRender()}
    function requestRender(){if(!frameRequested){frameRequested=true;requestAnimationFrame(tick)}}
    function tick(){
      frameRequested=false;
      target.lerp(desiredTarget,.09);distance+= (desiredDistance-distance)*.09;
      // Keep the depth range tight while zooming. This prevents distant,
      // nearly-coplanar SVG surfaces from fighting for the same depth pixel.
      const nextNear=Math.max(.5,distance-modelSize*1.32);
      const nextFar=Math.min(4000,distance+modelSize*1.65);
      if(Math.abs(camera.near-nextNear)>.05||Math.abs(camera.far-nextFar)>.1){
        camera.near=nextNear;camera.far=Math.max(nextNear+modelSize*.5,nextFar);camera.updateProjectionMatrix();
      }
      const sin=Math.sin(polar);
      camera.position.set(target.x+Math.sin(azimuth)*sin*distance,target.y+Math.cos(polar)*distance,target.z+Math.cos(azimuth)*sin*distance);
      camera.lookAt(target);renderer.render(scene,camera);
      const rect=stage.getBoundingClientRect();
      const occupied=[];
      halls.forEach(item=>{
        const projected=item.center.clone().setY(6).project(camera);
        const x=(projected.x*.5+.5)*rect.width,y=(-projected.y*.5+.5)*rect.height;
        const visible=projected.z>-1&&projected.z<1&&x>28&&x<rect.width-28&&y>20&&y<rect.height-20&&(!focused||item===focused);
        item.label.style.display=visible?"block":"none";item.label.style.left=x+"px";item.label.style.top=y+"px";
      });
      if(focused){
        const showAllDoors=distance<modelSize*(compactView ? 0.72 : 0.38);
        focused.doorMarkers.forEach(marker=>{
          const projected=marker.position.clone().project(camera);
          const anchorX=Math.round((projected.x*.5+.5)*rect.width),anchorY=Math.round((-projected.y*.5+.5)*rect.height);
          const allowed=showAllDoors||marker.featured;
          const placement=allowed&&projected.z>-1&&projected.z<1&&
            anchorX>28&&anchorX<rect.width-28&&anchorY>18&&anchorY<rect.height-18&&
            !occupied.some(item=>Math.abs(item.x-anchorX)<42&&Math.abs(item.y-anchorY)<24)
            ?{x:anchorX,y:anchorY}:null;
          marker.element.style.display=placement?"block":"none";
          if(placement){marker.element.style.left=placement.x+"px";marker.element.style.top=placement.y+"px";occupied.push(placement)}
        });
      }else halls.forEach(item=>item.doorMarkers.forEach(marker=>marker.element.style.display="none"));
      if(focused&&distance<modelSize*(compactView ? 0.78 : 0.60)){
        const markerSize=28;
        const showAllFacilities=distance<modelSize*(compactView ? 0.60 : 0.42);
        focused.facilityMarkers.forEach(marker=>{
          const projected=marker.position.clone().project(camera);
          const x=Math.round((projected.x*.5+.5)*rect.width),y=Math.round((-projected.y*.5+.5)*rect.height);
          const inView=projected.z>-1&&projected.z<1&&x>markerSize&&x<rect.width-markerSize&&y>markerSize&&y<rect.height-markerSize;
          const overlap=occupied.some(point=>Math.abs(point.x-x)<markerSize+5&&Math.abs(point.y-y)<markerSize+5);
          const visible=inView&&!overlap&&(showAllFacilities||marker.priority>=80);
          marker.element.style.display=visible?"grid":"none";
          if(visible){marker.element.style.left=x+"px";marker.element.style.top=y+"px";occupied.push({x,y})}
        });
      }else halls.forEach(item=>item.facilityMarkers.forEach(marker=>marker.element.style.display="none"));
      if(target.distanceToSquared(desiredTarget)>.0004||Math.abs(distance-desiredDistance)>.015)requestRender();
    }
    addEventListener("resize",resize);document.addEventListener("visibilitychange",()=>{if(!document.hidden)requestRender()});
    resize();applyFocus(null,false);loading.classList.add("hidden");requestRender();
  }

  start().catch(error=>{console.error(error);loading.textContent=error.message;status.textContent=`${FLOOR}地图生成失败`});
})();
