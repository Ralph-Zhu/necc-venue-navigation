(()=>{
  "use strict";
  const MODEL_STANDARD={
    version:"MGS-2.1-20260907",
    floorThickness:.15,
    wallHeight:2.4,
    doorHeight:2.4,
    elevatorHeight:2.8,
    stairsSteps:7,
    stairsHeight:1,
    escalatorSteps:10,
    escalatorHeight:1.1,
    explodedFloorGap:700
  };
  const FLOOR_DEFS=[
    {id:"F1",source:"./assets/figma-f1-20260910.svg",root:"F1",physicalElevation:0,overviewOffset:0,halls:["1.1","2.1","3.1","4.1","5.1","6.1","7.1","8.1","NH"],color:0x4e9f92},
    {id:"F3",source:"./assets/figma-f3-20260907.svg",root:"F3",physicalElevation:null,overviewOffset:MODEL_STANDARD.explodedFloorGap,halls:["1.2","2.2","3.2","4.2","5.2","6.2","7.2","8.2"],color:0x4d91aa}
  ];
  const viewParams=new URLSearchParams(location.search),requestedView=(viewParams.get("view")||viewParams.get("floor")||"ALL").toUpperCase();
  let viewMode=["ALL","F1","F3"].includes(requestedView)?requestedView:"ALL";
  const SCALE=.1,VIEW={w:8272,h:8274};
  const stage=document.querySelector("#mapStage"),canvas=document.querySelector("#mapCanvas"),labels=document.querySelector("#hallLabels");
  const loading=document.querySelector("#loading"),status=document.querySelector("#mapStatus"),startSelect=document.querySelector("#startSelect");
  const destinationSelect=document.querySelector("#destinationSelect"),routeState=document.querySelector("#routeState"),routeSummary=document.querySelector("#routeSummary");
  const clearRouteButton=document.querySelector("#clearRouteButton");
  const COLORS=[0x4e9f92,0x4d91aa,0x637dab,0x8a6fa8,0xa66f87,0xa9795c,0x6f9c74,0x4f8f9d,0xa48b74];
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
  const svgMatrices=new WeakMap();

  function rootPoint(svg,node,x,y){
    const p=svg.createSVGPoint();p.x=x;p.y=y;
    let relative=svgMatrices.get(node);if(!relative){const matrix=node.getCTM();if(!matrix)return{x,y};relative=svg.getCTM().inverse().multiply(matrix);svgMatrices.set(node,relative)}
    const result=p.matrixTransform(relative);return{x:result.x,y:result.y};
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
  function exactSubpaths(svg,node,spacing){
    const parts=(node.getAttribute("d")||"").match(/M[^M]*/g)||[],result=[];
    for(const d of parts){
      const clone=document.createElementNS("http://www.w3.org/2000/svg","path");clone.setAttribute("d",d);
      const total=clone.getTotalLength(),count=Math.max(4,Math.min(6000,Math.ceil(total/Math.min(spacing,6))));
      if(!total)continue;
      const points=[];
      if(!/[CcSsQqTtAaLlHhVvml]/.test(d)){
        let x=0,y=0,first=null;
        for(const command of d.match(/[MLHVZ][^MLHVZ]*/g)||[]){const values=(command.slice(1).match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi)||[]).map(Number),type=command[0];
          if(type==="M"||type==="L"){for(let i=0;i<values.length;i+=2){x=values[i];y=values[i+1];points.push(rootPoint(svg,node,x,y));if(!first)first={x,y}}}
          else if(type==="H"||type==="V"){for(const value of values){if(type==="H")x=value;else y=value;points.push(rootPoint(svg,node,x,y))}}
          else if(type==="Z"&&first)points.push(rootPoint(svg,node,first.x,first.y));
        }
      }else for(let i=0;i<=count;i++){const p=clone.getPointAtLength(total*i/count);points.push(rootPoint(svg,node,p.x,p.y))}
      if(points.length>1)result.push(points);
    }return result;
  }
  function minimumFrame(points){
    let best=null;
    for(let i=1;i<points.length;i++){
      const dx=points[i].x-points[i-1].x,dz=points[i].z-points[i-1].z,length=Math.hypot(dx,dz);if(length<.001)continue;
      const ux=dx/length,uz=dz/length;let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
      for(const p of points){const u=p.x*ux+p.z*uz,v=-p.x*uz+p.z*ux;minU=Math.min(minU,u);maxU=Math.max(maxU,u);minV=Math.min(minV,v);maxV=Math.max(maxV,v)}
      const width=maxU-minU,depth=maxV-minV,area=width*depth;
      if(!best||area<best.area){const u=(minU+maxU)/2,v=(minV+maxV)/2;best={area,width,depth,rotation:-Math.atan2(uz,ux),position:new THREE.Vector3(u*ux-v*uz,0,u*uz+v*ux)}}
    }return best;
  }
  function transformedSegments(svg,node,spacing=10){
    if(node.tagName.toLowerCase()==="path"&&/M/.test(node.getAttribute("d")||""))return exactSubpaths(svg,node,spacing).flatMap(points=>pathSegments(points));
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
    if(node.tagName.toLowerCase()==="path"&&/M/.test(node.getAttribute("d")||""))return exactSubpaths(svg,node,spacing);
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
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false});
    const mesh=new THREE.Mesh(geometry,material);mesh.rotation.x=Math.PI/2;return mesh;
  }
  function drawShapePath(target,points){points.forEach((point,index)=>{const value=world(point);index?target.lineTo(value.x,value.z):target.moveTo(value.x,value.z)});target.closePath()}
  function polygonArea(points){return Math.abs(points.reduce((sum,point,index)=>{const next=points[(index+1)%points.length];return sum+point.x*next.y-next.x*point.y},0)/2)}
  function compoundShapeMesh(subpaths,height,material){
    const ordered=subpaths.filter(points=>points.length>=3).sort((a,b)=>polygonArea(b)-polygonArea(a));if(!ordered.length)return null;
    const shape=new THREE.Shape();drawShapePath(shape,ordered[0]);ordered.slice(1).forEach(points=>{const hole=new THREE.Path();drawShapePath(hole,points);shape.holes.push(hole)});
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false}),mesh=new THREE.Mesh(geometry,material);mesh.rotation.x=Math.PI/2;return mesh;
  }
  function separateShapeMesh(subpaths,height,material){
    const shapes=subpaths.filter(points=>points.length>=3).map(points=>{const shape=new THREE.Shape();drawShapePath(shape,points);return shape});if(!shapes.length)return null;
    const geometry=new THREE.ExtrudeGeometry(shapes,{depth:height,bevelEnabled:false}),mesh=new THREE.Mesh(geometry,material);mesh.rotation.x=Math.PI/2;return mesh;
  }
  function pathSegments(points){return points.slice(1).map((point,index)=>[points[index],point])}
  function segmentBatch(segments,height,depth,material,baseY=0){
    const usable=segments.map(([a,b])=>{const p1=world(a),p2=world(b),dx=p2.x-p1.x,dz=p2.z-p1.z,length=Math.hypot(dx,dz);return{p1,p2,length,angle:-Math.atan2(dz,dx)}}).filter(item=>item.length>.08);
    if(!usable.length)return null;
    const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),material,usable.length),matrix=new THREE.Matrix4(),position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3(),axis=new THREE.Vector3(0,1,0);
    usable.forEach((item,index)=>{position.set((item.p1.x+item.p2.x)/2,baseY+height/2,(item.p1.z+item.p2.z)/2);quaternion.setFromAxisAngle(axis,item.angle);scale.set(item.length,height,depth);matrix.compose(position,quaternion,scale);mesh.setMatrixAt(index,matrix)});mesh.instanceMatrix.needsUpdate=true;return mesh;
  }
  function lineFromDoor(svg,node){
    if(node.tagName.toLowerCase()==="path"){const total=node.getTotalLength(),a=node.getPointAtLength(0),b=node.getPointAtLength(total);return[rootPoint(svg,node,a.x,a.y),rootPoint(svg,node,b.x,b.y)]}
    return[rootPoint(svg,node,+node.getAttribute("x1"),+node.getAttribute("y1")),rootPoint(svg,node,+node.getAttribute("x2"),+node.getAttribute("y2"))];
  }
  function doorNumber(id){const match=String(id||"").trim().match(/__(\d{2,3})(?:\D|$)/);return match?+match[1]:null}
  function footprintFrame(svg,node){
    const polygon=transformedSubpaths(svg,node,3)[0];
    if(polygon?.length>=3){const frame=minimumFrame(polygon.map(world));if(frame)frame.sourcePolygon=polygon;return frame}
    let box;try{box=node.getBBox()}catch(_){return null}if(!box||box.width<.1||box.height<.1)return null;
    const corners=[[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]].map(([x,y])=>world(rootPoint(svg,node,x,y)));
    const center=corners.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).multiplyScalar(.25);
    return{position:center,width:corners[0].distanceTo(corners[1]),depth:corners[0].distanceTo(corners[2]),rotation:-Math.atan2(corners[1].z-corners[0].z,corners[1].x-corners[0].x)};
  }
  function orientedBox(frame,height,color,baseY=0){const mesh=new THREE.Mesh(new THREE.BoxGeometry(frame.width,height,frame.depth),new THREE.MeshStandardMaterial({color,roughness:.62,metalness:.04}));mesh.position.set(frame.position.x,baseY+height/2,frame.position.z);mesh.rotation.y=frame.rotation;return mesh}
  function stairsObject(frame,color,escalator=false){
    const group=new THREE.Group(),alongDepth=frame.depth>frame.width,length=alongDepth?frame.depth:frame.width,cross=alongDepth?frame.width:frame.depth;group.position.set(frame.position.x,0,frame.position.z);group.rotation.y=frame.rotation+(alongDepth?-Math.PI/2:0);
    const material=new THREE.MeshStandardMaterial({color,roughness:.7,metalness:escalator?.12:0}),steps=escalator?MODEL_STANDARD.escalatorSteps:MODEL_STANDARD.stairsSteps,stepLength=length/steps,rise=escalator?MODEL_STANDARD.escalatorHeight:MODEL_STANDARD.stairsHeight;
    for(let index=0;index<steps;index++){const height=rise*(index+1)/steps,step=new THREE.Mesh(new THREE.BoxGeometry(stepLength,height,cross),material);step.position.set(-length/2+stepLength*(index+.5),height/2,0);group.add(step)}
    if(escalator){const railMaterial=new THREE.MeshStandardMaterial({color:0x617b85,roughness:.35});for(const sign of [-1,1]){const rail=new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(length,rise),.09,Math.min(.12,cross*.08)),railMaterial);rail.rotation.z=Math.atan2(rise,length);rail.position.set(0,rise/2+.2,sign*(cross/2-Math.min(.12,cross*.08)/2));group.add(rail)}}return group;
  }
  function facilityObject(frame,type){
    if(["male","female","accessible","elevator"].includes(type.key)){
      const height=type.key==="elevator"?MODEL_STANDARD.elevatorHeight:.02,base=type.key==="elevator"?0:.01;
      if(frame.sourcePolygon){const mesh=shapeMesh(frame.sourcePolygon,height,new THREE.MeshStandardMaterial({color:type.color,roughness:.62}));mesh.position.y=base+height;mesh.userData.facility=true;return mesh}
      return orientedBox(frame,height,type.color,base);
    }
    if(type.key==="stairs")return stairsObject(frame,type.color,false);if(type.key==="escalator")return stairsObject(frame,type.color,true);return null;
  }
  function batchFacilities(group){
    group.updateWorldMatrix(true,true);const inverse=group.matrixWorld.clone().invert(),buckets=new Map(),removed=[];
    group.traverse(mesh=>{if(!mesh.isMesh||mesh.isInstancedMesh||(!mesh.userData.facility&&mesh.geometry.type!=="BoxGeometry"))return;
      const key=mesh.material.color.getHexString()+":"+mesh.material.roughness+":"+mesh.material.metalness;
      if(!buckets.has(key))buckets.set(key,{material:mesh.material.clone(),positions:[],normals:[],indices:[]});
      const bucket=buckets.get(key),geometry=mesh.geometry.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)),offset=bucket.positions.length/3;
      bucket.positions.push(...geometry.attributes.position.array);bucket.normals.push(...geometry.attributes.normal.array);if(geometry.index){for(const index of geometry.index.array)bucket.indices.push(index+offset)}else{for(let i=0;i<geometry.attributes.position.count;i++)bucket.indices.push(i+offset)}geometry.dispose();removed.push(mesh);
    });
    removed.forEach(mesh=>{mesh.removeFromParent();mesh.geometry.dispose()});
    for(const b of buckets.values()){const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(b.positions,3));g.setAttribute("normal",new THREE.Float32BufferAttribute(b.normals,3));g.setIndex(b.indices);g.computeBoundingSphere();group.add(new THREE.Mesh(g,b.material))}
  }
  function semanticLeaves(root,pattern){
    const matches=[...root.querySelectorAll("[id]")].filter(node=>pattern.test((node.id||"").trim()));
    return matches.filter(node=>!matches.some(parent=>parent!==node&&parent.contains(node)));
  }
  function semanticGeometry(root,pattern){
    const selector="path,rect,polygon,polyline,circle,ellipse";
    const named=semanticLeaves(root,pattern).flatMap(node=>node.matches(selector)?[node]:[...node.querySelectorAll(selector)]);
    const unique=[];named.forEach(node=>{if(!node.closest("mask,defs,clipPath")&&!unique.includes(node))unique.push(node)});return unique;
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
    const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:"high-performance"});
    renderer.setPixelRatio(Math.min(devicePixelRatio,compact?1.15:1.45));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
    const scene=new THREE.Scene();scene.background=new THREE.Color(0x07111b);
    const camera=new THREE.PerspectiveCamera(42,1,.5,4000);scene.add(new THREE.HemisphereLight(0xd6f3ff,0x0c1b24,2.5));
    const sun=new THREE.DirectionalLight(0xfff5df,2.7);sun.position.set(-380,620,260);scene.add(sun);
    const rim=new THREE.DirectionalLight(0x57d9cc,1.15);rim.position.set(480,180,-360);scene.add(rim);
    const grid=new THREE.GridHelper(1120,28,0x28515e,0x132b35);grid.position.y=-2;grid.visible=false;scene.add(grid);
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
        const groundSubpaths=transformedSubpaths(svg,groundPath,8),groundMaterial=new THREE.MeshStandardMaterial({color:floorIndex?0x263a48:0x263f3f,roughness:.94,metalness:.01});
        groundMaterial.polygonOffset=true;groundMaterial.polygonOffsetFactor=2;groundMaterial.polygonOffsetUnits=4;
        const groundMesh=compoundShapeMesh(groundSubpaths,MODEL_STANDARD.floorThickness,groundMaterial);if(groundMesh){groundMesh.position.y=-.03;floorGroup.add(groundMesh);floorGroup.userData.groundMesh=groundMesh}
        walkableByFloor.get(floorDef.id).ground=groundSubpaths.map(points=>points.map(world));
      }
      const mid={id:`${floorDef.id}:mid`,kind:"mid",floor:floorDef.id,position:new THREE.Vector3(0,.2,0)};ensureNode(mid);
      const centerNode=allGroups.find(node=>/^mid(?:_|$)/i.test(node.id||""));
      if(centerNode){
        const midDetail=new THREE.Group();floorGroup.add(midDetail);
        const centerFloor=[...centerNode.children].find(node=>node.tagName?.toLowerCase()==="path"&&/^floor(?:__|$)/i.test(node.id||""))||[...root.children].find(node=>node.tagName?.toLowerCase()==="path"&&/^floor(?:__|$)/i.test(node.id||""));
        let midHall=null;
        if(centerFloor){
          const subpaths=transformedSubpaths(svg,centerFloor,6),material=new THREE.MeshStandardMaterial({color:floorIndex?0x6c7f88:0x657e78,roughness:.8,metalness:.02});
          const evenodd=/evenodd/i.test(`${centerFloor.getAttribute("fill-rule")||""} ${centerFloor.getAttribute("clip-rule")||""}`),centerMesh=evenodd?compoundShapeMesh(subpaths,MODEL_STANDARD.floorThickness,material):separateShapeMesh(subpaths,MODEL_STANDARD.floorThickness,material);
          if(centerMesh){
            midDetail.add(centerMesh);
            const coverNode=[...centerNode.children].find(n=>/^cover/i.test(n.id||"")),coverMesh=coverNode?compoundShapeMesh(transformedSubpaths(svg,coverNode,6),MODEL_STANDARD.floorThickness,material.clone()):centerMesh.clone();coverMesh.material=material.clone();coverMesh.position.y=.04;floorGroup.add(coverMesh);
            const bounds=new THREE.Box3().setFromPoints(subpaths.flat().map(world)),center=bounds.getCenter(new THREE.Vector3());
            const label=document.createElement("button");label.className="hall-label";label.textContent="中央商务区";labels.appendChild(label);
            midHall={id:"mid",floor:floorDef.id,center,bounds,navPolygons:subpaths.map(points=>points.map(world)),detailGroup:midDetail,coverMesh,floorMesh:centerMesh,materials:[],endpoints:[],label};halls.push(midHall);label.addEventListener("click",()=>focusHall(midHall));
            coverMesh.userData={hall:"mid",floor:floorDef.id};centerMesh.userData={hall:"mid",floor:floorDef.id};
          }
          const ordered=subpaths.filter(points=>points.length>=3).sort((a,b)=>polygonArea(b)-polygonArea(a));
          if(ordered[0])walkableByFloor.get(floorDef.id).areas.push(ordered[0].map(world));
          if(evenodd)walkableByFloor.get(floorDef.id).blocked.push(...ordered.slice(1).map(points=>points.map(world)));
        }
        const centerWall=[...centerNode.children].find(node=>/^WALLS?(?:__|$)/i.test((node.id||"").trim()));
        if(centerWall){
          const paths=(centerWall.tagName.toLowerCase()==="path"?[centerWall]:[...centerWall.querySelectorAll("path")]).filter(p=>!p.closest("mask,defs,clipPath")),segments=paths.flatMap(path=>transformedSegments(svg,path,7));
          [...centerWall.querySelectorAll?.("line")||[]].forEach(line=>segments.push(lineFromDoor(svg,line)));const mesh=segmentBatch(segments,MODEL_STANDARD.wallHeight,.26,new THREE.MeshStandardMaterial({color:0xe2edf0,roughness:.68}),0);if(mesh)midDetail.add(mesh);wallObstacles.get(floorDef.id).push(...segments.map(([a,b])=>[world(a),world(b)]));
        }
        TYPES.forEach(type=>semanticGeometry(centerNode,type.pattern).forEach((facility,index)=>{const frame=footprintFrame(svg,facility),object=frame&&facilityObject(frame,type);if(object)midDetail.add(object);if(!frame)return;
          const outline=frame.sourcePolygon?.map(world)||[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>new THREE.Vector3(frame.position.x+Math.cos(frame.rotation)*x*frame.width/2+Math.sin(frame.rotation)*z*frame.depth/2,0,frame.position.z-Math.sin(frame.rotation)*x*frame.width/2+Math.cos(frame.rotation)*z*frame.depth/2));midHall?.navPolygons.push(outline);
          const position=frame.position.clone();position.y=.2;const endpoint={id:`${floorDef.id}:mid:${type.key}:${index}`,kind:"endpoint",type:type.key,floor:floorDef.id,hall:"mid",position,label:`${floorDef.id} · 中央商务区 · ${type.label}${index+1}号`,css:type.css};endpoints.push(endpoint);midHall?.endpoints.push(endpoint);ensureNode(endpoint);addMarker(endpoint)}));
      }
      hallNodes.forEach((node,index)=>{
        const floor=node.querySelector('path[id^="FLOOR__"]');if(!floor)return;
        const floorPoints=transformedSubpaths(svg,floor,6)[0]||[];if(floorPoints.length<3)return;
        walkableByFloor.get(floorDef.id).areas.push(floorPoints.map(world));
        const bounds=new THREE.Box3().setFromPoints(floorPoints.map(world)),center=bounds.getCenter(new THREE.Vector3());center.y=.2;
        const hall={id:node.id,floor:floorDef.id,node,center,bounds,navPolygons:[floorPoints.map(world)],group:new THREE.Group(),endpoints:[],materials:[]};hall.group.userData.hall=node.id;hall.group.userData.floor=floorDef.id;
        const cover=[...node.children].find(child=>child.tagName?.toLowerCase()==="path"&&/^(?:cover(?:_\d+)?|COVER__)/i.test((child.id||"").trim()))||floor;
        const coverPoints=transformedSubpaths(svg,cover,6)[0]||[],coverMaterial=new THREE.MeshStandardMaterial({color:COLORS[index],roughness:.78,metalness:.02});
        const coverMesh=shapeMesh(coverPoints.length>=3?coverPoints:floorPoints,MODEL_STANDARD.floorThickness,coverMaterial);if(coverMesh){coverMesh.position.y=.03;coverMesh.userData.hall=node.id;coverMesh.userData.floor=floorDef.id;hall.group.add(coverMesh);hall.mesh=coverMesh;hall.coverMesh=coverMesh;hall.materials.push(coverMaterial)}
        const detailGroup=new THREE.Group();detailGroup.visible=false;hall.group.add(detailGroup);hall.detailGroup=detailGroup;
        const floorMaterial=new THREE.MeshStandardMaterial({color:COLORS[index],roughness:.72,metalness:.04});
        const floorMesh=shapeMesh(floorPoints,MODEL_STANDARD.floorThickness,floorMaterial);if(floorMesh){floorMesh.userData.hall=node.id;floorMesh.userData.floor=floorDef.id;detailGroup.add(floorMesh);hall.floorMesh=floorMesh}
        const wallMaterial=new THREE.MeshStandardMaterial({color:0xe2edf0,roughness:.68,transparent:true,opacity:.88});
        const wallContainer=[...node.children].find(child=>child.tagName?.toLowerCase()==="g"&&/^WALL(?:S)?(?:__|$)/i.test((child.id||"").trim()));
        const wallNodes=(wallContainer?[...wallContainer.querySelectorAll("path")]:[...node.querySelectorAll('path[id^="WALLS__"],path[id^="WALL__"]')]).filter(p=>!p.closest("mask,defs,clipPath"));
        const wallSegments=wallNodes.flatMap(wall=>transformedSegments(svg,wall,9));if(wallContainer)[...wallContainer.querySelectorAll("line")].forEach(wall=>wallSegments.push(lineFromDoor(svg,wall)));
        wallObstacles.get(floorDef.id).push(...wallSegments.map(([a,b])=>[world(a),world(b)]));
        const wallMesh=segmentBatch(wallSegments,MODEL_STANDARD.wallHeight,.26,wallMaterial,0);if(wallMesh){detailGroup.add(wallMesh);hall.wallMesh=wallMesh}
        const doorMaterial=new THREE.MeshPhysicalMaterial({color:0x89d9f2,roughness:.08,metalness:.05,transparent:true,opacity:.75,transmission:.2,depthWrite:false});
        floorGroup.add(hall.group);halls.push(hall);
        const centerNodeGraph={id:`${floorDef.id}:${node.id}:center`,kind:"hall",floor:floorDef.id,hall:node.id,position:center.clone()};ensureNode(centerNodeGraph);edge(centerNodeGraph,mid,distance2d(centerNodeGraph.position,mid.position)+16);
        const hallLabel=document.createElement("button");hallLabel.type="button";hallLabel.className="hall-label";hallLabel.textContent=node.id+"馆";hallLabel.style.pointerEvents="auto";
        hallLabel.addEventListener("click",()=>focusHall(hall));labels.appendChild(hallLabel);hall.label=hallLabel;
        const doorNodes=[...node.querySelectorAll('line[id*="DOOR"],path[id*="DOOR"]')].filter(n=>!n.closest('defs,mask,clipPath')),doorSegments=doorNodes.map(door=>lineFromDoor(svg,door));
        const doorMesh=segmentBatch(doorSegments,MODEL_STANDARD.doorHeight,.1,doorMaterial,0);if(doorMesh){detailGroup.add(doorMesh);hall.doorMesh=doorMesh}
        doorNodes.forEach((door,doorIndex)=>{
          const [a,b]=doorSegments[doorIndex],position=world(a).add(world(b)).multiplyScalar(.5);position.y=.2;
          const number=doorNumber(door.id)||doorIndex+1,id=`${floorDef.id}:${node.id}:door:${number}:${doorIndex}`;
          const endpoint={id,kind:"endpoint",type:"door",floor:floorDef.id,hall:node.id,number,position,line:doorSegments[doorIndex].map(world),label:`${floorDef.id} · ${node.id}馆 · ${number}号门`,css:"#5cbdda"};
          endpoints.push(endpoint);hall.endpoints.push(endpoint);ensureNode(endpoint);edge(endpoint,centerNodeGraph,distance2d(position,center)+3);addMarker(endpoint);
        });
        TYPES.forEach(type=>{
          const counts={};semanticGeometry(node,type.pattern).forEach(facility=>{
            const frame=footprintFrame(svg,facility);if(!frame)return;counts[type.key]=(counts[type.key]||0)+1;
            const object=facilityObject(frame,type);if(object)detailGroup.add(object);
            const position=frame.position.clone();position.y=.2;
            const endpoint={id:`${floorDef.id}:${node.id}:${type.key}:${counts[type.key]}`,kind:"endpoint",type:type.key,floor:floorDef.id,hall:node.id,index:counts[type.key],position,label:`${floorDef.id} · ${node.id}馆 · ${type.label}${counts[type.key]}号`,css:type.css};
            if(['male','female','accessible'].includes(type.key)&&frame.sourcePolygon)endpoint.navigationPolygon=frame.sourcePolygon.map(world);
            endpoints.push(endpoint);hall.endpoints.push(endpoint);ensureNode(endpoint);edge(endpoint,centerNodeGraph,distance2d(position,center)+3);addMarker(endpoint);
          });
        });
      });
      const badge=document.createElement("span");badge.className=`floor-badge ${floorDef.id.toLowerCase()}`;badge.textContent=floorDef.id;labels.appendChild(badge);floorGroup.userData.badge=badge;floorGroup.userData.badgePosition=new THREE.Vector3(-430,8,-360);
    });

    halls.forEach(hall=>batchFacilities(hall.detailGroup));
    // Exhibition overlay only: fixed venue geometry is not replaced by the standalone SVG.
    const boothResponse=await fetch('./assets/booths-1.1.json');
    if(!boothResponse.ok)throw new Error('1.1馆展位数据读取失败');
    const boothData=await boothResponse.json(),booths=[],boothHall=halls.find(h=>h.floor==='F1'&&h.id==='1.1');
    let selectedBooth=null;
    const favoriteKey='necc-demo-booth-favorites-v1';let favorites=new Set();
    try{favorites=new Set(JSON.parse(localStorage.getItem(favoriteKey)||'[]'))}catch(_){}
    const detail=document.createElement('aside');detail.className='booth-detail';detail.hidden=true;detail.setAttribute('aria-label','展位简介');
    detail.innerHTML='<button class="booth-close" aria-label="关闭展位简介">×</button><small>1.1馆 · 模拟展商</small><h2></h2><div class="booth-image" role="img" aria-label="企业图片占位符">▧<br>企业图片占位</div><p data-company></p><p data-intro></p><p data-location></p><p data-contact></p><small data-note>企业与联系方式均为演示数据</small><div class="booth-actions"><button data-favorite aria-pressed="false">☆ 收藏</button><button data-go><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 22 12 12 22 2 12Z"/><path d="M8 16v-5h7m-3-3 3 3-3 3"/></svg>到这里</button></div>';
    stage.appendChild(detail);
    for(const record of boothData.booths){
      const points=record.points.map(([x,y])=>({x,y})),polygon=points.map(world),bounds=new THREE.Box3().setFromPoints(polygon),center=bounds.getCenter(new THREE.Vector3());center.y=1.6;
      const material=new THREE.MeshStandardMaterial({color:0x6fc7b7,roughness:.78}),mesh=shapeMesh(points,1.3,material);mesh.position.y=1.3;boothHall.detailGroup.add(mesh);
      const element=document.createElement('div');element.className='booth-label';element.append(document.createTextNode(record.code));const name=document.createElement('span');name.textContent=record.shortName;element.appendChild(name);labels.appendChild(element);
      const booth={...record,id:`F1:1.1:booth:${record.code}`,kind:'endpoint',type:'booth',position:center.clone().setY(.2),center,polygon,bounds,mesh,element,label:`F1 · 1.1馆 · ${record.code} ${record.shortName}`};
      mesh.userData.booth=booth;booths.push(booth);endpoints.push(booth);boothHall.endpoints.push(booth);ensureNode(booth);walkableByFloor.get('F1').blocked.push(polygon);
    }
    function closeBooth(){detail.hidden=true;if(selectedBooth)selectedBooth.mesh.material.color.setHex(0x6fc7b7);selectedBooth=null;requestRender()}
    function openBooth(booth){if(selectedBooth)selectedBooth.mesh.material.color.setHex(0x6fc7b7);selectedBooth=booth;booth.mesh.material.color.setHex(0x42e6c4);detail.hidden=false;detail.querySelector('h2').textContent=`${booth.code} · ${booth.shortName}`;detail.querySelector('[data-company]').textContent=booth.company;detail.querySelector('[data-intro]').textContent=booth.intro;detail.querySelector('[data-location]').textContent=`位置：F1 · 1.1馆 · ${booth.code}展位`;detail.querySelector('[data-contact]').textContent=`联系：${booth.contact} ｜ ${booth.phone} ｜ ${booth.email}`;updateFavorite();requestRender()}
    function updateFavorite(){const saved=favorites.has(selectedBooth?.id),button=detail.querySelector('[data-favorite]');button.textContent=saved?'★ 已收藏':'☆ 收藏';button.setAttribute('aria-pressed',String(saved))}
    detail.querySelector('.booth-close').onclick=closeBooth;
    detail.querySelector('[data-favorite]').onclick=()=>{if(!selectedBooth)return;const id=selectedBooth.id;favorites.has(id)?favorites.delete(id):favorites.add(id);try{localStorage.setItem(favoriteKey,JSON.stringify([...favorites]))}catch(_){detail.querySelector('[data-note]').textContent='浏览器禁止存储，收藏仅在本次打开期间有效'}updateFavorite()};
    detail.querySelector('[data-go]').onclick=()=>{const booth=selectedBooth;if(!booth)return;closeBooth();destinationSelect.value=booth.id;planRoute()};
    document.addEventListener('keydown',event=>{if(event.key==='Escape')closeBooth()});
    const connectorTypes=["elevator","escalator","stairs"];
    connectorTypes.forEach(type=>{
      const lower=endpoints.filter(node=>node.floor==="F1"&&node.type===type),upper=endpoints.filter(node=>node.floor==="F3"&&node.type===type);
      lower.forEach(from=>{
        const sameWing=upper.filter(to=>to.hall.split(".")[0]===from.hall.split(".")[0]);
        const candidates=sameWing.length?sameWing:upper;if(!candidates.length)return;
        const to=candidates.reduce((best,item)=>!best||distance2d(from.position,item.position)<distance2d(from.position,best.position)?item:best,null);
        edge(from,to,24,type);connectorPairs.push({type,lower:from,upper:to});
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
    const WALL_BUCKET=20,wallIndexes=new Map();
    const bucketKey=(x,z)=>`${Math.floor(x/WALL_BUCKET)},${Math.floor(z/WALL_BUCKET)}`;
    wallObstacles.forEach((segments,floor)=>{
      const index=new Map();segments.forEach(segment=>{const [a,b]=segment,minX=Math.floor((Math.min(a.x,b.x)-2)/WALL_BUCKET),maxX=Math.floor((Math.max(a.x,b.x)+2)/WALL_BUCKET),minZ=Math.floor((Math.min(a.z,b.z)-2)/WALL_BUCKET),maxZ=Math.floor((Math.max(a.z,b.z)+2)/WALL_BUCKET);for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){const key=`${x},${z}`;if(!index.has(key))index.set(key,[]);index.get(key).push(segment)}});wallIndexes.set(floor,index);
    });
    let target=homeForView(viewMode),desiredTarget=homeForView(viewMode),distance=size*(compact?3.7:2.3),desiredDistance=distance,azimuth=-.78,polar=1.05,focusedHall=null;
    const overviewDistance=distance,minDistance=18,maxDistance=size*5,raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
    let activeRoute=[],selectedDestination=null,framePending=false,travel=0,last=[0,0],dragAction="orbit";const pointers=new Map();
    let navigationWorker=null,navigationSerial=0,navigationPending=false,lastNavigationResult=null,navigationReady=false,cachedNavigationData=null;
    // Choose an actual aisle-side arrival, not the solid booth centre.
    for(const booth of booths){
      const candidates=[];for(let i=0;i<booth.polygon.length;i++){const a=booth.polygon[i],b=booth.polygon[(i+1)%booth.polygon.length],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(len<.01)continue;for(const t of [.25,.5,.75])for(const sign of [-1,1]){const p=new THREE.Vector3(a.x+dx*t-sign*dz/len*1.2,.2,a.z+dz*t+sign*dx/len*1.2);if(isWalkable(p,'F1')&&!isWallBlocked(p,'F1'))candidates.push(p)}}
      candidates.sort((a,b)=>a.distanceToSquared(booth.center)-b.distanceToSquared(booth.center));booth.arrivalCandidates=candidates;if(candidates.length)booth.position.copy(candidates[0]);
    }
    document.querySelector('#showBooths').onclick=()=>{setViewMode('F1');focusHall(boothHall)};
    const navigationPanel=document.querySelector('.navigation-panel'),navigationToggle=document.querySelector('#navigationToggle'),mobileLayout=matchMedia('(max-width:720px)');
    function setNavigationCollapsed(collapsed){navigationPanel.classList.toggle('is-collapsed',collapsed);navigationToggle.setAttribute('aria-expanded',String(!collapsed));navigationToggle.textContent=collapsed?'展开导航':'收起';requestRender()}
    setNavigationCollapsed(mobileLayout.matches);
    navigationToggle.addEventListener('click',()=>setNavigationCollapsed(!navigationPanel.classList.contains('is-collapsed')));
    mobileLayout.addEventListener('change',()=>setNavigationCollapsed(mobileLayout.matches));

    function setViewMode(mode,{updateUrl=true,manual=false}={}){
      if(!["ALL","F1","F3"].includes(mode))mode="ALL";
      if(manual&&(navigationPending||(mode!=="ALL"&&activeRoute.some(node=>node.floor!==mode))))clearRoute();
      viewMode=mode;
      floorModels.forEach(group=>{group.visible=mode==="ALL"||group.userData.floor===mode;group.position.y=floorDisplayOffset(group.userData.floor)});
      if(lastNavigationResult?.ok)renderNavigation(lastNavigationResult);
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
      focusedHall=null;updateHallRendering();desiredTarget.copy(homeForView(mode));desiredDistance=mode==="ALL"?overviewDistance:size*(compact?3:1.8);requestRender();
    }

    function populateSelects(start){
      const byFloor=floor=>endpoints.filter(node=>node.floor===floor);
      const options=FLOOR_DEFS.map(def=>`<optgroup label="${def.id}">${byFloor(def.id).map(node=>`<option value="${node.id}">${node.label.replace(`${def.id} · `,"")}</option>`).join("")}</optgroup>`).join("");
      startSelect.innerHTML=options;destinationSelect.innerHTML='<option value="">请选择展位、门、厕所或换层设施</option>'+options;
      if(start)startSelect.value=start.id;clearRouteButton.disabled=true;
    }
    function updateHallRendering(){
      halls.forEach(item=>{
        const detailed=distance<size*(item.detailed?.92:.80);item.detailed=detailed;
        if(item.coverMesh)item.coverMesh.visible=!detailed;if(item.detailGroup)item.detailGroup.visible=detailed;
        item.materials.forEach(material=>material.opacity=1);
        item.label.classList.toggle("focused",item===focusedHall);
      });
    }
    function focusHall(hall,move=true){
      focusedHall=hall||null;updateHallRendering();
      if(hall&&move){desiredTarget.copy(displayedPosition(hall.center,hall.floor));desiredDistance=Math.max(hall.bounds.getSize(new THREE.Vector3()).length()*1.15,50)}requestRender();
    }
    function setDestination(id){
      selectedDestination=endpoints.find(node=>node.id===id)||null;endpoints.forEach(node=>node.element.classList.toggle("selected",node===selectedDestination));
      clearRouteButton.disabled=!selectedDestination&&!activeRoute.length;
      if(selectedDestination){const hall=halls.find(item=>item.floor===selectedDestination.floor&&item.id===selectedDestination.hall);if(hall)focusHall(hall,false)}requestRender();
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
      if(floor==='F1')for(const booth of booths){if(Math.max(from.x,to.x)<booth.bounds.min.x||Math.min(from.x,to.x)>booth.bounds.max.x||Math.max(from.z,to.z)<booth.bounds.min.z||Math.min(from.z,to.z)>booth.bounds.max.z)continue;if(pointInPolygon(from,booth.polygon)||pointInPolygon(to,booth.polygon)||booth.polygon.some((p,i)=>segmentsIntersect(from,to,p,booth.polygon[(i+1)%booth.polygon.length])))return true}
      const index=wallIndexes.get(floor);if(!index)return false;const minX=Math.floor(Math.min(from.x,to.x)/WALL_BUCKET),maxX=Math.floor(Math.max(from.x,to.x)/WALL_BUCKET),minZ=Math.floor(Math.min(from.z,to.z)/WALL_BUCKET),maxZ=Math.floor(Math.max(from.z,to.z)/WALL_BUCKET),seen=new Set();
      for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++)for(const segment of index.get(`${x},${z}`)||[]){if(seen.has(segment))continue;seen.add(segment);if(segmentsIntersect(from,to,segment[0],segment[1]))return true}return false;
    }
    const plainPoint=p=>({x:p.x,z:p.z});
    const plainEndpoint=n=>({id:n.id,floor:n.floor,hall:n.hall,type:n.type,position:plainPoint(n.position),arrivalCandidates:n.arrivalCandidates?.map(plainPoint)});
    function navigationData(){return{floors:FLOOR_DEFS.map(def=>({id:def.id,rooms:endpoints.filter(n=>n.floor===def.id&&n.navigationPolygon).map(n=>({id:n.id,hall:n.hall,poly:n.navigationPolygon.map(plainPoint)})),ground:walkableByFloor.get(def.id).ground.map(poly=>poly.map(plainPoint)),blocked:walkableByFloor.get(def.id).blocked.map(poly=>poly.map(plainPoint)),mid:halls.find(h=>h.floor===def.id&&h.id==='mid')?.navPolygons.map(poly=>poly.map(plainPoint))||[],halls:halls.filter(h=>h.floor===def.id&&h.id!=='mid').map(h=>({id:h.id,polygon:h.navPolygons[0].map(plainPoint)})),walls:wallObstacles.get(def.id).map(line=>line.map(plainPoint)),doors:endpoints.filter(n=>n.floor===def.id&&n.type==='door').map(n=>({hall:n.hall,line:n.line.map(plainPoint)}))})),connectors:connectorPairs.map(c=>({type:c.type,lower:plainEndpoint(c.lower),upper:plainEndpoint(c.upper)}))}}
    function disposeRoute(){routeGroup.traverse(object=>{object.geometry?.dispose();object.material?.dispose()});routeGroup.clear();delete routeGroup.userData.navigation;requestRender()}
    function cancelNavigation(){navigationSerial++;if(navigationPending){navigationWorker?.terminate();navigationWorker=null;navigationReady=false}navigationPending=false;document.querySelector('#routeButton').disabled=false;document.querySelector('#routeButton').textContent='开始导航';activeRoute=[];lastNavigationResult=null;disposeRoute()}
    function renderNavigation(result){
      disposeRoute();const segments=[];for(const section of result.sections){const points=section.points.map((p,i)=>displayedPosition(new THREE.Vector3(p.x,.2,p.z),section.type==='walk'?section.floor:i?section.toFloor:section.fromFloor));for(let i=1;i<points.length;i++)if(points[i].distanceTo(points[i-1])>.0001)segments.push([points[i-1],points[i]])}
      if(segments.length){const mesh=new THREE.InstancedMesh(new THREE.CylinderGeometry(.16,.16,1,6),new THREE.MeshBasicMaterial({color:0xffd35b}),segments.length),dummy=new THREE.Object3D(),up=new THREE.Vector3(0,1,0);segments.forEach(([a,b],i)=>{const delta=b.clone().sub(a);dummy.position.copy(a).add(b).multiplyScalar(.5);dummy.quaternion.setFromUnitVectors(up,delta.clone().normalize());dummy.scale.set(1,delta.length(),1);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix)});routeGroup.add(mesh)}
      const first=result.sections[0],last=result.sections.at(-1);for(const [section,p,floor,color] of [[first,first.points[0],first.floor,0x5ff1d2],[last,last.points.at(-1),last.floor,0xff7a68]]){const marker=new THREE.Mesh(new THREE.SphereGeometry(.8,12,8),new THREE.MeshBasicMaterial({color}));marker.position.copy(displayedPosition(new THREE.Vector3(p.x,.3,p.z),floor));routeGroup.add(marker)}
      routeGroup.userData.navigation=result;
    }
    function planRoute(){
      const start=endpoints.find(n=>n.id===startSelect.value),end=endpoints.find(n=>n.id===destinationSelect.value);cancelNavigation();if(!start||!end){routeState.textContent='未开始';routeSummary.textContent='请先选择导航起点和终点';return}
      const requiredView=start.floor===end.floor?start.floor:'ALL';if(requiredView!==viewMode)setViewMode(requiredView);
      const id=++navigationSerial,preference=document.querySelector('input[name="routePreference"]:checked').value;
      setDestination(end.id);routeState.textContent='规划中';routeState.classList.remove('active');routeSummary.textContent='正在检查馆—道路—馆连通性，禁止借道第三馆和中央商务区…';navigationPending=true;clearRouteButton.disabled=false;document.querySelector('#routeButton').disabled=true;document.querySelector('#routeButton').textContent='规划中…';
      const fail=message=>{if(id!==navigationSerial)return;navigationWorker?.terminate();navigationWorker=null;navigationPending=false;document.querySelector('#routeButton').disabled=false;document.querySelector('#routeButton').textContent='重新规划';routeState.textContent='未连通';routeSummary.textContent=message;lastNavigationResult={ok:false,reason:message};if(mobileLayout.matches)setNavigationCollapsed(false);requestRender()};
      try{if(!navigationWorker){navigationWorker=new Worker('./navigation-worker.js?v=20260908-2');navigationReady=false}}catch(error){fail('当前浏览器未能启动寻路，请使用HTTP地址刷新地图。');return}
      const worker=navigationWorker,sendPlan=()=>worker.postMessage({id,start:plainEndpoint(start),end:plainEndpoint(end),preference});
      navigationWorker.onerror=()=>fail('导航计算失败，请刷新后重试。');navigationWorker.onmessage=event=>{if(id!==navigationSerial||event.data.id!==id||worker!==navigationWorker)return;const message=event.data;if(message.error){fail(message.error);return}if(message.ready){navigationReady=true;sendPlan();return}
        const result=message.result;navigationPending=false;document.querySelector('#routeButton').disabled=false;document.querySelector('#routeButton').textContent='开始导航';lastNavigationResult=result;
        if(!result?.ok||!result.audit?.valid){fail(result?.reason||'路线校验未通过，已停止显示。');return}
        renderNavigation(result);activeRoute=[start,end];routeState.textContent='导航中';routeState.classList.add('active');
        const connectorName=TYPES.find(t=>t.key===result.connector)?.label;
        routeSummary.textContent=`${result.rule}｜${start.label} → ${end.label}｜平面步行约${Math.round(result.distance)}米${connectorName?`｜经${connectorName}`:''}${result.fallback?'（首选设施不通，已换用可达设施）':''}${result.unconfirmed?'｜跨层配对为演示，需现场核实':''}`;
        if(mobileLayout.matches)setNavigationCollapsed(true);const a=displayedPosition(start.position,start.floor),b=displayedPosition(end.position,end.floor);desiredTarget.copy(a).add(b).multiplyScalar(.5);desiredDistance=Math.max(size*.55,a.distanceTo(b)*1.35);requestRender();
      };
      if(navigationReady)sendPlan();else worker.postMessage({id,action:'init',data:cachedNavigationData||(cachedNavigationData=navigationData())});
    }
    function clearRoute(){cancelNavigation();selectedDestination=null;destinationSelect.value="";endpoints.forEach(node=>node.element.classList.remove("selected"));routeState.textContent="未开始";routeState.classList.remove("active");const start=endpoints.find(node=>node.id===startSelect.value);routeSummary.textContent=start?`当前起点：${start.label}`:"请选择导航起点";clearRouteButton.disabled=true;focusHall(null,false);requestRender()}
    document.querySelector("#routeButton").addEventListener("click",planRoute);clearRouteButton.addEventListener("click",clearRoute);destinationSelect.addEventListener("change",()=>{cancelNavigation();setDestination(destinationSelect.value);routeState.textContent='未开始';routeState.classList.remove('active');routeSummary.textContent='终点已更新，点击开始导航'});startSelect.addEventListener('change',()=>{cancelNavigation();routeState.textContent='未开始';routeState.classList.remove('active');routeSummary.textContent='起点已更新，点击开始导航'});
    document.querySelectorAll('input[name="routePreference"]').forEach(input=>input.addEventListener("change",()=>{if(activeRoute.length||navigationPending)planRoute()}));
    document.querySelector("#fitButton").addEventListener("click",()=>{focusHall(null,false);desiredTarget.copy(homeForView(viewMode));desiredDistance=overviewDistance;requestRender()});
    document.querySelectorAll("[data-view]").forEach(link=>link.addEventListener("click",event=>{event.preventDefault();setViewMode(link.dataset.view,{updateUrl:true,manual:true})}));

    function pan(dx,dy){const wpp=2*distance*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/Math.max(stage.clientHeight,1),forward=new THREE.Vector3(-Math.sin(azimuth),0,-Math.cos(azimuth)).normalize(),right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();desiredTarget.addScaledVector(right,-dx*wpp).addScaledVector(forward,dy*wpp)}
    canvas.addEventListener("contextmenu",event=>event.preventDefault());
    canvas.addEventListener("pointerdown",event=>{
      if(event.button>2)return;event.preventDefault();
      if(!pointers.size)travel=0;else travel=Math.max(travel,7);
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      dragAction=event.pointerType==="mouse"&&event.button===2?"orbit":"pan";
    });
    canvas.addEventListener("pointermove",event=>{
      if(!pointers.has(event.pointerId))return;
      const before=[...pointers.values()],prev=pointers.get(event.pointerId);
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      const dx=event.clientX-prev.x,dy=event.clientY-prev.y;travel+=Math.hypot(dx,dy);
      if(pointers.size===2){
        const after=[...pointers.values()],oldX=before[1].x-before[0].x,oldY=before[1].y-before[0].y,newX=after[1].x-after[0].x,newY=after[1].y-after[0].y;
        const oldSpan=Math.hypot(oldX,oldY),span=Math.hypot(newX,newY);
        if(span>20&&oldSpan>20){
          desiredDistance=THREE.MathUtils.clamp(desiredDistance*oldSpan/span,minDistance,maxDistance);
          const angle=Math.atan2(newY,newX)-Math.atan2(oldY,oldX);
          azimuth+=Math.atan2(Math.sin(angle),Math.cos(angle));
        }
      }else if(pointers.size===1){
        if(dragAction==="pan")pan(dx,dy);
        else{azimuth-=dx*.006;polar=THREE.MathUtils.clamp(polar+dy*.005,.35,1.28)}
      }
      requestRender();
    });
    const pointerUp=event=>{if(event.type!=="pointerup")travel=Math.max(travel,7);pointers.delete(event.pointerId);try{canvas.releasePointerCapture(event.pointerId)}catch(_){}};
    canvas.addEventListener("pointerup",pointerUp);canvas.addEventListener("pointercancel",pointerUp);
    canvas.addEventListener("lostpointercapture",event=>{if(pointers.has(event.pointerId)){pointers.delete(event.pointerId);travel=Math.max(travel,7)}});
    canvas.addEventListener("wheel",event=>{event.preventDefault();desiredDistance=THREE.MathUtils.clamp(desiredDistance*Math.exp(event.deltaY*.001),minDistance,maxDistance);requestRender()},{passive:false});
    canvas.addEventListener("click",event=>{if(travel>6)return;const rect=canvas.getBoundingClientRect();pointer.x=(event.clientX-rect.left)/rect.width*2-1;pointer.y=-(event.clientY-rect.top)/rect.height*2+1;raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects([...halls.filter(hall=>viewMode==="ALL"||hall.floor===viewMode).map(hall=>hall.coverMesh?.visible?hall.coverMesh:hall.floorMesh).filter(Boolean),...((viewMode==='F1'||viewMode==='ALL')&&boothHall.detailed?booths.map(b=>b.mesh):[])],false)[0];if(hit?.object.userData.booth){openBooth(hit.object.userData.booth);return}if(hit){closeBooth();const hall=halls.find(item=>item.id===hit.object.userData.hall&&item.floor===hit.object.userData.floor);if(hall)focusHall(hall)}});

    function resize(){const rect=stage.getBoundingClientRect();renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();requestRender()}
    function requestRender(){if(!framePending){framePending=true;requestAnimationFrame(tick)}}
    function tick(){
      framePending=false;target.lerp(desiredTarget,.16);distance=THREE.MathUtils.lerp(distance,desiredDistance,.15);const sin=Math.sin(polar);camera.position.set(target.x+distance*sin*Math.sin(azimuth),target.y+distance*Math.cos(polar),target.z+distance*sin*Math.cos(azimuth));camera.lookAt(target);camera.updateMatrixWorld();updateHallRendering();renderer.render(scene,camera);
      const rect=stage.getBoundingClientRect(),occupied=[];
      for(const panel of stage.querySelectorAll("aside,.legend-card,.gesture-hint")){const r=panel.getBoundingClientRect();if(r.width&&r.height)occupied.push({x:r.left-rect.left+r.width/2,y:r.top-rect.top+r.height/2,w:r.width,h:r.height})}
      const overlaps=(x,y,w,h)=>occupied.some(r=>Math.abs(r.x-x)<(r.w+w)/2+5&&Math.abs(r.y-y)<(r.h+h)/2+5);
      const project=(position,floor)=>{const anchor=floorGroups.get(floor).localToWorld(position.clone()),p=anchor.clone().project(camera);return{anchor,p,x:(p.x*.5+.5)*rect.width,y:(-p.y*.5+.5)*rect.height}};
      const upperGround=floorGroups.get("F3").userData.groundMesh;
      const occluded=(anchor,floor)=>{if(viewMode!=="ALL"||floor!=="F1"||!upperGround)return false;const delta=anchor.clone().sub(camera.position);raycaster.set(camera.position,delta.clone().normalize());raycaster.far=delta.length()-.3;const hit=raycaster.intersectObject(upperGround,false).length>0;raycaster.far=Infinity;return hit};
      halls.forEach(hall=>{hall.label.style.display="none";if((viewMode!=="ALL"&&hall.floor!==viewMode)||distance<size*.45)return;const {anchor,p,x,y}=project(hall.center.clone().add(new THREE.Vector3(0,4,0)),hall.floor),w=hall.id==="mid"?100:66,h=30;if(p.z<=-1||p.z>=1||x<w/2||x>rect.width-w/2||y<20||y>rect.height-20||overlaps(x,y,w,h)||occluded(anchor,hall.floor))return;hall.label.style.display="block";hall.label.style.left=x+"px";hall.label.style.top=y+"px";occupied.push({x,y,w,h})});
      FLOOR_DEFS.forEach(def=>{const group=floorGroups.get(def.id);if(!group)return;if(viewMode!=="ALL"&&def.id!==viewMode){group.userData.badge.style.display="none";return}group.userData.badge.style.display="block";const p=displayedPosition(group.userData.badgePosition,def.id).project(camera),x=(p.x*.5+.5)*rect.width,y=(-p.y*.5+.5)*rect.height;group.userData.badge.style.left=x+"px";group.userData.badge.style.top=y+"px"});
      const priority={accessible:9,elevator:8,door:7,escalator:6,stairs:5,male:4,female:4},candidates=[];
      endpoints.forEach(node=>{node.element.style.display="none";if(node.type==='booth')return;if(viewMode!=="ALL"&&node.floor!==viewMode)return;const hall=halls.find(h=>h.floor===node.floor&&h.id===node.hall);if(!hall?.detailed)return;
        const height=node.type==="elevator"?3.1:CONNECTORS.has(node.type)?1.45:node.type==="door"?2.7:.45;
        const {anchor,p,x,y}=project(node.position.clone().setY(height),node.floor),near=camera.position.distanceTo(anchor),important=node===selectedDestination||node.id===startSelect.value;
        if(p.z<=-1||p.z>=1||x<22||x>rect.width-22||y<22||y>rect.height-22)return;
        if(near>size*.8&&!important)return;if(node.type==="door"&&near>size*.32&&![4,7,16,19].includes(node.number)&&!important)return;
        candidates.push({node,anchor,x,y,near,score:(important?100:0)+(priority[node.type]||1)});
      });
      candidates.sort((a,b)=>b.score-a.score||a.near-b.near||a.node.id.localeCompare(b.node.id));let markerCount=0;
      const iconLimit=distance<size*.25?Infinity:distance<size*.5?30:12;
      for(const c of candidates){if(markerCount>=iconLimit)break;if(overlaps(c.x,c.y,28,28)||occluded(c.anchor,c.node.floor))continue;c.node.element.style.display="grid";c.node.element.style.left=c.x+"px";c.node.element.style.top=c.y+"px";occupied.push({x:c.x,y:c.y,w:28,h:28});markerCount++}
      if(boothHall.detailed&&(viewMode==='F1'||viewMode==='ALL'))for(const booth of [...booths].sort((a,b)=>(b===selectedBooth?1:0)-(a===selectedBooth?1:0)||b.bounds.getSize(new THREE.Vector3()).length()-a.bounds.getSize(new THREE.Vector3()).length())){
        const {anchor,p,x,y}=project(booth.center,'F1');if(p.z<=-1||p.z>=1||x<0||y<0||x>rect.width||y>rect.height||occluded(anchor,'F1'))continue;
        const projected=booth.polygon.map(v=>project(v.clone().setY(1.6),'F1')),w=(Math.max(...projected.map(v=>v.x))-Math.min(...projected.map(v=>v.x)))*.80,h=Math.max(...projected.map(v=>v.y))-Math.min(...projected.map(v=>v.y)),font=Math.min(14,Math.floor(w/(booth.shortName.length+.6)),Math.floor(h/2.8));
        if(font<9||overlaps(x,y,Math.min(w,font*6),font*2.6))continue;const el=booth.element;el.style.display='block';el.style.left=x+'px';el.style.top=y+'px';el.style.width=w+'px';el.style.fontSize=font+'px';occupied.push({x,y,w:Math.min(w,font*6),h:font*2.6});
      }
      canvas.dataset.diagnostics=JSON.stringify({view:viewMode,distance:Math.round(distance),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,icons:markerCount,detailAreas:halls.filter(h=>(viewMode==="ALL"||h.floor===viewMode)&&h.detailed).length,coverAreas:halls.filter(h=>(viewMode==="ALL"||h.floor===viewMode)&&!h.detailed).length,floors:floorModels.map(g=>({floor:g.userData.floor,y:g.position.y,visible:g.visible})),hallCount:halls.filter(h=>h.id!=="mid").length,facilityCount:endpoints.length});
      if(target.distanceToSquared(desiredTarget)>.001||Math.abs(distance-desiredDistance)>.02)requestRender();
    }
    window.venueDiagnostics={renderer,scene,camera,halls,endpoints,floorGroups,standard:MODEL_STANDARD,navigationData,get navigation(){return lastNavigationResult},get view(){return viewMode},get distance(){return distance},setView:setViewMode,focus:focusHall,zoom(value){desiredDistance=value;requestRender()},render:requestRender};
    addEventListener("resize",resize);setViewMode(viewMode,{updateUrl:false});resize();loading.classList.add("hidden");status.textContent=`已识别 ${halls.filter(h=>h.id!=="mid").length} 个展馆、2 个中央商务区、${endpoints.length-booths.length} 个设施、${booths.length} 个展位`;requestRender();
  }
  start().catch(error=>{console.error(error);loading.textContent=error.message;status.textContent="多层地图生成失败"});
})();
