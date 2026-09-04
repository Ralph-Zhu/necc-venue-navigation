(function(){
  "use strict";

  const SOURCE="./assets/figma-7.2-booths.svg";
  const PIXELS_PER_METER=10;
  const SCALE=1/PIXELS_PER_METER;
  const WALL_HEIGHT=3.6;
  const PALETTE={
    background:0x0b1520,
    floor:0x586f75,
    wall:0xe5eaec,
    entrance:0x9bdcf0,
    stairs:0xaa9274,
    female:0xb8798d,
    male:0x6689ad,
    accessible:0x6d9a78,
    escalator:0xc08a4d,
    elevator:0x687da8,
    service:0x8178aa,
    booth:0x4c9b8d
  };
  let VIEW={w:3248,h:1652};
  let applyImageBooths=null;
  let lastRecognizedBooths=[];

  function parsePath(d){
    const tokens=d.match(/[MLHVZmlhvz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)||[];
    const subpaths=[],segments=[];
    let current=[],i=0,cmd="",x=0,y=0,start=null;
    const isCmd=value=>/^[MLHVZmlhvz]$/.test(value);
    const moveTo=p=>{
      if(current.length)subpaths.push(current);
      current=[p];start=p;x=p[0];y=p[1];
    };
    const lineTo=p=>{
      if(!current.length)moveTo([x,y]);
      segments.push([[x,y],p]);current.push(p);x=p[0];y=p[1];
    };
    while(i<tokens.length){
      if(isCmd(tokens[i]))cmd=tokens[i++];
      if(!cmd)break;
      const upper=cmd.toUpperCase(),relative=cmd===cmd.toLowerCase();
      if(upper==="Z"){
        if(start&&(x!==start[0]||y!==start[1]))segments.push([[x,y],start]);
        if(current.length)subpaths.push(current);
        current=[];if(start){x=start[0];y=start[1]}start=null;cmd="";continue;
      }
      if(upper==="M"||upper==="L"){
        if(i+1>=tokens.length||isCmd(tokens[i])){cmd="";continue}
        const nx=Number(tokens[i++]),ny=Number(tokens[i++]);
        const p=[relative?x+nx:nx,relative?y+ny:ny];
        if(upper==="M"){moveTo(p);cmd=relative?"l":"L"}else lineTo(p);
        continue;
      }
      if(upper==="H"){
        if(i>=tokens.length||isCmd(tokens[i])){cmd="";continue}
        const nx=Number(tokens[i++]);lineTo([relative?x+nx:nx,y]);continue;
      }
      if(upper==="V"){
        if(i>=tokens.length||isCmd(tokens[i])){cmd="";continue}
        const ny=Number(tokens[i++]);lineTo([x,relative?y+ny:ny]);continue;
      }
      cmd="";
    }
    if(current.length)subpaths.push(current);
    return{subpaths,segments};
  }

  const world=([x,y])=>new THREE.Vector3((x-VIEW.w/2)*SCALE,0,(y-VIEW.h/2)*SCALE);

  function semanticLeaves(root,pattern){
    const matches=[...root.querySelectorAll("[id]")].filter(node=>pattern.test(node.id.trim()));
    return matches.filter(node=>![...node.querySelectorAll("[id]")].some(child=>pattern.test(child.id.trim())));
  }

  function doorNumber(id){
    const clean=id.trim(),standard=clean.match(/__D(\d{3})(?:__|$)/);
    if(standard)return Number(standard[1]);
    const matches=[...clean.matchAll(/__(\d{2,3})/g)];
    return matches.length?Number(matches[matches.length-1][1]):0;
  }

  function setupImageRecognition(){
    const trigger=document.querySelector("#imageRecognitionTrigger");
    const input=document.querySelector("#imageRecognitionInput");
    const result=document.querySelector("#recognitionResult");
    const message=document.querySelector("#recognitionMessage");
    const list=document.querySelector("#recognizedBoothList");
    const canvas=document.querySelector("#imageRecognitionCanvas");
    const applyButton=document.querySelector("#applyRecognizedBooths");
    const sampleButton=document.querySelector("#useSamplePlan");
    const calibration={left:.0762,right:.9437,top:.2672,bottom:.7483,svgLeft:308,svgRight:3005,svgTop:351,svgBottom:1413};
    let running=false;

    const setBusy=(busy,text)=>{
      running=busy;trigger.disabled=busy;sampleButton.disabled=busy;applyButton.disabled=busy||!lastRecognizedBooths.length;
      if(text){message.className="recognition-message";message.textContent=text}
    };

    const loadBitmap=async blob=>{
      if(typeof createImageBitmap==="function")return createImageBitmap(blob);
      const url=URL.createObjectURL(blob),image=new Image();
      try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url});return image}
      finally{URL.revokeObjectURL(url)}
    };

    const detect=async(blob,fileName,autoApply=false)=>{
      if(running)return;
      if(blob.size>18*1024*1024)throw new Error("图片超过18MB，请导出长边5000到8000像素的JPG后重试");
      result.hidden=false;list.innerHTML="";lastRecognizedBooths=[];
      setBusy(true,"正在筛选展位状态色，并排除文字、尺寸线与固定设施…");
      await new Promise(resolve=>setTimeout(resolve,30));
      const bitmap=await loadBitmap(blob);
      const maxWidth=1985,ratio=Math.min(1,maxWidth/bitmap.width);
      const width=Math.round(bitmap.width*ratio),height=Math.round(bitmap.height*ratio);
      canvas.width=width;canvas.height=height;
      const context=canvas.getContext("2d",{willReadFrequently:true});
      context.imageSmoothingEnabled=false;
      context.drawImage(bitmap,0,0,width,height);
      const imageData=context.getImageData(0,0,width,height),pixels=imageData.data,total=width*height;
      const mask=new Uint8Array(total),left=0,right=width;
      const top=Math.floor(height*.164),bottom=height;
      let colorPixels=0;
      for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
        const index=y*width+x,offset=index*4,r=pixels[offset],g=pixels[offset+1],b=pixels[offset+2];
        const green=g>=180&&r<=110&&b<=110;
        if(green){mask[index]=1;colorPixels++}
      }
      const queue=new Int32Array(total),components=[];
      for(let start=0;start<total;start++){
        if(!mask[start])continue;
        let head=0,tail=0;queue[tail++]=start;mask[start]=0;
        let minX=width,maxX=0,minY=height,maxY=0,area=0;
        while(head<tail){
          const current=queue[head++],y=Math.floor(current/width),x=current-y*width;area++;
          if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
          const add=next=>{if(mask[next]){mask[next]=0;queue[tail++]=next}};
          if(x>0)add(current-1);if(x<width-1)add(current+1);if(y>0)add(current-width);if(y<height-1)add(current+width);
        }
        const boxWidth=maxX-minX+1,boxHeight=maxY-minY+1,fill=area/(boxWidth*boxHeight),aspect=Math.max(boxWidth,boxHeight)/Math.max(1,Math.min(boxWidth,boxHeight));
        if(area>=150&&boxWidth>=9&&boxHeight>=6&&fill>=.34&&aspect>=1.15&&aspect<=12){components.push({minX,minY,maxX,maxY,area,fill})}
      }
      components.sort((a,b)=>Math.abs(a.minY-b.minY)>10?a.minY-b.minY:a.minX-b.minX);
      const map=(value,inMin,inMax,outMin,outMax)=>outMin+(value-inMin)/(inMax-inMin)*(outMax-outMin);
      lastRecognizedBooths=components.map((component,index)=>{
        const x1=map(component.minX/width,calibration.left,calibration.right,calibration.svgLeft,calibration.svgRight);
        const x2=map(component.maxX/width,calibration.left,calibration.right,calibration.svgLeft,calibration.svgRight);
        const y1=map(component.minY/height,calibration.top,calibration.bottom,calibration.svgTop,calibration.svgBottom);
        const y2=map(component.maxY/height,calibration.top,calibration.bottom,calibration.svgTop,calibration.svgBottom);
        return{id:"IMG"+String(index+1).padStart(3,"0"),x:Math.min(x1,x2),y:Math.min(y1,y2),width:Math.max(6,Math.abs(x2-x1)),height:Math.max(6,Math.abs(y2-y1)),confidence:component.fill>=.9?"high":"medium",source:component};
      });
      context.lineWidth=Math.max(2,width/900);context.font=`bold ${Math.max(9,width/150)}px sans-serif`;
      lastRecognizedBooths.forEach((record,index)=>{
        const box=record.source;context.strokeStyle=record.confidence==="high"?"#00b894":"#f0a840";
        context.strokeRect(box.minX,box.minY,box.maxX-box.minX,box.maxY-box.minY);
        if(box.maxX-box.minX>26&&box.maxY-box.minY>13){
          const label=String(index+1);context.fillStyle="rgba(3,26,25,.82)";context.fillRect(box.minX+1,box.minY+1,context.measureText(label).width+6,14);context.fillStyle="#dcfff7";context.fillText(label,box.minX+4,box.minY+12);
        }
      });
      bitmap.close?.();
      const highCount=lastRecognizedBooths.filter(item=>item.confidence==="high").length;
      document.querySelector("#recognitionFileName").textContent=`${fileName} · ${(blob.size/1024/1024).toFixed(2)} MB · ${bitmap.width||Math.round(width/ratio)}×${bitmap.height||Math.round(height/ratio)}`;
      document.querySelector("#recognizedBoothCount").textContent=lastRecognizedBooths.length;
      document.querySelector("#recognizedHighCount").textContent=highCount;
      document.querySelector("#recognizedIgnoredCount").textContent=(100-colorPixels/total*100).toFixed(1)+"%";
      document.querySelector("#recognizedScale").textContent="已对齐";
      list.innerHTML="";
      lastRecognizedBooths.forEach(item=>{const tag=document.createElement("span");tag.className=item.confidence;tag.textContent=item.id;list.appendChild(tag)});
      message.className="recognition-message";
      message.textContent=lastRecognizedBooths.length?`识别完成：找到 ${lastRecognizedBooths.length} 个绿色展位块。公共区域、门、厕所、楼梯、电梯和尺寸文字均未进入展位层。连续长条暂按组合展位处理。`:"未找到展位，请确认图片为7.2馆原始导出图，且展位使用绿色填充。";
      if(!lastRecognizedBooths.length)message.classList.add("error");
      setBusy(false);
      if(autoApply&&lastRecognizedBooths.length){
        if(applyImageBooths)applyImageBooths(lastRecognizedBooths);
      }
    };

    const showError=(fileName,error)=>{
      console.error(error);document.querySelector("#recognitionFileName").textContent=fileName||"未识别文件";
      message.className="recognition-message error";message.textContent=error.message||"图片读取失败";setBusy(false);result.hidden=false;
    };
    const runSample=async(autoApply=false)=>{
      try{const response=await fetch("./assets/7.2-booth-plan.jpg?v=20260902");if(!response.ok)throw new Error("7.2案例图读取失败");await detect(await response.blob(),"7.2-booth-plan.jpg",autoApply)}catch(error){showError("7.2-booth-plan.jpg",error)}
    };
    trigger.addEventListener("click",()=>{input.value="";input.click()});
    input.addEventListener("change",async()=>{
      const file=input.files?.[0];if(!file)return;
      if(!/^image\/(?:jpeg|png)$/i.test(file.type)){showError(file.name,new Error("请选择JPG、JPEG或PNG格式的展位图"));return}
      try{await detect(file,file.name,false)}catch(error){showError(file.name,error)}
    });
    applyButton.addEventListener("click",()=>{if(applyImageBooths&&lastRecognizedBooths.length)applyImageBooths(lastRecognizedBooths)});
    sampleButton.addEventListener("click",()=>runSample(false));
    document.querySelector("#recognitionClose").addEventListener("click",()=>{result.hidden=true});
    runSample(true);
  }

  function rootPoint(svg,node,x,y){
    const point=svg.createSVGPoint();point.x=x;point.y=y;
    const nodeMatrix=node.getCTM(),rootMatrix=svg.getCTM();
    if(!nodeMatrix||!rootMatrix)return{x,y};
    const viewportPoint=point.matrixTransform(nodeMatrix);
    const localPoint=viewportPoint.matrixTransform(rootMatrix.inverse());
    return{x:localPoint.x,y:localPoint.y};
  }

  async function load(){
    const text=await fetch(SOURCE).then(response=>{
      if(!response.ok)throw new Error("SVG读取失败");
      return response.text();
    });
    const stage=document.querySelector("#svgStage");
    stage.innerHTML=text;
    const svg=stage.querySelector("svg");
    if(!svg)throw new Error("文件中没有有效SVG");
    svg.setAttribute("aria-label","7.2号馆Figma矢量图");

    const viewBox=(svg.getAttribute("viewBox")||"0 0 3248 1652").trim().split(/[ ,]+/).map(Number);
    VIEW={w:viewBox[2]||3248,h:viewBox[3]||1652};
    const floor=[...svg.querySelectorAll('[id^="FLOOR_SHAPE__"],path[id^="FLOOR__"]')]
      .filter(node=>node.tagName.toLowerCase()==="path");
    const walls=[...svg.querySelectorAll('path[id^="WALL__"],path[id^="WALLS__"]')];
    const entrances=[...svg.querySelectorAll('line[id*="DOOR"]')];
    const facilityTypes=[
      {key:"stairs",label:"楼梯",pattern:/^STAIRS__/,color:PALETTE.stairs,css:"#aa9274",priority:70},
      {key:"female",label:"女卫生间",pattern:/^WC_FEMALE__/,color:PALETTE.female,css:"#b8798d",priority:50},
      {key:"male",label:"男卫生间",pattern:/^WC_MALE__/,color:PALETTE.male,css:"#6689ad",priority:50},
      {key:"accessible",label:"无障碍卫生间",pattern:/^WC_ACCESSIBLE__/,color:PALETTE.accessible,css:"#6d9a78",priority:80},
      {key:"escalator",label:"扶梯",pattern:/^ESCALATORS?__/,color:PALETTE.escalator,css:"#c08a4d",priority:90},
      {key:"elevator",label:"电梯",pattern:/^ELEVATORS?__/,color:PALETTE.elevator,css:"#687da8",priority:100},
      {key:"service",label:"服务点",pattern:/^SERVICE__/,color:PALETTE.service,css:"#8178aa",priority:85}
    ].map(type=>({...type,nodes:semanticLeaves(svg,type.pattern)}));
    const booths=semanticLeaves(svg,/^BOOTH(?:_SPECIAL|_SERVICE)?__/);
    const services=[];
    const ids=[...svg.querySelectorAll("[id]")].filter(node=>
      /^(FLOOR(?:_SHAPE)?__|WALLS?__|DOORS?__|WC_|STAIRS__|ELEVATORS?__|ESCALATORS?__|BOOTH|SERVICE)/.test(node.id.trim())
    );
    const facilities=facilityTypes.reduce((sum,type)=>sum+type.nodes.length,0);
    document.querySelector("#floorCount").textContent=floor.length;
    document.querySelector("#wallCount").textContent=walls.length;
    document.querySelector("#entranceCount").textContent=entrances.length;
    document.querySelector("#facilityCount").textContent=facilities;
    document.querySelector("#boothCount").textContent=booths.length;
    document.querySelector("#idCount").textContent=ids.length;
    initThree(svg,floor[0],walls,entrances,facilityTypes,booths,services);
  }

  function segment(a,b,width,height,color,baseY,opacity=1){
    const p1=world(a),p2=world(b),dx=p2.x-p1.x,dz=p2.z-p1.z,length=Math.hypot(dx,dz);
    if(length<=0)return null;
    const mesh=new THREE.Mesh(
      new THREE.BoxGeometry(length,height,width),
      new THREE.MeshStandardMaterial({color,roughness:.65,transparent:opacity<1,opacity})
    );
    mesh.position.set((p1.x+p2.x)/2,baseY+height/2,(p1.z+p2.z)/2);
    mesh.rotation.y=-Math.atan2(dz,dx);
    return mesh;
  }

  function doubleGlassDoor(a,b,sourceId){
    const p1=world(a),p2=world(b),dx=p2.x-p1.x,dz=p2.z-p1.z,length=Math.hypot(dx,dz);
    if(length<=0)return null;
    const group=new THREE.Group();
    const height=2.7,depth=.12;
    const frameWidth=Math.max(.055,Math.min(.12,length*.012));
    const centerGap=Math.max(.08,Math.min(.16,length*.025));
    const panelWidth=Math.max(.2,(length-frameWidth*2-centerGap)/2);
    group.position.set((p1.x+p2.x)/2,0,(p1.z+p2.z)/2);
    group.rotation.y=-Math.atan2(dz,dx);
    group.userData.sourceId=sourceId;

    const glassMaterial=new THREE.MeshPhysicalMaterial({
      color:PALETTE.entrance,
      transparent:true,
      opacity:.52,
      roughness:.08,
      metalness:.04,
      transmission:.22,
      thickness:.08,
      clearcoat:.55,
      clearcoatRoughness:.12,
      side:THREE.DoubleSide,
      depthWrite:false
    });
    const frameMaterial=new THREE.MeshStandardMaterial({color:0xb7ced8,roughness:.3,metalness:.58});
    const handleMaterial=new THREE.MeshStandardMaterial({color:0xe7f0f4,roughness:.22,metalness:.72});

    for(const side of [-1,1]){
      const panel=new THREE.Mesh(new THREE.BoxGeometry(panelWidth,height,depth),glassMaterial);
      panel.position.set(side*(centerGap/2+panelWidth/2),height/2,0);
      panel.userData.sourceId=sourceId;
      group.add(panel);
    }
    for(const x of [-length/2,0,length/2]){
      const upright=new THREE.Mesh(new THREE.BoxGeometry(frameWidth,height+frameWidth,depth*1.35),frameMaterial);
      upright.position.set(x,height/2,0);
      group.add(upright);
    }
    for(const y of [frameWidth/2,height]){
      const rail=new THREE.Mesh(new THREE.BoxGeometry(length+frameWidth,frameWidth,depth*1.35),frameMaterial);
      rail.position.set(0,y,0);
      group.add(rail);
    }
    const handleOffset=Math.max(.13,centerGap/2+.08);
    for(const side of [-1,1]){
      const handle=new THREE.Mesh(new THREE.BoxGeometry(.045,.58,.055),handleMaterial);
      handle.position.set(side*handleOffset,1.18,depth*.82);
      group.add(handle);
    }
    return group;
  }

  function footprintFrame(svg,node){
    let box;
    try{box=node.getBBox()}catch{return null}
    if(!box||box.width<=0||box.height<=0)return null;
    const p0=rootPoint(svg,node,box.x,box.y);
    const p1=rootPoint(svg,node,box.x+box.width,box.y);
    const p2=rootPoint(svg,node,box.x+box.width,box.y+box.height);
    const p3=rootPoint(svg,node,box.x,box.y+box.height);
    const center={x:(p0.x+p1.x+p2.x+p3.x)/4,y:(p0.y+p1.y+p2.y+p3.y)/4};
    const width=Math.hypot(p1.x-p0.x,p1.y-p0.y)*SCALE;
    const depth=Math.hypot(p3.x-p0.x,p3.y-p0.y)*SCALE;
    if(width<=0||depth<=0)return null;
    const position=world([center.x,center.y]);
    return{
      position,
      width,
      depth,
      rotation:-Math.atan2(p1.y-p0.y,p1.x-p0.x),
      sourceId:node.id.trim()
    };
  }

  function facilityOutline(svg,node){
    if(node.tagName.toLowerCase()==="rect"){
      const x=Number(node.getAttribute("x")||0),y=Number(node.getAttribute("y")||0);
      const width=Number(node.getAttribute("width")||0),height=Number(node.getAttribute("height")||0);
      return[
        rootPoint(svg,node,x,y),
        rootPoint(svg,node,x+width,y),
        rootPoint(svg,node,x+width,y+height),
        rootPoint(svg,node,x,y+height)
      ];
    }
    if(typeof node.getTotalLength==="function"&&typeof node.getPointAtLength==="function"){
      const length=node.getTotalLength();
      if(length>0){
        const samples=Math.max(12,Math.min(120,Math.ceil(length/24)));
        const points=[];
        for(let index=0;index<samples;index++){
          const value=node.getPointAtLength(length*index/samples);
          points.push(rootPoint(svg,node,value.x,value.y));
        }
        return points;
      }
    }
    return[];
  }

  function flatFacility(svg,node,frame,color){
    const outline=facilityOutline(svg,node);
    if(outline.length>=3){
      const shape=new THREE.Shape();
      outline.forEach((point,index)=>{
        const value=world([point.x,point.y]);
        if(index===0)shape.moveTo(value.x,value.z);else shape.lineTo(value.x,value.z);
      });
      shape.closePath();
      const geometry=new THREE.ShapeGeometry(shape);
      geometry.rotateX(Math.PI/2);
      const surface=new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({color,roughness:.84,metalness:0,side:THREE.DoubleSide})
      );
      surface.position.y=.018;
      surface.userData.sourceId=frame.sourceId;
      return surface;
    }
    const group=new THREE.Group();
    group.position.set(frame.position.x,.018,frame.position.z);
    group.rotation.y=frame.rotation;
    const fallback=new THREE.Mesh(
      new THREE.PlaneGeometry(frame.width,frame.depth),
      new THREE.MeshStandardMaterial({color,roughness:.84,metalness:0,side:THREE.DoubleSide})
    );
    fallback.rotation.x=-Math.PI/2;
    fallback.userData.sourceId=frame.sourceId;
    group.add(fallback);
    return group;
  }

  function elevatorSolid(frame,color){
    const group=new THREE.Group();
    group.position.set(frame.position.x,0,frame.position.z);
    group.rotation.y=frame.rotation;
    const height=3.15;
    const body=new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(frame.width,.9),height,Math.max(frame.depth,.9)),
      new THREE.MeshStandardMaterial({color,roughness:.42,metalness:.18})
    );
    body.position.y=height/2;
    body.userData.sourceId=frame.sourceId;
    group.add(body);
    const door=new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(frame.width*.56,.48),1.95,.045),
      new THREE.MeshStandardMaterial({color:0xdce5f0,roughness:.34,metalness:.45})
    );
    door.position.set(0,1.05,Math.max(frame.depth,.9)/2+.024);
    group.add(door);
    return group;
  }

  function stairsSolid(frame,color){
    const group=new THREE.Group();
    const alongDepth=frame.depth>frame.width;
    const length=alongDepth?frame.depth:frame.width;
    const cross=alongDepth?frame.width:frame.depth;
    group.position.set(frame.position.x,0,frame.position.z);
    group.rotation.y=frame.rotation+(alongDepth?-Math.PI/2:0);
    const material=new THREE.MeshStandardMaterial({color,roughness:.74,metalness:0});
    const steps=7,stepLength=length/steps;
    for(let index=0;index<steps;index++){
      const height=.12+(index+1)*.14;
      const step=new THREE.Mesh(
        new THREE.BoxGeometry(stepLength*1.04,height,Math.max(cross,.55)),
        material
      );
      step.position.set(-length/2+stepLength*(index+.5),height/2,0);
      group.add(step);
    }
    group.userData.sourceId=frame.sourceId;
    return group;
  }

  function escalatorSolid(frame,color){
    const group=new THREE.Group();
    const alongDepth=frame.depth>frame.width;
    const length=alongDepth?frame.depth:frame.width;
    const cross=alongDepth?frame.width:frame.depth;
    group.position.set(frame.position.x,0,frame.position.z);
    group.rotation.y=frame.rotation+(alongDepth?-Math.PI/2:0);
    const rise=Math.min(1.15,Math.max(.72,length*.16));
    const slope=Math.atan2(rise,length);
    const trackWidth=Math.max(cross*.38,.32);
    const support=new THREE.Mesh(
      new THREE.BoxGeometry(length,.28,Math.max(cross*.92,.7)),
      new THREE.MeshStandardMaterial({color:0x5c6870,roughness:.62,metalness:.18})
    );
    support.rotation.z=slope;
    support.position.y=rise/2+.08;
    group.add(support);
    const trackMaterial=new THREE.MeshStandardMaterial({color,roughness:.52,metalness:.08});
    for(const side of [-1,1]){
      const track=new THREE.Mesh(
        new THREE.BoxGeometry(length,.22,trackWidth),
        trackMaterial
      );
      track.rotation.z=slope;
      track.position.set(0,rise/2+.12,side*cross*.25);
      group.add(track);
    }
    const treadMaterial=new THREE.MeshStandardMaterial({color:0xd8d3c6,roughness:.58,metalness:.15});
    const treadCount=12,treadLength=length/treadCount;
    for(let index=0;index<treadCount;index++){
      const progress=(index+.5)/treadCount;
      const tread=new THREE.Mesh(
        new THREE.BoxGeometry(treadLength*1.04,.12,Math.max(cross*.84,.62)),
        treadMaterial
      );
      tread.position.set(-length/2+treadLength*(index+.5),.16+rise*progress,0);
      group.add(tread);
    }
    for(const end of [-1,1]){
      const platform=new THREE.Mesh(
        new THREE.BoxGeometry(treadLength*1.7,.15,Math.max(cross,.72)),
        treadMaterial
      );
      platform.position.set(end*(length/2-treadLength*.7),end<0?.075:rise+.075,0);
      group.add(platform);
    }
    const railMaterial=new THREE.MeshStandardMaterial({color:0xe6edf2,roughness:.32,metalness:.28});
    for(const side of [-1,1]){
      const rail=new THREE.Mesh(
        new THREE.BoxGeometry(length,.08,.065),
        railMaterial
      );
      rail.rotation.z=slope;
      rail.position.set(0,rise/2+.42,side*cross*.5);
      group.add(rail);
    }
    group.userData.sourceId=frame.sourceId;
    return group;
  }

  function blockFootprint(frame,color,height,baseY=.03){
    const mesh=new THREE.Mesh(
      new THREE.BoxGeometry(frame.width,height,frame.depth),
      new THREE.MeshStandardMaterial({color,roughness:.62,metalness:.04})
    );
    mesh.position.set(frame.position.x,baseY+height/2,frame.position.z);
    mesh.rotation.y=frame.rotation;
    mesh.userData.sourceId=frame.sourceId;
    return mesh;
  }

  function boothNumber(id){
    const match=id.trim().match(/__([A-Z]\d{2,})$/i);
    return match?match[1].toUpperCase():id.trim().split("__").pop();
  }

  function boothData(id){
    const number=boothNumber(id);
    const index=Number((number.match(/\d+/)||["1"])[0]);
    const companies=["云图智能","未来科技","华展设备","星河设计","新境能源","智造中心","蓝海材料","启明系统","光域科技","远景机器","数联空间","博览服务"];
    const categories=["智能制造","数字科技","展陈设计","新能源","工业设备","新材料"];
    const company=Array.from(companies[(index-1)%companies.length]).slice(0,6).join("");
    const category=categories[(index-1)%categories.length];
    return{
      number,
      company,
      category,
      contact:"展会服务台 · 分机 "+String(100+index),
      description:"展示"+category+"相关产品与解决方案。本页面为展位点击和企业信息匹配的模拟数据。"
    };
  }

  function boothObject(svg,node,frame){
    const height=1.45;
    const material=new THREE.MeshStandardMaterial({
      color:PALETTE.booth,
      roughness:.58,
      metalness:.06,
      emissive:0x082a2d,
      emissiveIntensity:.18
    });
    const outline=facilityOutline(svg,node);
    let mesh;
    if(outline.length>=3){
      const shape=new THREE.Shape();
      outline.forEach((point,index)=>{
        const value=world([point.x,point.y]);
        if(index===0)shape.moveTo(value.x,value.z);else shape.lineTo(value.x,value.z);
      });
      shape.closePath();
      const geometry=new THREE.ExtrudeGeometry(shape,{
        depth:height,
        bevelEnabled:true,
        bevelSize:.055,
        bevelThickness:.055,
        bevelSegments:1
      });
      geometry.rotateX(Math.PI/2);
      geometry.translate(0,height,0);
      mesh=new THREE.Mesh(geometry,material);
    }else{
      mesh=new THREE.Mesh(new THREE.BoxGeometry(frame.width,height,frame.depth),material);
      mesh.position.set(frame.position.x,height/2,frame.position.z);
      mesh.rotation.y=frame.rotation;
    }
    mesh.userData.sourceId=frame.sourceId;

    const edge=new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry,28),
      new THREE.LineBasicMaterial({color:0x74bcae,transparent:true,opacity:.72})
    );
    edge.position.copy(mesh.position);edge.rotation.copy(mesh.rotation);

    const data=boothData(frame.sourceId);
    const labelWidth=Math.max(1.2,Math.min(frame.width*.9,frame.depth*1.7,14));
    const labelPosition=frame.position.clone();
    labelPosition.y=height+.72;
    const cos=Math.abs(Math.cos(frame.rotation)),sin=Math.abs(Math.sin(frame.rotation));
    const boundWidth=frame.width*cos+frame.depth*sin;
    const boundDepth=frame.width*sin+frame.depth*cos;
    const routeBounds={
      minX:frame.position.x-boundWidth/2,
      maxX:frame.position.x+boundWidth/2,
      minZ:frame.position.z-boundDepth/2,
      maxZ:frame.position.z+boundDepth/2
    };
    return{mesh,edge,labelPosition,labelRotation:frame.rotation,labelWidth,routeBounds,data};
  }

  function facilityObject(svg,node,frame,type){
    if(type.key==="female"||type.key==="male"||type.key==="accessible")return flatFacility(svg,node,frame,type.color);
    if(type.key==="elevator")return elevatorSolid(frame,type.color);
    if(type.key==="stairs")return stairsSolid(frame,type.color);
    if(type.key==="escalator")return escalatorSolid(frame,type.color);
    return blockFootprint(frame,type.color,.5);
  }

  function facilityIcon(key){
    const icons={
      male:'<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><path d="M8.5 21v-7h-2l2-6h7l2 6h-2v7M12 8v13"/></svg>',
      female:'<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><path d="M9.5 8h5l2.5 8h-3v5M10 21v-5H7l2.5-8"/></svg>',
      accessible:'<svg viewBox="0 0 24 24"><circle cx="10" cy="4.5" r="1.8"/><path d="M10 7v5h5l3 5M10 9H7M8 12a5 5 0 1 0 6 6M12 12l-2 6h5"/></svg>',
      elevator:'<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="1"/><path d="m9 8 3-3 3 3M15 16l-3 3-3-3M12 5v14"/></svg>',
      stairs:'<svg viewBox="0 0 24 24"><path d="M3 19h5v-4h4v-4h4V7h5"/></svg>',
      escalator:'<svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="1.7"/><path d="M4 20h4l8-10h4M7 8v5h4M20 10v4h-3"/></svg>',
      service:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>'
    };
    return icons[key]||icons.elevator;
  }

  function initThree(svg,floorNode,walls,entrances,facilityTypes,booths,services){
    const canvas=document.querySelector("#threeCanvas"),holder=canvas.parentElement;
    if(!window.THREE){
      document.querySelector("#threeLoading").textContent="3D组件加载失败，请联网刷新";
      return;
    }
    if(!floorNode)throw new Error("没有识别到楼板路径");
    const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.15;
    const scene=new THREE.Scene();
    scene.background=new THREE.Color(PALETTE.background);
    const modelSize=Math.max(VIEW.w,VIEW.h)*SCALE;
    scene.fog=new THREE.Fog(PALETTE.background,modelSize*1.1,modelSize*2.2);
    const camera=new THREE.PerspectiveCamera(42,1,.1,modelSize*5);
    scene.add(new THREE.HemisphereLight(0xcfe8f2,0x111b21,2.35));
    const sun=new THREE.DirectionalLight(0xfff8e8,2.55);sun.position.set(-70,120,80);scene.add(sun);
    const rim=new THREE.DirectionalLight(0x45c8bc,.85);rim.position.set(90,35,-80);scene.add(rim);
    const grid=new THREE.GridHelper(modelSize*1.55,24,0x315763,0x19323b);grid.position.y=-1.25;scene.add(grid);

    const floorData=parsePath(floorNode.getAttribute("d")||"");
    const floorPath=floorData.subpaths.sort((a,b)=>b.length-a.length)[0];
    if(!floorPath||floorPath.length<3)throw new Error("楼板路径无法生成封闭区域");
    const floorWorldPoints=floorPath.map(world);
    const floorBounds={
      minX:Math.min(...floorWorldPoints.map(point=>point.x)),
      maxX:Math.max(...floorWorldPoints.map(point=>point.x)),
      minZ:Math.min(...floorWorldPoints.map(point=>point.z)),
      maxZ:Math.max(...floorWorldPoints.map(point=>point.z))
    };
    const floorShape=new THREE.Shape();
    floorPath.forEach((point,index)=>{
      const value=world(point);
      if(index===0)floorShape.moveTo(value.x,value.z);else floorShape.lineTo(value.x,value.z);
    });
    floorShape.closePath();
    const floorGeometry=new THREE.ExtrudeGeometry(floorShape,{
      depth:1.2,bevelEnabled:true,bevelSize:.28,bevelThickness:.2,bevelSegments:2
    });
    floorGeometry.rotateX(Math.PI/2);
    scene.add(new THREE.Mesh(
      floorGeometry,
      new THREE.MeshStandardMaterial({color:PALETTE.floor,metalness:.04,roughness:.82})
    ));

    walls.forEach(node=>{
      parsePath(node.getAttribute("d")||"").segments.forEach(([a,b])=>{
        const mesh=segment(a,b,Math.max(.2,Number(node.getAttribute("stroke-width")||4)*SCALE),WALL_HEIGHT,PALETTE.wall,0,.96);
        if(mesh)scene.add(mesh);
      });
    });

    const labels=[],facilityMarkers=[],entrancePoints=new Map(),labelLayer=document.querySelector("#labelLayer");
    const boothLayer=new THREE.Group();boothLayer.name="booth-layer";scene.add(boothLayer);
    labelLayer.innerHTML="";
    facilityTypes.forEach(type=>type.nodes.forEach(node=>{
      const frame=footprintFrame(svg,node);
      if(!frame)return;
      const object=facilityObject(svg,node,frame,type);
      scene.add(object);
      const position=frame.position.clone();
      position.y=type.key==="elevator"?3.65:(type.key==="stairs"||type.key==="escalator"?1.55:.48);
      const element=document.createElement("span");
      element.className="facility-marker facility-"+type.key;
      element.innerHTML=facilityIcon(type.key);
      element.title=type.label+" · "+frame.sourceId;
      element.dataset.sourceId=frame.sourceId;
      element.style.setProperty("--marker-color",type.css);
      labelLayer.appendChild(element);
      facilityMarkers.push({position,element,priority:type.priority});
    }));
    facilityMarkers.sort((a,b)=>b.priority-a.priority);
    const boothItems=[];
    const addBoothNode=(node,dataOverride=null)=>{
      const frame=footprintFrame(svg,node);
      if(!frame)return null;
      const item=boothObject(svg,node,frame);
      if(dataOverride)item.data=dataOverride;
      const element=document.createElement("span");
      element.className="booth-map-label";
      const company=document.createElement("strong");
      const number=document.createElement("small");
      company.textContent=item.data.company;
      number.textContent=item.data.number;
      element.append(company,number);
      element.title=item.data.number+" · "+item.data.company;
      labelLayer.appendChild(element);
      item.labelElement=element;
      boothLayer.add(item.mesh,item.edge);
      boothItems.push(item);
      return item;
    };
    booths.forEach(node=>addBoothNode(node));
    services.forEach(node=>{
      const frame=footprintFrame(svg,node);
      if(frame)scene.add(blockFootprint(frame,PALETTE.service,.9,.04));
    });

    entrances.forEach(node=>{
      const a=[Number(node.getAttribute("x1")),Number(node.getAttribute("y1"))];
      const b=[Number(node.getAttribute("x2")),Number(node.getAttribute("y2"))];
      const door=doubleGlassDoor(a,b,node.id.trim());
      if(door)scene.add(door);
      const position=world([(a[0]+b[0])/2,(a[1]+b[1])/2]);position.y=WALL_HEIGHT+1;
      const number=doorNumber(node.id),element=document.createElement("span");
      if(number)entrancePoints.set(number,position.clone().setY(.2));
      element.className="door-label";
      element.textContent=number?("出入口 "+String(number).padStart(2,"0")):"出入口";
      element.title=node.id.trim();element.dataset.sourceId=node.id.trim();labelLayer.appendChild(element);
      labels.push({position,element,featured:[4,7,16,19].includes(number)});
    });

    const homeTarget=new THREE.Vector3(
      (floorBounds.minX+floorBounds.maxX)/2,
      2.4,
      (floorBounds.minZ+floorBounds.maxZ)/2
    );
    const target=homeTarget.clone();
    const routeGroup=new THREE.Group();
    routeGroup.visible=false;
    scene.add(routeGroup);
    let routePulse=null,routeAnimation=null;
    const pointInsideFloor=point=>{
      let inside=false;
      for(let i=0,j=floorWorldPoints.length-1;i<floorWorldPoints.length;j=i++){
        const a=floorWorldPoints[i],b=floorWorldPoints[j];
        const crossed=((a.z>point.z)!==(b.z>point.z))&&
          point.x<(b.x-a.x)*(point.z-a.z)/((b.z-a.z)||1e-9)+a.x;
        if(crossed)inside=!inside;
      }
      return inside;
    };
    const planRoute=(start,targetPoint)=>{
      const step=2.4,padding=1.05;
      const cols=Math.ceil((floorBounds.maxX-floorBounds.minX)/step)+1;
      const rows=Math.ceil((floorBounds.maxZ-floorBounds.minZ)/step)+1;
      const count=cols*rows;
      const cellPoint=index=>{
        const col=index%cols,row=Math.floor(index/cols);
        return new THREE.Vector3(floorBounds.minX+col*step,.2,floorBounds.minZ+row*step);
      };
      const pointCell=point=>{
        const col=Math.max(0,Math.min(cols-1,Math.round((point.x-floorBounds.minX)/step)));
        const row=Math.max(0,Math.min(rows-1,Math.round((point.z-floorBounds.minZ)/step)));
        return row*cols+col;
      };
      const walkable=new Int8Array(count);walkable.fill(-1);
      const canWalk=index=>{
        if(walkable[index]>=0)return Boolean(walkable[index]);
        const point=cellPoint(index);
        const blocked=!pointInsideFloor(point)||boothItems.some(item=>{
          const bounds=item.routeBounds;
          return point.x>bounds.minX-padding&&point.x<bounds.maxX+padding&&
            point.z>bounds.minZ-padding&&point.z<bounds.maxZ+padding;
        });
        walkable[index]=blocked?0:1;
        return !blocked;
      };
      const nearestWalkable=point=>{
        const origin=pointCell(point),originCol=origin%cols,originRow=Math.floor(origin/cols);
        if(canWalk(origin))return origin;
        for(let radius=1;radius<Math.max(cols,rows);radius++){
          let best=-1,bestDistance=Infinity;
          for(let row=originRow-radius;row<=originRow+radius;row++){
            for(let col=originCol-radius;col<=originCol+radius;col++){
              if(col<0||row<0||col>=cols||row>=rows||
                (Math.abs(col-originCol)!==radius&&Math.abs(row-originRow)!==radius))continue;
              const index=row*cols+col;
              if(!canWalk(index))continue;
              const candidate=cellPoint(index),distance=candidate.distanceToSquared(point);
              if(distance<bestDistance){best=index;bestDistance=distance}
            }
          }
          if(best>=0)return best;
        }
        return -1;
      };
      const startIndex=nearestWalkable(start),goalIndex=nearestWalkable(targetPoint);
      if(startIndex<0||goalIndex<0)return[start.clone().setY(.2),targetPoint.clone().setY(.2)];
      const gScore=new Float64Array(count);gScore.fill(Infinity);gScore[startIndex]=0;
      const previous=new Int32Array(count);previous.fill(-1);
      const closed=new Uint8Array(count),open=[startIndex];
      const goal=cellPoint(goalIndex);
      const directions=[[-1,0,1],[1,0,1],[0,-1,1],[0,1,1],[-1,-1,Math.SQRT2],[1,-1,Math.SQRT2],[-1,1,Math.SQRT2],[1,1,Math.SQRT2]];
      while(open.length){
        let bestAt=0,bestScore=Infinity;
        for(let i=0;i<open.length;i++){
          const point=cellPoint(open[i]);
          const score=gScore[open[i]]+Math.hypot(point.x-goal.x,point.z-goal.z);
          if(score<bestScore){bestScore=score;bestAt=i}
        }
        const current=open.splice(bestAt,1)[0];
        if(current===goalIndex)break;
        if(closed[current])continue;
        closed[current]=1;
        const col=current%cols,row=Math.floor(current/cols);
        directions.forEach(([dx,dz,cost])=>{
          const nextCol=col+dx,nextRow=row+dz;
          if(nextCol<0||nextRow<0||nextCol>=cols||nextRow>=rows)return;
          const next=nextRow*cols+nextCol;
          if(closed[next]||!canWalk(next))return;
          if(dx&&dz&&(!canWalk(row*cols+nextCol)||!canWalk(nextRow*cols+col)))return;
          const score=gScore[current]+cost*step;
          if(score>=gScore[next])return;
          gScore[next]=score;previous[next]=current;open.push(next);
        });
      }
      if(goalIndex!==startIndex&&previous[goalIndex]<0)return[start.clone().setY(.2),cellPoint(goalIndex)];
      const cells=[];
      for(let cursor=goalIndex;cursor>=0;cursor=previous[cursor]){
        cells.push(cursor);
        if(cursor===startIndex)break;
      }
      cells.reverse();
      const points=cells.map(cellPoint),simplified=[];
      points.forEach((point,index)=>{
        if(index===0||index===points.length-1){simplified.push(point);return}
        const before=points[index-1],after=points[index+1];
        const d1=[Math.sign(point.x-before.x),Math.sign(point.z-before.z)];
        const d2=[Math.sign(after.x-point.x),Math.sign(after.z-point.z)];
        if(d1[0]!==d2[0]||d1[1]!==d2[1])simplified.push(point);
      });
      const exactStart=start.clone().setY(.2);
      if(exactStart.distanceToSquared(simplified[0])>.15)simplified.unshift(exactStart);
      return simplified;
    };
    const clearRouteVisual=()=>{
      routeGroup.traverse(object=>{
        object.geometry?.dispose();
        if(Array.isArray(object.material))object.material.forEach(material=>material.dispose());
        else object.material?.dispose();
      });
      routeGroup.clear();routeGroup.visible=false;routePulse=null;routeAnimation=null;
    };
    const buildRouteVisual=points=>{
      clearRouteVisual();
      const material=new THREE.MeshStandardMaterial({color:0x5ff1d2,emissive:0x1ca98e,emissiveIntensity:1.15,roughness:.38,metalness:.08});
      const lengths=[],total=points.slice(1).reduce((sum,point,index)=>{
        const length=point.distanceTo(points[index]);lengths.push(length);return sum+length;
      },0);
      points.slice(1).forEach((point,index)=>{
        const from=points[index],direction=point.clone().sub(from),length=direction.length();
        if(length<=.01)return;
        const segmentMesh=new THREE.Mesh(new THREE.CylinderGeometry(.31,.31,length,12),material);
        segmentMesh.position.copy(from).add(point).multiplyScalar(.5).setY(.24);
        segmentMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
        routeGroup.add(segmentMesh);
        const joint=new THREE.Mesh(new THREE.SphereGeometry(.32,12,8),material);
        joint.position.copy(point).setY(.24);routeGroup.add(joint);
      });
      const startMarker=new THREE.Mesh(new THREE.CylinderGeometry(.78,.78,.12,24),new THREE.MeshStandardMaterial({color:0x5ff1d2,emissive:0x147d6b,emissiveIntensity:.8}));
      startMarker.position.copy(points[0]).setY(.16);routeGroup.add(startMarker);
      const endMarker=new THREE.Mesh(new THREE.TorusGeometry(.92,.14,10,28),new THREE.MeshStandardMaterial({color:0xffd166,emissive:0x9f6710,emissiveIntensity:1}));
      endMarker.position.copy(points[points.length-1]).setY(.25);endMarker.rotation.x=Math.PI/2;routeGroup.add(endMarker);
      routePulse=new THREE.Mesh(new THREE.SphereGeometry(.48,16,10),new THREE.MeshBasicMaterial({color:0xffffff}));
      routePulse.position.copy(points[0]).setY(.72);routeGroup.add(routePulse);
      routeAnimation={points,lengths,total};routeGroup.visible=true;
      return total;
    };
    const stage=document.querySelector("#threeStage");
    const modeButtons=[...stage.querySelectorAll("[data-camera-mode]")];
    const popup=document.querySelector("#boothPopup");
    const popupCompany=document.querySelector("#boothPopupCompany");
    const popupNumber=document.querySelector("#boothPopupNumber");
    const popupCategory=document.querySelector("#boothPopupCategory");
    const popupContact=document.querySelector("#boothPopupContact");
    const popupDescription=document.querySelector("#boothPopupDescription");
    const routeButton=document.querySelector("#routeToBooth");
    const navigationPanel=document.querySelector("#navigationPanel");
    const navigationDestination=document.querySelector("#navigationDestination");
    const navigationDistance=document.querySelector("#navigationDistance");
    const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
    const labelLeft=new THREE.Vector3(),labelRight=new THREE.Vector3(),labelCenter=new THREE.Vector3();
    let selectedBooth=null,closeTimer=null,navigationActive=false;
    const cancelClose=()=>{
      if(closeTimer){clearTimeout(closeTimer);closeTimer=null}
    };
    const setBoothHighlight=(item,active)=>{
      item.mesh.material.color.setHex(active?0x55d9bf:PALETTE.booth);
      item.mesh.material.emissive.setHex(active?0x0c6f63:0x082a2d);
      item.mesh.material.emissiveIntensity=active?.78:.18;
      item.edge.material.color.setHex(active?0xa9fff0:0x74bcae);
      item.edge.material.opacity=active?1:.72;
      item.labelElement.classList.toggle("selected",active);
    };
    const stopNavigation=(clearSelection=true)=>{
      navigationActive=false;
      clearRouteVisual();
      navigationPanel.hidden=true;
      if(clearSelection&&selectedBooth){
        setBoothHighlight(selectedBooth,false);
        selectedBooth=null;
      }
      popup.hidden=true;
    };
    const closeBoothPopup=()=>{
      cancelClose();
      if(navigationActive){popup.hidden=true;return}
      if(selectedBooth)setBoothHighlight(selectedBooth,false);
      selectedBooth=null;
      popup.hidden=true;
    };
    const scheduleClose=()=>{
      if(navigationActive||!selectedBooth||closeTimer)return;
      closeTimer=setTimeout(closeBoothPopup,3000);
    };
    const selectBooth=item=>{
      cancelClose();
      if(navigationActive)stopNavigation(false);
      if(selectedBooth&&selectedBooth!==item)setBoothHighlight(selectedBooth,false);
      selectedBooth=item;
      setBoothHighlight(item,true);
      popupCompany.textContent=item.data.company;
      popupNumber.textContent=item.data.number;
      popupCategory.textContent=item.data.category;
      popupContact.textContent=item.data.contact;
      popupDescription.textContent=item.data.description;
      popup.hidden=false;
    };
    const startNavigation=()=>{
      if(!selectedBooth)return;
      cancelClose();
      const start=(entrancePoints.get(1)||entrancePoints.values().next().value);
      if(!start)return;
      const points=planRoute(start,selectedBooth.labelPosition);
      const distance=buildRouteVisual(points);
      navigationActive=true;
      navigationDestination.textContent="前往 "+selectedBooth.data.number+" · "+selectedBooth.data.company;
      navigationDistance.textContent="约 "+Math.max(1,Math.round(distance))+" 米 · 步行约 "+Math.max(1,Math.ceil(distance/75))+" 分钟";
      navigationPanel.hidden=false;
      popup.hidden=true;
      const xs=points.map(point=>point.x),zs=points.map(point=>point.z);
      target.set((Math.min(...xs)+Math.max(...xs))/2,2.4,(Math.min(...zs)+Math.max(...zs))/2);
      const span=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs));
      dist=Math.max(minDistance,Math.min(maxDistance,Math.max(modelSize*.3,span*1.18)));
      polar=.82;
    };
    applyImageBooths=records=>{
      stopNavigation(true);cancelClose();
      boothItems.forEach(item=>item.labelElement.remove());
      boothLayer.traverse(object=>{
        object.geometry?.dispose();
        if(Array.isArray(object.material))object.material.forEach(material=>material.dispose());
        else object.material?.dispose();
      });
      boothLayer.clear();boothItems.length=0;
      semanticLeaves(svg,/^BOOTH(?:_SPECIAL|_SERVICE)?__/).forEach(node=>node.style.display="none");
      svg.querySelector("#IMAGE_RECOGNIZED_LAYER")?.remove();
      const previewLayer=document.createElementNS("http://www.w3.org/2000/svg","g");
      previewLayer.id="IMAGE_RECOGNIZED_LAYER";svg.appendChild(previewLayer);
      let imported=0;
      records.forEach(record=>{
        const centerPoint=world([record.x+record.width/2,record.y+record.height/2]);
        if(!pointInsideFloor(centerPoint))return;
        const rect=document.createElementNS("http://www.w3.org/2000/svg","rect");
        rect.id=`IMAGE_BOOTH__F3__H7.2__${record.id}`;
        rect.setAttribute("x",record.x.toFixed(2));rect.setAttribute("y",record.y.toFixed(2));
        rect.setAttribute("width",record.width.toFixed(2));rect.setAttribute("height",record.height.toFixed(2));
        previewLayer.appendChild(rect);
        const data={
          number:record.id,
          company:"待匹配企业",
          category:"图片识别展位",
          contact:"等待展位号与Excel匹配",
          description:`从7.2展位图自动提取的${record.confidence==="high"?"高":"中"}置信度展位块。固定场馆、门和设施未被修改。`
        };
        if(addBoothNode(rect,data))imported++;
      });
      document.querySelector("#boothCount").textContent=imported;
      document.querySelector("#applyRecognizedBooths").textContent=`已生成 ${imported} 个展位`;
      document.querySelector("#recognitionMessage").textContent=`已将 ${imported} 个识别展位块生成到3D场馆；墙、门、厕所、电梯、楼梯和导航底图保持不变。`;
      resetCamera();
    };
    const pickBooth=event=>{
      const rect=canvas.getBoundingClientRect();
      pointer.x=((event.clientX-rect.left)/rect.width)*2-1;
      pointer.y=-((event.clientY-rect.top)/rect.height)*2+1;
      raycaster.setFromCamera(pointer,camera);
      const hit=raycaster.intersectObjects(boothItems.map(item=>item.mesh),false)[0];
      return hit?boothItems.find(item=>item.mesh===hit.object)||null:null;
    };
    document.querySelector("#boothPopupClose").addEventListener("click",closeBoothPopup);
    routeButton.addEventListener("click",startNavigation);
    document.querySelector("#exitNavigation").addEventListener("click",()=>stopNavigation(true));
    popup.addEventListener("mouseenter",cancelClose);
    popup.addEventListener("mouseleave",scheduleClose);
    let cameraMode="orbit";
    let az=-.62,polar=.9,dist=modelSize*.96,drag=false,panDrag=false,activePointer=null,last=[0,0],pinchState=null,pointerTravel=0;
    const pointers=new Map();
    const minDistance=modelSize*.22,maxDistance=modelSize*2.1;
    const doorDetailDistance=modelSize*.57;
    const fullIconDistance=modelSize*.52,iconDistance=modelSize*.78;
    const panMargin=Math.max(
      floorBounds.maxX-floorBounds.minX,
      floorBounds.maxZ-floorBounds.minZ
    )*.16;
    const clampTarget=()=>{
      target.x=Math.max(floorBounds.minX-panMargin,Math.min(floorBounds.maxX+panMargin,target.x));
      target.z=Math.max(floorBounds.minZ-panMargin,Math.min(floorBounds.maxZ+panMargin,target.z));
    };
    const panScreen=(dx,dy)=>{
      const pixels=Math.max(holder.clientHeight,1);
      const worldPerPixel=2*dist*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/pixels;
      const forward=new THREE.Vector3(-Math.sin(az),0,-Math.cos(az)).normalize();
      const right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();
      target.addScaledVector(right,-dx*worldPerPixel);
      target.addScaledVector(forward,dy*worldPerPixel);
      clampTarget();
    };
    const setCameraMode=mode=>{
      cameraMode=mode;
      stage.dataset.cameraMode=mode;
      modeButtons.forEach(button=>{
        const selected=button.dataset.cameraMode===mode;
        button.classList.toggle("active",selected);
        button.setAttribute("aria-pressed",String(selected));
      });
    };
    const resetCamera=()=>{
      az=-.62;polar=.9;dist=modelSize*.96;target.copy(homeTarget);
    };
    if(lastRecognizedBooths.length)applyImageBooths(lastRecognizedBooths);
    modeButtons.forEach(button=>button.addEventListener("click",()=>setCameraMode(button.dataset.cameraMode)));
    document.querySelector("#resetView").addEventListener("click",resetCamera);
    canvas.addEventListener("pointerdown",event=>{
      if(event.button>2)return;
      event.preventDefault();
      canvas.focus({preventScroll:true});
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      stage.classList.add("is-dragging");
      canvas.setPointerCapture(event.pointerId);
      if(pointers.size===1){
        drag=true;activePointer=event.pointerId;
        panDrag=cameraMode==="pan"||event.shiftKey||event.button===1||event.button===2;
        last=[event.clientX,event.clientY];pointerTravel=0;
      }else if(pointers.size===2){
        const [first,second]=[...pointers.values()];
        pinchState={
          x:(first.x+second.x)/2,
          y:(first.y+second.y)/2,
          distance:Math.max(1,Math.hypot(second.x-first.x,second.y-first.y))
        };
        drag=false;activePointer=null;pointerTravel=999;
      }
    });
    canvas.addEventListener("pointermove",event=>{
      if(!pointers.has(event.pointerId))return;
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(pointers.size>=2){
        const [first,second]=[...pointers.values()];
        const next={
          x:(first.x+second.x)/2,
          y:(first.y+second.y)/2,
          distance:Math.max(1,Math.hypot(second.x-first.x,second.y-first.y))
        };
        if(pinchState){
          panScreen(next.x-pinchState.x,next.y-pinchState.y);
          dist=Math.max(minDistance,Math.min(maxDistance,dist*pinchState.distance/next.distance));
        }
        pinchState=next;pointerTravel=999;
        return;
      }
      if(!drag||event.pointerId!==activePointer)return;
      const dx=event.clientX-last[0],dy=event.clientY-last[1];
      pointerTravel+=Math.hypot(dx,dy);
      if(panDrag)panScreen(dx,dy);
      else{
        az-=dx*.007;
        polar=Math.max(.25,Math.min(1.4,polar+dy*.006));
      }
      last=[event.clientX,event.clientY];
    });
    const endDrag=event=>{
      pointers.delete(event.pointerId);
      pinchState=null;
      if(pointers.size>=2){
        const [first,second]=[...pointers.values()];
        pinchState={
          x:(first.x+second.x)/2,
          y:(first.y+second.y)/2,
          distance:Math.max(1,Math.hypot(second.x-first.x,second.y-first.y))
        };
        drag=false;activePointer=null;
      }else if(pointers.size===1){
        const [pointerId,point]=[...pointers.entries()][0];
        drag=true;panDrag=cameraMode==="pan";activePointer=pointerId;last=[point.x,point.y];
      }else{
        drag=false;panDrag=false;activePointer=null;stage.classList.remove("is-dragging");
      }
    };
    canvas.addEventListener("pointerup",endDrag);
    canvas.addEventListener("pointercancel",endDrag);
    canvas.addEventListener("contextmenu",event=>event.preventDefault());
    canvas.addEventListener("dblclick",resetCamera);
    canvas.addEventListener("click",event=>{
      if(pointerTravel>6)return;
      const item=pickBooth(event);
      if(item)selectBooth(item);else closeBoothPopup();
    });
    canvas.addEventListener("mousemove",event=>{
      if(drag)return;
      const item=pickBooth(event);
      stage.classList.toggle("is-booth-hover",Boolean(item));
      if(selectedBooth){
        if(item===selectedBooth)cancelClose();else scheduleClose();
      }
    });
    canvas.addEventListener("mouseleave",()=>{
      stage.classList.remove("is-booth-hover");
      scheduleClose();
    });
    canvas.addEventListener("wheel",event=>{
      event.preventDefault();
      dist=Math.max(minDistance,Math.min(maxDistance,dist*Math.exp(event.deltaY*.0012)));
    },{passive:false});
    canvas.addEventListener("keydown",event=>{
      const step=32;
      if(event.key==="Escape"){if(navigationActive)stopNavigation(true);else closeBoothPopup()}
      else if(event.key==="ArrowLeft")panScreen(-step,0);
      else if(event.key==="ArrowRight")panScreen(step,0);
      else if(event.key==="ArrowUp")panScreen(0,-step);
      else if(event.key==="ArrowDown")panScreen(0,step);
      else if(event.key==="0")resetCamera();
      else return;
      event.preventDefault();
    });
    document.addEventListener("keydown",event=>{
      if(event.key==="Escape"){if(navigationActive)stopNavigation(true);else closeBoothPopup()}
    });

    function resize(){
      const rect=holder.getBoundingClientRect();
      renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();
    }
    function tick(){
      requestAnimationFrame(tick);
      const sin=Math.sin(polar);
      camera.position.set(
        target.x+Math.sin(az)*sin*dist,
        target.y+Math.cos(polar)*dist,
        target.z+Math.cos(az)*sin*dist
      );
      if(routePulse&&routeAnimation?.total>0){
        let travel=(performance.now()*.018)%routeAnimation.total,segmentIndex=0;
        while(segmentIndex<routeAnimation.lengths.length-1&&travel>routeAnimation.lengths[segmentIndex]){
          travel-=routeAnimation.lengths[segmentIndex++];
        }
        const from=routeAnimation.points[segmentIndex],to=routeAnimation.points[segmentIndex+1];
        const ratio=Math.min(1,travel/(routeAnimation.lengths[segmentIndex]||1));
        routePulse.position.lerpVectors(from,to,ratio).setY(.72);
      }
      camera.lookAt(target);renderer.render(scene,camera);
      const rect=holder.getBoundingClientRect();
      const showAllDoors=dist<=doorDetailDistance;
      const showFullIcons=dist<=fullIconDistance,showKeyIcons=dist<=iconDistance;
      boothItems.forEach(item=>{
        const selected=item===selectedBooth;
        const halfWidth=item.labelWidth/2;
        const cos=Math.cos(item.labelRotation),sin=Math.sin(item.labelRotation);
        labelLeft.set(
          item.labelPosition.x-halfWidth*cos,
          item.labelPosition.y,
          item.labelPosition.z+halfWidth*sin
        ).project(camera);
        labelRight.set(
          item.labelPosition.x+halfWidth*cos,
          item.labelPosition.y,
          item.labelPosition.z-halfWidth*sin
        ).project(camera);
        labelCenter.copy(item.labelPosition).project(camera);
        const pixelWidth=Math.hypot(
          (labelRight.x-labelLeft.x)*rect.width/2,
          (labelRight.y-labelLeft.y)*rect.height/2
        );
        const x=(labelCenter.x*.5+.5)*rect.width;
        const y=(-labelCenter.y*.5+.5)*rect.height;
        const inView=labelCenter.z>-1&&labelCenter.z<1&&x>-70&&x<rect.width+70&&y>-45&&y<rect.height+45;
        const zoomRatio=dist/modelSize;
        const labelThreshold=zoomRatio>.72?64:zoomRatio>.5?48:zoomRatio>.34?34:22;
        const readable=selected||pixelWidth>=labelThreshold;
        item.labelElement.style.display=inView&&readable?"block":"none";
        if(inView&&readable){
          const availableWidth=Math.max(1,Math.min(96,pixelWidth*.86));
          const companyLength=Math.max(1,Array.from(item.data.company).length);
          const companySize=Math.max(7,Math.min(11,availableWidth/(companyLength+.45)));
          const numberSize=Math.max(7,Math.min(9,availableWidth/(item.data.number.length+.6)));
          item.labelElement.style.left=x+"px";
          item.labelElement.style.top=y+"px";
          item.labelElement.style.width=availableWidth+"px";
          item.labelElement.style.setProperty("--booth-company-size",companySize+"px");
          item.labelElement.style.setProperty("--booth-number-size",numberSize+"px");
        }
      });
      const occupied=[];
      const markerSize=20,markerPadding=showFullIcons?3:6;
      const offsets=showFullIcons
        ? [[0,0],[24,0],[-24,0],[0,24],[0,-24],[18,18],[-18,18],[18,-18],[-18,-18]]
        : [[0,0],[28,0],[-28,0],[0,28],[0,-28]];
      const overlaps=(x,y,width,height,padding=0)=>occupied.some(item=>
        Math.abs(item.x-x)<(item.width+width)/2+padding&&
        Math.abs(item.y-y)<(item.height+height)/2+padding
      );
      facilityMarkers.forEach(item=>{
        const projected=item.position.clone().project(camera);
        const anchorX=(projected.x*.5+.5)*rect.width,anchorY=(-projected.y*.5+.5)*rect.height;
        const allowed=showKeyIcons&&(showFullIcons||item.priority>=80);
        let placement=null;
        if(allowed&&projected.z>-1&&projected.z<1){
          placement=offsets.map(([dx,dy])=>({x:anchorX+dx,y:anchorY+dy})).find(point=>
            point.x>markerSize&&point.x<rect.width-markerSize&&
            point.y>markerSize&&point.y<rect.height-markerSize&&
            !overlaps(point.x,point.y,markerSize,markerSize,markerPadding)
          )||null;
        }
        item.element.style.display=placement?"grid":"none";
        if(placement){
          item.element.style.left=placement.x+"px";
          item.element.style.top=placement.y+"px";
          occupied.push({x:placement.x,y:placement.y,width:markerSize,height:markerSize});
        }
      });
      labels.forEach(item=>{
        const projected=item.position.clone().project(camera);
        const left=(projected.x*.5+.5)*rect.width,top=(-projected.y*.5+.5)*rect.height;
        const inView=projected.z>-1&&projected.z<1&&left>30&&left<rect.width-30&&top>24&&top<rect.height-12;
        const labelWidth=54,labelHeight=20,labelCenterY=top-labelHeight/2-4;
        const visible=inView&&(showAllDoors||item.featured)&&!overlaps(left,labelCenterY,labelWidth,labelHeight,4);
        item.element.style.display=visible?"block":"none";
        if(visible){
          item.element.style.left=left+"px";
          item.element.style.top=top+"px";
          occupied.push({x:left,y:labelCenterY,width:labelWidth,height:labelHeight});
        }
      });
    }
    addEventListener("resize",resize);resize();
    document.querySelector("#threeLoading").classList.add("hidden");tick();
  }

  setupImageRecognition();
  load().catch(error=>{
    console.error(error);
    document.querySelector("#svgStage").innerHTML='<div class="loading">'+error.message+"</div>";
    document.querySelector("#threeLoading").textContent="无法生成3D";
  });
})();
