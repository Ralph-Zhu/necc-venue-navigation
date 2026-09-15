/* SVG is parsed as data. Only allowlisted geometry is mounted for measurement. */
(()=>{'use strict';
const NS='http://www.w3.org/2000/svg',G=window.EditorGeometry;
const geometryTags=new Set(['path','rect','circle','ellipse','polygon','polyline','line']);
const attrs=['id','transform','d','x','y','width','height','rx','ry','cx','cy','r','points','x1','y1','x2','y2'];
const hallName=id=>/^(?:H)?NH$/i.test(id)?'NH':id.match(/(?:^|__)H(?:ALL_)?([1-8])[._]([12])(?:__|$)/i)?.slice(1).join('.')||(/^[1-8]\.[12]$/.test(id)?id:null);
function boothCode(id){if(/^[A-Z]\d{3,6}$/i.test(id))return id;const m=id.match(/^BOOTH(?:_SPECIAL|_SERVICE)?__F[123]__(?:(?:H[1-8][._][12]|H?NH)__)?([A-Za-z0-9_-]{1,24})$/i);return m?.[1]||null}
function mount(text){
 if(text.length>12*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('SVG过大或包含不支持的实体声明');
 const doc=new DOMParser().parseFromString(text,'image/svg+xml');
 if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg')throw Error('不是有效的SVG文件');
 if(doc.querySelectorAll('*').length>50000)throw Error('图层太多，请只导出单馆展位');
 const root=document.createElementNS(NS,'svg'),vb=(doc.documentElement.getAttribute('viewBox')||'').trim().split(/[ ,]+/).map(Number);
 if(vb.length!==4||!vb.every(Number.isFinite)||vb[2]<=0||vb[3]<=0)throw Error('SVG需要有效viewBox，请从Figma重新导出');
 root.setAttribute('viewBox',vb.join(' '));root.setAttribute('width',vb[2]);root.setAttribute('height',vb[3]);
 function clone(n,parent,depth=0,blocked=false){
  if(depth>40)throw Error('SVG分组嵌套过深');
  if(n.nodeType!==1)return;
  const tag=n.localName;if(tag!=='g'&&!geometryTags.has(tag))return;
  if(n.getAttribute('display')==='none'||/display\s*:\s*none|visibility\s*:\s*hidden/i.test(n.getAttribute('style')||'')||n.getAttribute('visibility')==='hidden')return;
  const el=document.createElementNS(NS,tag);
  for(const key of attrs)if(n.hasAttribute(key))el.setAttribute(key,n.getAttribute(key));
  blocked=blocked||n.hasAttribute('clip-path')||n.hasAttribute('mask')||/clip-path|mask\s*:|transform\s*:/i.test(n.getAttribute('style')||'');
  if(blocked)el.dataset.unsupported='1';parent.append(el);for(const c of n.children)clone(c,el,depth+1,blocked);
 }
 for(const n of doc.documentElement.children)clone(n,root);
 const host=document.createElement('div');host.style.cssText='position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:strict;width:1px;height:1px;overflow:hidden';host.append(root);document.body.append(host);
 const matrix=el=>root.getCTM().inverse().multiply(el.getCTM());
 const point=(el,x,y)=>{const p=new DOMPoint(x,y).matrixTransform(matrix(el));if(!Number.isFinite(p.x)||!Number.isFinite(p.y))throw Error('坐标无效');return{x:p.x,z:p.y}};
 return{root,vb,point,dispose:()=>host.remove()};
}
function context(el){let hall=null;for(let p=el;p;p=p.parentElement){const name=hallName((p.id||'').trim());if(name)hall=name}return hall}
function floorOutline(svg,hall){const nodes=[...svg.root.querySelectorAll('path,polygon,rect')].filter(n=>/^FLOOR(?:_SHAPE)?__/i.test(n.id));const named=nodes.filter(n=>context(n)===hall),el=named.length===1?named[0]:nodes.length===1?nodes[0]:null;return el?simplify(outline(svg,el),.05):null}
function fitOutline(a,b){
 if(!a||!b||a.length!==b.length||a.length<3)return null;
 const mean=p=>({x:p.reduce((s,q)=>s+q.x,0)/p.length,z:p.reduce((s,q)=>s+q.z,0)/p.length}),s=mean(a),t=mean(b),fits=[];
 for(const direction of [1,-1])for(let shift=0;shift<b.length;shift++){
  const ordered=a.map((_,i)=>b[(shift+direction*i+b.length)%b.length]);let dot=0,cross=0;
  a.forEach((p,i)=>{const q=ordered[i],x=p.x-s.x,z=p.z-s.z;dot+=x*(q.x-t.x)+z*(q.z-t.z);cross+=x*(q.z-t.z)-z*(q.x-t.x)});
  const angle=Math.atan2(cross,dot),c=Math.cos(angle),d=Math.sin(angle),project=p=>({x:t.x+c*(p.x-s.x)-d*(p.z-s.z),z:t.z+d*(p.x-s.x)+c*(p.z-s.z)});
  const error=Math.max(...a.map((p,i)=>{const q=project(p);return Math.hypot(q.x-ordered[i].x,q.z-ordered[i].z)/10}));fits.push({project,error,angle:angle*180/Math.PI});
 }
 fits.sort((a,b)=>a.error-b.error);if(fits[0].error>.05)return null;
 if(fits.slice(1).some(f=>f.error<=.05&&Math.abs(Math.sin((f.angle-fits[0].angle)*Math.PI/360))>.01))return null;
 return fits[0];
}
function masterRegistration(source,master,target,hall){
 const uploaded=floorOutline(source,hall.id),original=floorOutline(master,hall.id),destination=floorOutline(target,hall.id);
 const first=fitOutline(uploaded,original),second=fitOutline(original,destination);
 if(!first||!second)return{failed:true,reason:'母版轮廓缺失、不一致或方向不唯一；请保留原始馆内地板，不只导出展位。'};
 return{method:'master',error:first.error+second.error,angle:first.angle+second.angle,project:p=>{const q=second.project(first.project(p));return{x:hall.bounds.x+(q.x-target.vb[0])/10,z:hall.bounds.z+(q.z-target.vb[1])/10}}};
}
function doorPoints(svg,hall){const result=new Map(),duplicate=new Set();for(const el of svg.root.querySelectorAll('line')){const m=el.id.match(/^DOORS?__.*__(?:D)?(\d+)(?:__[A-Z_]+)?$/i);if(!m||context(el)&&context(el)!==hall)continue;const code=String(Number(m[1]));if(result.has(code)){duplicate.add(code);continue}const n=k=>Number(el.getAttribute(k)||0);result.set(code,svg.point(el,(n('x1')+n('x2'))/2,(n('y1')+n('y2'))/2))}for(const k of duplicate)result.delete(k);return result}
function registration(source,target,hall){
 const a=doorPoints(source,hall.id),b=doorPoints(target,hall.id),keys=[...a.keys()].filter(k=>b.has(k));
 if(keys.length<3)return null;
 const mean=map=>({x:keys.reduce((s,k)=>s+map.get(k).x,0)/keys.length,z:keys.reduce((s,k)=>s+map.get(k).z,0)/keys.length}),s=mean(a),t=mean(b);
 let dot=0,cross=0,spread=0;for(const k of keys){const p=a.get(k),q=b.get(k),x=p.x-s.x,z=p.z-s.z;dot+=x*(q.x-t.x)+z*(q.z-t.z);cross+=x*(q.z-t.z)-z*(q.x-t.x);spread+=x*x+z*z}
 if(spread<100)return null;const angle=Math.atan2(cross,dot),c=Math.cos(angle),d=Math.sin(angle);
 const project=p=>({x:t.x+c*(p.x-s.x)-d*(p.z-s.z),z:t.z+d*(p.x-s.x)+c*(p.z-s.z)});
 const error=Math.max(...keys.map(k=>{const p=project(a.get(k)),q=b.get(k);return Math.hypot(p.x-q.x,p.z-q.z)/10}));
 if(error>.15)return{failed:true,error};
 return{angle:angle*180/Math.PI,count:keys.length,error,project:p=>{const q=project(p);return{x:hall.bounds.x+(q.x-target.vb[0])/10,z:hall.bounds.z+(q.z-target.vb[1])/10}}};
}
function simplify(points,tolerance){ // Closed-ring RDP: preserve corners, bound curve error.
 const sq=tolerance*tolerance;
 function run(p){if(p.length<=2)return p;const a=p[0],b=p.at(-1),dx=b.x-a.x,dz=b.z-a.z,l=dx*dx+dz*dz;let max=sq,index=-1;for(let i=1;i<p.length-1;i++){const q=p[i],t=l?Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.z-a.z)*dz)/l)):0,d=(q.x-a.x-t*dx)**2+(q.z-a.z-t*dz)**2;if(d>max){max=d;index=i}}return index<0?[a,b]:[...run(p.slice(0,index+1)).slice(0,-1),...run(p.slice(index))]}
 const half=Math.floor(points.length/2);return [...run(points.slice(0,half+1)).slice(0,-1),...run([...points.slice(half),points[0]]).slice(0,-1)];
}
function outline(svg,el){
 if(el.dataset.unsupported)throw Error('包含蒙版、裁剪或CSS变换，请展平为轮廓');
 const tag=el.localName,n=k=>Number(el.getAttribute(k)||0);let pts=[];
 if(tag==='rect'&&!n('rx')&&!n('ry')){const x=n('x'),z=n('y'),w=n('width'),h=n('height');if(w<=0||h<=0)throw Error('矩形尺寸无效');pts=[[x,z],[x+w,z],[x+w,z+h],[x,z+h]].map(([x,z])=>({x,z}))}
 else if(tag==='polygon'){const nums=(el.getAttribute('points')||'').trim().split(/[ ,]+/).map(Number);if(nums.length%2)throw Error('多边形坐标不完整');for(let i=0;i<nums.length;i+=2)pts.push({x:nums[i],z:nums[i+1]})}
 else {
  if(!['path','circle','ellipse','rect'].includes(tag))throw Error('展位必须是封闭的面积图形');
  if(tag==='path'){const d=el.getAttribute('d')||'';if((d.match(/m/ig)||[]).length!==1||!/z\s*$/i.test(d))throw Error('仅支持单一封闭轮廓，复合路径请拆分或展平');
   // Exact vertices for straight SVG paths; do not round off booth corners.
   if(!/[cqsta]/i.test(d.replace(/[eE][-+]?\d+/g,''))){const tokens=d.match(/[a-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/ig)||[];let i=0,cmd='',x=0,z=0;while(i<tokens.length){if(/^[a-z]$/i.test(tokens[i]))cmd=tokens[i++];if(/[zZ]/.test(cmd))break;const relative=cmd===cmd.toLowerCase(),type=cmd.toUpperCase();if(!['M','L','H','V'].includes(type))throw Error('路径命令不支持');if(i>=tokens.length)throw Error('路径不完整');const v=Number(tokens[i++]);if(type==='H')x=relative?x+v:v;else if(type==='V')z=relative?z+v:v;else{const w=Number(tokens[i++]);x=relative?x+v:v;z=relative?z+w:w}pts.push({x,z});if(type==='M')cmd=relative?'l':'L'} }
  }
  if(!pts.length){const length=el.getTotalLength();if(!Number.isFinite(length)||length<=0||length>100000)throw Error('轮廓长度异常');const count=Math.min(8192,Math.max(32,Math.ceil(length/2)));for(let i=0;i<count;i++){const p=el.getPointAtLength(i*length/count);pts.push({x:p.x,z:p.y})}pts=simplify(pts,.3)}
 }
 pts=pts.map(p=>svg.point(el,p.x,p.z));if(pts.length>1&&Math.hypot(pts[0].x-pts.at(-1).x,pts[0].z-pts.at(-1).z)<.01)pts.pop();return pts;
}
async function parse(text,targetText,hall,masterText){
 const source=mount(text);let target,master;
 try{target=mount(targetText);const candidates=[...source.root.querySelectorAll('[id]')].filter(el=>boothCode(el.id));if(candidates.length>2000)throw Error('单次最多导入2000个展位，请分批导出');
 const rows=[],issues=[],seen=new Map();let ignored=0;
 for(const el of candidates){const code=boothCode(el.id);if(el.closest('g[id^="SHOP"]')){ignored++;continue}if(context(el)&&context(el)!==hall.id){ignored++;continue}if(el.parentElement.closest('[data-booth-parent]'))continue;el.dataset.boothParent='1';try{const shapes=geometryTags.has(el.localName)?[el]:[...el.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line')];if(shapes.length!==1)throw Error('一个展位需对应一个封闭图形，请展平该组');const shape=shapes[0],points=outline(source,shape);rows.push({code,points,circle:shape.localName==='circle'});seen.set(code,(seen.get(code)||0)+1)}catch(e){issues.push(code+'：'+e.message)}if(rows.length%40===0)await new Promise(r=>setTimeout(r,0));}
 const unique=rows.filter(r=>{if(seen.get(r.code)>1){issues.push(r.code+'：文件内展位号重复，已跳过');return false}return true});
 if(masterText)master=mount(masterText);
 const reg=master?masterRegistration(source,master,target,hall):registration(source,target,hall),floorNames=[...source.root.querySelectorAll('[id]')].map(n=>n.id.match(/__F([123])(?:__|$)/)?.[1]).filter(Boolean);
 return{rows:unique,issues,ignored,registration:reg,wrongFloor:floorNames.some(f=>'F'+f!==hall.floor),count:candidates.length};
 }finally{source.dispose();target?.dispose();master?.dispose()}
}
function convert(row,project){const points=row.points.map(project);let geometry=G.fromWorld(points);if(row.circle){const b=G.bounds(points),radius=(b.maxX-b.minX)/2;if(Math.abs((b.maxZ-b.minZ)/2-radius)<.03)geometry={shape:'circle',x:(b.minX+b.maxX)/2,z:(b.minZ+b.maxZ)/2,w:radius*2,h:radius*2,radius,angle:0}}const error=G.valid(geometry);if(error)throw Error(error);return{...geometry,code:row.code}}
window.EditorSVG={parse,convert};
})();
