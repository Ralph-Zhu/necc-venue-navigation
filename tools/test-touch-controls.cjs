const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../campus-all.js'),'utf8');
const handlers={},s={pointers:new Map(),travel:0,dragAction:'pan',desiredDistance:100,minDistance:18,maxDistance:1000,azimuth:0,polar:1,panCalls:[],Math,THREE:{MathUtils:{clamp:(v,a,b)=>Math.max(a,Math.min(b,v))}},canvas:{addEventListener:(k,f)=>handlers[k]=f,setPointerCapture(){},releasePointerCapture(){}},requestRender(){}};
s.pan=(x,y)=>s.panCalls.push([x,y]);vm.createContext(s);
vm.runInContext(source.slice(source.indexOf('    canvas.addEventListener("pointerdown"'),source.indexOf('    canvas.addEventListener("wheel"')),s);
function event(type,id,x,y,pointerType='touch',button=0){handlers[type]({type,pointerId:id,clientX:x,clientY:y,pointerType,button,preventDefault(){}})}
event('pointerdown',1,100,100);event('pointermove',1,120,130);assert.deepEqual(s.panCalls,[[20,30]]);assert.equal(s.azimuth,0);event('pointerup',1,120,130);
event('pointerdown',1,100,100);event('pointerdown',2,200,100);const pans=s.panCalls.length;event('pointermove',2,300,100);assert.equal(s.desiredDistance,50);assert.equal(s.panCalls.length,pans);assert.equal(s.azimuth,0);
event('pointermove',2,100,300);assert.ok(Math.abs(s.azimuth-Math.PI/2)<1e-9);assert.equal(s.desiredDistance,50);assert.equal(s.polar,1);
event('pointerup',2,100,300);event('pointermove',1,105,100);assert.deepEqual(s.panCalls.at(-1),[5,0]);assert.ok(s.travel>6);event('pointercancel',1,105,100);assert.equal(s.pointers.size,0);
event('pointerdown',1,0,0,'mouse',2);const angle=s.azimuth;event('pointermove',1,10,10,'mouse',2);assert.equal(s.azimuth,angle-.06);assert.equal(s.polar,1.05);event('pointerup',1,10,10,'mouse',2);
event('pointerdown',1,0,0);event('pointerdown',2,-100,1);const boundary=s.azimuth;event('pointermove',2,-100,-1);assert.ok(Math.abs(s.azimuth-boundary)<.03);event('lostpointercapture',2,-100,-1);event('pointercancel',1,0,0);
event('pointerdown',1,20,20);event('pointerup',1,20,20);assert.equal(s.travel,0);
console.log('PASS: single pan; pinch; twist; angle wrap; multi-to-single; cancellation; tap; desktop orbit');
