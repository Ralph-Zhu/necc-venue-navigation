importScripts('./navigation-engine.js?v=20260908-2');
let router;
onmessage=event=>{const {id,action,data,start,end,preference}=event.data;try{if(action==='init'){router=new VenueRouter(data);postMessage({id,ready:true})}else{const began=performance.now(),result=router.plan(start,end,preference);postMessage({id,result:{...result,elapsedMs:Math.round(performance.now()-began)}})}}catch(error){postMessage({id,error:error.message})}};
