const assert=require('node:assert/strict'),G=require('../editor-geometry.js');
const rect={id:'r',x:10,z:10,w:10,h:6,angle:0};assert.equal(G.area(G.outline(rect)),60);
const l=[{x:0,z:0},{x:12,z:0},{x:12,z:4},{x:4,z:4},{x:4,z:12},{x:0,z:12}],b=G.fromWorld(l);assert.equal(G.error(l),'');assert.equal(G.area(G.outline(b)),80);assert.deepEqual(G.outline(b),l);
assert.ok(G.error([{x:0,z:0},{x:5,z:5},{x:0,z:5},{x:5,z:0}]));assert.ok(G.error([{x:0,z:0},{x:0,z:0},{x:1,z:1}]));assert.ok(G.error([{x:0,z:0},{x:1,z:0},{x:2,z:0}]));
const c={shape:'circle',x:0,z:0,radius:5,w:10,h:10,angle:0};assert.equal(G.valid(c),'');assert.ok(Math.abs(G.area(G.outline(c))-Math.PI*25)<.05);assert.ok(G.valid({...c,w:12}));
const p={x:15.2,z:30};assert.equal(G.snap(p,[rect],{tolerance:.5,enabled:true}).point.x,15);assert.equal(G.snap(p,[rect],{tolerance:.5,enabled:false}).point.x,15.2);assert.equal(G.snap(p,[rect],{tolerance:.5,enabled:true,exclude:'r'}).point.x,15.2);assert.equal(G.snap({x:3.2,z:4.3},[],{enabled:true,grid:true,tolerance:.5}).point.z,4);
console.log('PASS rectangle compatibility, concave polygon, rejection of self-intersection/repeated/degenerate points, circle geometry, snapping on/off/exclusion/grid');
