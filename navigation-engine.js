/* Geometry-based, floor-local routing. No rendering/COVER dependencies. */
(function(root){
  'use strict';
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z),lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
  function inside(p,poly){let v=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)v=!v}return v}
  function pointSegment(p,a,b){const x=b.x-a.x,z=b.z-a.z,l=x*x+z*z,t=l?Math.max(0,Math.min(1,((p.x-a.x)*x+(p.z-a.z)*z)/l)):0;return dist(p,{x:a.x+t*x,z:a.z+t*z})}
  function intersection(a,b,c,d){const x=b.x-a.x,z=b.z-a.z,u=d.x-c.x,v=d.z-c.z,den=x*v-z*u;if(Math.abs(den)<1e-10)return null;const t=((c.x-a.x)*v-(c.z-a.z)*u)/den,s=((c.x-a.x)*z-(c.z-a.z)*x)/den;return t>=0&&t<=1&&s>=0&&s<=1?t:null}
  const bbox=p=>({minX:Math.min(...p.map(v=>v.x)),maxX:Math.max(...p.map(v=>v.x)),minZ:Math.min(...p.map(v=>v.z)),maxZ:Math.max(...p.map(v=>v.z))});
  const boundsContain=(b,p,margin=0)=>p.x>=b.minX-margin&&p.x<=b.maxX+margin&&p.z>=b.minZ-margin&&p.z<=b.maxZ+margin;
  class Heap{constructor(){this.a=[]}push(v){let i=this.a.length;this.a.push(v);while(i){const p=(i-1)>>1;if(this.a[p].score<=v.score)break;this.a[i]=this.a[p];i=p}this.a[i]=v}pop(){const t=this.a[0],v=this.a.pop();if(this.a.length){let i=0;while(i*2+1<this.a.length){let c=i*2+1;if(c+1<this.a.length&&this.a[c+1].score<this.a[c].score)c++;if(this.a[c].score>=v.score)break;this.a[i]=this.a[c];i=c}this.a[i]=v}return t}get size(){return this.a.length}}
  function hull(points){const p=[...points].sort((a,b)=>a.x-b.x||a.z-b.z),cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x),lo=[],hi=[];for(const v of p){while(lo.length>1&&cross(lo.at(-2),lo.at(-1),v)<=0)lo.pop();lo.push(v)}for(const v of p.reverse()){while(hi.length>1&&cross(hi.at(-2),hi.at(-1),v)<=0)hi.pop();hi.push(v)}return lo.slice(0,-1).concat(hi.slice(0,-1))}
  class Router{
    constructor(data){this.data=data;this.floors=new Map();for(const f of data.floors){const ground=f.ground.map(poly=>({poly,box:bbox(poly)})),halls=f.halls.map(h=>({...h,box:bbox(h.polygon)})),mid=f.mid.length?hull(f.mid.flat()):[],blocked=[...f.blocked,...(mid.length?[mid]:[])].map(poly=>({poly,box:bbox(poly)}));const walls=new Map(),bucket=12;for(const line of f.walls){const b=bbox(line);for(let x=Math.floor((b.minX-.5)/bucket);x<=Math.floor((b.maxX+.5)/bucket);x++)for(let z=Math.floor((b.minZ-.5)/bucket);z<=Math.floor((b.maxZ+.5)/bucket);z++){const k=x+','+z;if(!walls.has(k))walls.set(k,[]);walls.get(k).push(line)}}this.floors.set(f.id,{...f,ground,halls,blocked,mid,walls,bucket,box:bbox(f.ground.flat()),cells:new Map()})}}
    cached(f,name,p,compute){const cache=f[name]||(f[name]=new Map()),key=p.x+','+p.z;if(cache.has(key))return cache.get(key);const value=compute();if(cache.size>=100000)cache.clear();cache.set(key,value);return value}
    rooms(f){return f.roomRegions||(f.roomRegions=(f.rooms||[]).map(r=>({...r,box:bbox(r.poly)})))}
    roomAt(p,f,margin=0){return this.rooms(f).find(r=>boundsContain(r.box,p,margin)&&(inside(p,r.poly)||(margin>0&&r.poly.some((a,i)=>pointSegment(p,a,r.poly[(i+1)%r.poly.length])<=margin))))}
    owner(p,floor){const f=this.floors.get(floor);return this.cached(f,'ownerCache',p,()=>f.halls.find(h=>boundsContain(h.box,p)&&inside(p,h.polygon))?.id||this.roomAt(p,f,.8)?.hall||'road')}
    boundaryEdges(a,b,f){
      if(!f.edges){f.edges=new Map();for(const r of [...f.ground,...f.blocked,...this.rooms(f).map(r=>({poly:r.poly})),...f.halls.map(h=>({poly:h.polygon,hall:h}))])r.poly.forEach((p,i)=>{const q=r.poly[(i+1)%r.poly.length],edge={p,q,hall:r.hall};for(let x=Math.floor(Math.min(p.x,q.x)/f.bucket);x<=Math.floor(Math.max(p.x,q.x)/f.bucket);x++)for(let z=Math.floor(Math.min(p.z,q.z)/f.bucket);z<=Math.floor(Math.max(p.z,q.z)/f.bucket);z++){const k=x+','+z;if(!f.edges.has(k))f.edges.set(k,[]);f.edges.get(k).push(edge)}})}
      const found=new Set();for(let x=Math.floor(Math.min(a.x,b.x)/f.bucket);x<=Math.floor(Math.max(a.x,b.x)/f.bucket);x++)for(let z=Math.floor(Math.min(a.z,b.z)/f.bucket);z<=Math.floor(Math.max(a.z,b.z)/f.bucket);z++)for(const e of f.edges.get(x+','+z)||[])found.add(e);return found;
    }
    nearWalls(a,b,f){const found=new Set();for(let x=Math.floor((Math.min(a.x,b.x)-.5)/f.bucket);x<=Math.floor((Math.max(a.x,b.x)+.5)/f.bucket);x++)for(let z=Math.floor((Math.min(a.z,b.z)-.5)/f.bucket);z<=Math.floor((Math.max(a.z,b.z)+.5)/f.bucket);z++)for(const s of f.walls.get(x+','+z)||[])found.add(s);return found}
    physical(p,f){return this.cached(f,'physicalCache',p,()=>this.physicalRaw(p,f))}
    physicalRaw(p,f){if(f.blocked.some(r=>boundsContain(r.box,p,.2)&&(inside(p,r.poly)||r.poly.some((a,i)=>pointSegment(p,a,r.poly[(i+1)%r.poly.length])<.2))))return false;if([...this.nearWalls(p,p,f)].some(([a,b])=>pointSegment(p,a,b)<.42))return false;return !!this.roomAt(p,f)||f.halls.some(h=>boundsContain(h.box,p)&&inside(p,h.polygon))||f.ground.reduce((v,r)=>v!==(boundsContain(r.box,p)&&inside(p,r.poly)),false)}
    policy(start,end,allowed){const a=this.owner(start.position,start.floor),b=this.owner(end.position,end.floor);return{a,b,allowed:allowed||new Set([a,b]),same:a===b&&a!=='road'}}
    advance(owner,phase,policy){if(!policy.allowed.has(owner)&&owner!=='road')return -1;if(policy.same)return owner===policy.a?0:-1;if(owner==='road')return phase===2?-1:1;if(owner===policy.a&&phase===0)return 0;if(owner===policy.b)return 2;return -1}
    segment(a,b,f,policy,phase){
      if(!this.physical(a,f)||!this.physical(b,f))return -1;
      for(const [c,d] of this.nearWalls(a,b,f)){if(intersection(a,b,c,d)!==null||Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b))<.3)return -1}
      const cuts=[0,1],hallCuts=[];
      for(const {p,q,hall} of this.boundaryEdges(a,b,f)){const t=intersection(a,b,p,q);if(t!==null){cuts.push(t);if(hall)hallCuts.push({t,hall})}}
      for(const {t,hall} of hallCuts){if(inside(lerp(a,b,t-1e-6),hall.polygon)===inside(lerp(a,b,t+1e-6),hall.polygon))continue;const p=lerp(a,b,t);if(this.roomAt(p,f,.8)?.hall===hall.id)continue;if(!f.doors.some(d=>d.hall===hall.id&&pointSegment(p,d.line[0],d.line[1])<=.8))return -1}
      cuts.sort((x,y)=>x-y);for(let i=1;i<cuts.length;i++){if(cuts[i]-cuts[i-1]<1e-8)continue;const p=lerp(a,b,(cuts[i]+cuts[i-1])/2);if(!this.physical(p,f))return -1;phase=this.advance(this.owner(p,f.id),phase,policy);if(phase<0)return -1}return this.advance(this.owner(b,f.id),phase,policy);
    }
    path(start,end,allowed){const result=this.gridPath(start,end,allowed,1.5);if(result)return result;return ['male','female','accessible'].includes(end.type)?this.gridPath(start,end,allowed,.5):null}
    gridPath(start,end,allowed,step){
      const f=this.floors.get(start.floor),policy=this.policy(start,end,allowed),from=start.position,to=end.position;if(!f||!this.physical(from,f)||!this.physical(to,f))return null;
      const initial=policy.a==='road'?1:0;if(this.segment(from,to,f,policy,initial)>=0)return[from,to];
      const width=Math.ceil((f.box.maxX-f.box.minX)/step)+1,height=Math.ceil((f.box.maxZ-f.box.minZ)/step)+1;
      const cell=(x,z)=>{if(x<0||z<0||x>=width||z>=height)return null;const id=z*width+x;const cacheId=step+':'+id;if(!f.cells.has(cacheId)){const p={x:f.box.minX+x*step,z:f.box.minZ+z*step};f.cells.set(cacheId,{x,z,id,p,ok:this.physical(p,f),owner:this.owner(p,f.id)})}return f.cells.get(cacheId)};
      const snap=(p,reverse)=>{const x=Math.round((p.x-f.box.minX)/step),z=Math.round((p.z-f.box.minZ)/step),out=[];for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){const n=cell(x+dx,z+dz);if(!n?.ok||dist(n.p,p)>3)continue;const ph=this.segment(reverse?n.p:p,reverse?p:n.p,f,policy,reverse?(n.owner==='road'?1:n.owner===policy.a?0:2):initial);if(ph>=0)out.push({n,phase:ph})}return out.sort((a,b)=>dist(a.n.p,p)-dist(b.n.p,p)).slice(0,8)};
      const starts=snap(from,false),goals=snap(to,true);if(!starts.length||!goals.length)return null;const goalIds=new Set(goals.map(g=>g.n.id)),heap=new Heap(),cost=new Map(),came=new Map(),records=new Map();
      for(const {n,phase} of starts){const key=n.id*3+phase,g=dist(from,n.p);cost.set(key,g);records.set(key,{n,phase});heap.push({key,g,score:g+dist(n.p,to)})}
      let iterations=0;while(heap.size&&iterations++<350000){if(iterations%256===0&&Date.now()>this.deadline)throw new Error('路线计算达到时间上限，请缩小起终点范围或补充明确公共道路。未显示未经验证的路线。');const top=heap.pop();if(top.g!==cost.get(top.key))continue;const {n,phase}=records.get(top.key);
        if(goalIds.has(n.id)&&this.segment(n.p,to,f,policy,phase)>=0){const result=[to];let k=top.key;while(k!==undefined){result.unshift(records.get(k).n.p);k=came.get(k)}result.unshift(from);return result}
        for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const next=cell(n.x+dx,n.z+dz);if(!next?.ok||this.advance(next.owner,phase,policy)<0)continue;const ng=top.g+Math.hypot(dx,dz)*step,np=this.segment(n.p,next.p,f,policy,phase);if(np<0)continue;const key=next.id*3+np;if(ng>=(cost.get(key)??Infinity))continue;cost.set(key,ng);came.set(key,top.key);records.set(key,{n:next,phase:np});heap.push({key,g:ng,score:ng+dist(next.p,to)})}
      }return null;
    }
    audit(sections,start,end){const allowed=new Set([this.owner(start.position,start.floor),this.owner(end.position,end.floor)]),violations=[];for(const s of sections){if(s.type!=='walk')continue;const f=this.floors.get(s.floor),a={floor:s.floor,position:s.points[0]},b={floor:s.floor,position:s.points.at(-1)},policy=this.policy(a,b,allowed);let phase=policy.a==='road'?1:0;for(let i=1;i<s.points.length;i++){phase=this.segment(s.points[i-1],s.points[i],f,policy,phase);if(phase<0){violations.push({floor:s.floor,segment:i});break}}}return{valid:violations.length===0,violations}}
    plan(start,end,preference='default'){
      this.deadline=Date.now()+20000;
      // Concave room outlines can have their label centre outside the actual room.
      const ef=this.floors.get(end.floor),room=this.rooms(ef).find(r=>r.id===end.id);
      if(room&&!this.physical(end.position,ef)){const candidates=[];for(let x=room.box.minX+.25;x<room.box.maxX;x+=.5)for(let z=room.box.minZ+.25;z<room.box.maxZ;z+=.5){const p={x,z};if(inside(p,room.poly)&&this.physical(p,ef))candidates.push(p)}candidates.sort((a,b)=>dist(a,end.position)-dist(b,end.position));if(candidates.length)end={...end,position:candidates[0],arrivalCandidates:candidates.slice(1,8)}}
      const allowed=new Set([this.owner(start.position,start.floor),this.owner(end.position,end.floor)]),targets=end.arrivalCandidates?.length?[end.position,...end.arrivalCandidates]:[end.position];
      if(start.floor===end.floor){for(const p of targets){const destination={...end,position:p},points=this.path(start,destination,allowed);if(points){const sections=[{type:'walk',floor:start.floor,points}],audit=this.audit(sections,start,destination);if(audit.valid)return{ok:true,sections,audit,distance:this.length(points),destination:p,rule:start.hall===end.hall?'同馆导航':'馆 → 公共道路 → 馆'}}}return{ok:false,reason:'未找到符合“馆—道路—馆”的连通路线。请检查门口、道路边界或目标设施入口；不会借道第三馆或中央商务区。'}}
      const candidates=this.data.connectors.map(c=>c.lower.floor===start.floor?{...c,from:c.lower,to:c.upper}:{...c,from:c.upper,to:c.lower}).filter(c=>c.to.floor===end.floor&&[c.from,c.to].every(n=>{const o=this.owner(n.position,n.floor);return o==='road'||allowed.has(o)})).sort((a,b)=>((preference!=='default'&&a.type!==preference?100000:0)+dist(start.position,a.from.position)+dist(a.to.position,end.position))-((preference!=='default'&&b.type!==preference?100000:0)+dist(start.position,b.from.position)+dist(b.to.position,end.position)));
      for(const c of candidates.slice(0,24)){const first=this.path(start,c.from,allowed);if(!first)continue;for(const p of targets){const destination={...end,position:p},last=this.path(c.to,destination,allowed);if(!last)continue;const sections=[{type:'walk',floor:start.floor,points:first},{type:c.type,fromFloor:start.floor,toFloor:end.floor,points:[c.from.position,c.to.position]},{type:'walk',floor:end.floor,points:last}],audit=this.audit(sections,start,destination);if(audit.valid)return{ok:true,sections,audit,distance:this.length(first)+this.length(last),connector:c.type,unconfirmed:true,fallback:preference!=='default'&&preference!==c.type,destination:p,rule:'跨层：馆 → 公共道路/换层点 → 馆'}}}
      return{ok:false,reason:'没有找到不借道第三馆或中央商务区的跨层通路。请补充或核实公共电梯/扶梯/楼梯的连接与入口数据。'};
    }
    length(p){return p.slice(1).reduce((v,q,i)=>v+dist(p[i],q),0)}
  }
  root.VenueRouter=Router;if(typeof module!=='undefined')module.exports={Router,inside,hull};
})(typeof self!=='undefined'?self:globalThis);
