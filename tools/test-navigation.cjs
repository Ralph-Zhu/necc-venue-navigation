const assert=require('node:assert/strict'),{Router,inside}=require('../navigation-engine.js');
const rect=(x,z,w,h)=>[{x,z},{x:x+w,z},{x:x+w,z:z+h},{x,z:z+h}],endpoint=(id,x,z)=>({id,floor:'F1',hall:id,position:{x,z}});
const a=endpoint('A',-15,0),b=endpoint('B',15,0);
const fixture=()=>({floors:[{id:'F1',ground:[rect(-25,-20,50,40)],blocked:[],mid:[rect(-3,-3,6,6)],walls:[],halls:[{id:'A',polygon:rect(-20,-4,10,8)},{id:'B',polygon:rect(10,-4,10,8)},{id:'C',polygon:rect(-4,6,8,8)}],doors:[{hall:'A',line:[{x:-10,z:-2},{x:-10,z:2}]},{hall:'B',line:[{x:10,z:-2},{x:10,z:2}]}]}],connectors:[]});
const data=fixture(),router=new Router(data),result=router.plan(a,b);assert.equal(result.ok,true);assert.ok(result.distance>30);
const points=result.sections[0].points;let sawRoad=false,enteredTarget=false;
for(let i=1;i<points.length;i++){const p=points[i-1],q=points[i],n=Math.ceil(Math.hypot(q.x-p.x,q.z-p.z)/.1);for(let k=0;k<=n;k++){const r={x:p.x+(q.x-p.x)*k/n,z:p.z+(q.z-p.z)*k/n};assert.ok(!inside(r,data.floors[0].mid[0]));assert.ok(!inside(r,data.floors[0].halls[2].polygon));const owner=router.owner(r,'F1');if(owner==='road'){assert.ok(!enteredTarget);sawRoad=true}if(owner==='B')enteredTarget=true;if(owner==='A')assert.ok(!sawRoad)}}
const noDoors=fixture();noDoors.floors[0].doors=[];assert.equal(new Router(noDoors).plan(a,b).ok,false);
const barrier=fixture();barrier.floors[0].walls=[[{x:0,z:-20},{x:0,z:20}]];assert.equal(new Router(barrier).plan(a,b).ok,false);
const same=fixture();same.floors[0].blocked=[rect(-15.5,-4,1,8)];assert.equal(new Router(same).plan(endpoint('A',-18,0),endpoint('A',-12,0)).ok,false);
const hole=fixture();hole.floors[0].ground.push(rect(-2,-20,4,40));assert.equal(new Router(hole).plan(a,b).ok,false);
const audit=router.audit([{type:'walk',floor:'F1',points:[a.position,b.position]}],a,b);assert.equal(audit.valid,false);
// Warm caches must not alter direction, policy, geometry or the final audit.
assert.deepEqual(router.plan(a,b).sections,result.sections);
assert.equal(router.plan(b,a).audit.valid,true);
assert.equal(router.audit([{type:'walk',floor:'F1',points:[a.position,b.position]}],a,b).valid,false);
const floor=router.floors.get('F1');
for(const p of [{x:-3.19,z:0},{x:-3.21,z:0},{x:0,z:0},{x:-10,z:0}])assert.equal(router.physical(p,floor),router.physicalRaw(p,floor));
const third=fixture();third.floors[0].ground=[rect(-25,-4,50,8)];third.floors[0].mid=[];third.floors[0].halls[2].polygon=rect(-4,-4,8,8);assert.equal(new Router(third).plan(a,b).ok,false);
console.log('PASS: hall-road-hall sequence, Mid avoidance, third-hall exclusion, doors required, wall/hole blocking, same-hall no exit, rejection of unsafe final path');
const annex=fixture(),wc={...endpoint('A',-22,0),id:'wc',type:'female'};
annex.floors[0].rooms=[{id:'wc',hall:'A',poly:rect(-24,-2,4,4)}];
const annexRouter=new Router(annex),wcRoute=annexRouter.plan(a,wc);
assert.equal(wcRoute.ok,true);assert.equal(wcRoute.audit.valid,true);
assert.equal(annexRouter.owner(wc.position,'F1'),'A');
annex.floors[0].walls=[[{x:-20,z:-4},{x:-20,z:4}]];
assert.equal(new Router(annex).plan(a,wc).ok,false);
console.log('PASS: real room annex connects without numbered hall door; actual wall still blocks');
