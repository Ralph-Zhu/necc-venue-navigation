(()=>{'use strict';
window.installSVGImport=function(api){
 const button=document.createElement('button');button.id='openSVGImport';button.textContent='导入 SVG 展位';document.querySelector('.toolbar>div').prepend(button);
 const dialog=document.createElement('dialog');dialog.id='svgImportDialog';dialog.setAttribute('aria-labelledby','svgImportTitle');
 dialog.innerHTML=`<div class="svg-heading"><div><small>展位输入 / SVG</small><h2 id="svgImportTitle">批量导入，再自由编辑</h2></div><button id="closeSVGImport" aria-label="关闭SVG导入">关闭</button></div>
 <div class="svg-content"><div class="svg-settings"><p id="svgDestination"></p><label>选择单馆 SVG<input id="svgBoothFile" type="file" accept=".svg,image/svg+xml"></label><p>在原始单馆文件上添加展位，连同馆内地板一起导出；无需转成总图方向。</p><p class="muted">仅识别 BOOTH__F1__H1.1__A001、BOOTH__F1__A001 或 A001 这类命名。墙、门、厕所等不导入；以原始地板轮廓关联母版及总图。</p>
 <label>遇到同号展位<select id="svgMergeMode"><option value="append">保留已有展位，仅添加新编号</option><option value="update">更新同号轮廓，保留企业信息</option></select></label>
 <label>位置对齐<select id="svgAlignment"><option value="auto">按原始场馆母版自动对齐</option><option value="manual">手动设置整批位置与角度</option></select></label>
 <div id="svgManual" hidden><p class="muted">10 SVG单位 = 1米，不自动拉伸。以下是整批展位的中心位置。</p><div class="two"><label>中心 X / 米<input id="svgX" type="number" step="any"></label><label>中心 Z / 米<input id="svgZ" type="number" step="any"></label></div><label>整批旋转 / 度<input id="svgAngle" type="number" value="0" step="any"></label></div>
 <p id="svgRegistration" class="muted"></p><p id="svgImportStatus" role="status">选择文件后，先预览，再确认。已有草稿不受影响。</p>
 <details id="svgIssueDetails" hidden><summary>查看识别提示</summary><ul id="svgIssues"></ul></details>
 <label id="svgReviewLabel" class="svg-review" hidden><input id="svgReviewed" type="checkbox">我已检查位置及提示，只导入预览中可用的展位</label></div>
 <div class="svg-preview"><canvas id="svgPreviewCanvas" aria-label="SVG展位导入位置预览"></canvas><p>绿色：待导入展位 · 灰色：已有展位 · 红色：越出馆内地板，请调整位置</p></div></div>
 <div class="svg-footer"><span>仅写入当前馆草稿，可一次撤销；不发布到正式地图。</span><button id="confirmSVGImport" class="primary" disabled>确认导入</button></div>`;
 document.body.append(dialog);const $=id=>dialog.querySelector('#'+id),G=window.EditorGeometry;
 let masters=null,parsed=null,prepared=[],target=null,token=0,base=null,problemCount=0;
 const inside=(p,poly)=>{let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)yes=!yes}return yes};
 function reset(){token++;parsed=null;prepared=[];$('confirmSVGImport').disabled=true;$('svgReviewed').checked=false;$('svgReviewLabel').hidden=true;$('svgIssueDetails').hidden=true;$('svgRegistration').textContent='';}
 function close(){reset();dialog.close();button.focus()}
 button.onclick=()=>{if(!api.getVenue())return;api.cancelGesture();target={venue:api.getVenue(),event:api.getEvent()};reset();$('svgBoothFile').value='';$('svgAlignment').value='auto';$('svgMergeMode').value='append';$('svgManual').hidden=true;const b=target.venue.bounds;$('svgX').value=(b.x+b.w/2).toFixed(2);$('svgZ').value=(b.z+b.h/2).toFixed(2);$('svgAngle').value=0;$('svgDestination').textContent='导入到 '+target.venue.floor+' / '+target.venue.id+' 馆 · '+target.event.name;$('svgImportStatus').textContent='选择文件后，先预览，再确认。已有草稿不受影响。';base=new Image();base.onload=draw;base.src=target.venue.image;dialog.showModal();draw()};
 $('closeSVGImport').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close()});
 dialog.addEventListener('keydown',e=>e.stopPropagation());
 $('svgBoothFile').onchange=async()=>{const f=$('svgBoothFile').files[0];reset();const seq=token;if(!f)return;if(f.size>12*1024*1024){$('svgImportStatus').textContent='文件超过12 MB，请只导出单馆。';return}$('svgImportStatus').textContent='正在识别展位与校准坐标…';try{const response=await fetch(target.venue.image);if(!response.ok)throw Error('固定场馆底图读取失败');if(!masters){const m=await fetch('./assets/editor/hall-masters.json');if(!m.ok)throw Error('场馆母版库读取失败');masters=await m.json()}const result=await EditorSVG.parse(await f.text(),await response.text(),target.venue,masters[target.venue.id]);if(seq!==token)return;parsed=result;if(!result.registration||result.registration.failed)$('svgAlignment').value='manual';refresh()}catch(e){if(seq===token){$('svgImportStatus').textContent='无法导入：'+e.message;draw()}}};
 function refresh(){
  $('svgReviewed').checked=false;$('svgManual').hidden=$('svgAlignment').value!=='manual';prepared=[];problemCount=0;
  if(!parsed)return;const issues=[...parsed.issues],manual=$('svgAlignment').value==='manual',reg=parsed.registration;
  let project;
  if(manual){const points=parsed.rows.flatMap(r=>r.points),b=points.length?G.bounds(points):{minX:0,maxX:0,minZ:0,maxZ:0},x=Number($('svgX').value),z=Number($('svgZ').value),a=Number($('svgAngle').value)*Math.PI/180;if(![x,z,a].every(Number.isFinite)||Math.abs(x)>10000||Math.abs(z)>10000){$('svgImportStatus').textContent='请输入有效的中心坐标和旋转角度';$('confirmSVGImport').disabled=true;draw();return}project=p=>{const u=(p.x-(b.minX+b.maxX)/2)/10,v=(p.z-(b.minZ+b.maxZ)/2)/10;return{x:x+u*Math.cos(a)-v*Math.sin(a),z:z+u*Math.sin(a)+v*Math.cos(a)}};$('svgRegistration').textContent=reg?.failed?(reg.reason||'场馆配准未通过，请检查原始地板轮廓及比例。'):'手动定位：请在预览中确认，不能仅凭展位分布判断真实位置。'}
  else if(reg&&!reg.failed){project=reg.project;$('svgRegistration').textContent=reg.method==='master'?`原始母版 → 总图场馆 · 已校准旋转 ${reg.angle.toFixed(1)}° · 轮廓误差 ${reg.error.toFixed(3)}米 · 比例10:1`:`出入口备用校准 · ${reg.count} 个 · 误差 ${reg.error.toFixed(3)}米`}
  else{$('svgRegistration').textContent='未能确认母版对应关系，请保留原始馆内地板，或使用手动定位。';$('confirmSVGImport').disabled=true;draw();return}
  if(parsed.wrongFloor)issues.push('文件包含与当前楼层不同的旧命名；目标以当前选择的 '+target.venue.floor+' / '+target.venue.id+' 馆为准。');
  if(parsed.ignored)issues.push('跳过其他馆的 '+parsed.ignored+' 个展位。');
  const existing=api.getBooths(),codes=new Set(existing.map(b=>b.code));let duplicates=0;
  for(const row of parsed.rows){try{const b=EditorSVG.convert(row,project);if(codes.has(b.code)&&$('svgMergeMode').value==='append'){duplicates++;continue}b.outside=G.outline(b).some(p=>!inside(p,target.venue.polygon));if(b.outside)problemCount++;prepared.push(b)}catch(e){issues.push(row.code+'：'+e.message)}}
  if(problemCount)issues.push(problemCount+' 个展位超出馆内地板，请先核对整批坐标或在导入后修正。');
  if(duplicates)issues.push(duplicates+' 个已有编号已保留，不重复添加。');
  const updated=prepared.filter(b=>codes.has(b.code)).length;
  $('svgImportStatus').textContent=`识别到 ${parsed.rows.length} 个有效候选；将新增 ${prepared.length-updated} 个、更新 ${updated} 个。`;
  $('svgIssues').replaceChildren();for(const text of issues){const li=document.createElement('li');li.textContent=text;$('svgIssues').append(li)}$('svgIssueDetails').hidden=!issues.length;$('svgReviewLabel').hidden=!(manual||issues.length);updateButton();draw();
 }
 function updateButton(){$('confirmSVGImport').disabled=!prepared.length||(!$('svgReviewLabel').hidden&&!$('svgReviewed').checked)}
 for(const id of ['svgMergeMode','svgAlignment','svgX','svgZ','svgAngle'])$(id).onchange=refresh;$('svgReviewed').onchange=updateButton;
 function draw(){if(!dialog.open||!target)return;const canvas=$('svgPreviewCanvas'),r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);canvas.width=r.width*dpr;canvas.height=r.height*dpr;const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,r.width,r.height);const hall=target.venue.bounds,all=[...target.venue.polygon,...prepared.flatMap(b=>G.outline(b))],bounds=G.bounds(all),s=Math.min((r.width-36)/(bounds.maxX-bounds.minX),(r.height-36)/(bounds.maxZ-bounds.minZ)),x=(bounds.minX+bounds.maxX)/2,z=(bounds.minZ+bounds.maxZ)/2;
  const point=p=>({x:(p.x-x)*s+r.width/2,y:(p.z-z)*s+r.height/2});
  function poly(points,fill,stroke){c.beginPath();points.forEach((p,i)=>{const q=point(p);i?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y)});c.closePath();c.fillStyle=fill;c.fill();c.strokeStyle=stroke;c.stroke()}
  poly(target.venue.polygon,'#fff','#819c99');if(base?.complete&&base.naturalWidth){const p=point({x:hall.x,z:hall.z});c.drawImage(base,p.x,p.y,hall.w*s,hall.h*s)}for(const b of api.getBooths())poly(G.outline(b),'#72878b30','#82969a');for(const b of prepared){poly(G.outline(b),b.outside?'#c54b4b55':'#30ab8555',b.outside?'#ae3131':'#167569');if(b.w*s>27){const p=point(b);c.fillStyle='#163d36';c.font='10px sans-serif';c.textAlign='center';c.fillText(b.code,p.x,p.y,Math.max(10,b.w*s-4))}}
 }
 new ResizeObserver(draw).observe($('svgPreviewCanvas'));
 $('confirmSVGImport').onclick=()=>{if($('confirmSVGImport').disabled||!prepared.length)return;if(target.event!==api.getEvent()||target.venue.key!==api.getVenue().key){$('svgImportStatus').textContent='目标已改变，请关闭后重新导入。';return}const booths=api.getBooths();if(booths.length+prepared.filter(b=>!booths.some(o=>o.code===b.code)).length>5000){$('svgImportStatus').textContent='本馆最多5000个展位，请分馆维护。';return}api.commit(prepared.map(({outside,...b})=>b),$('svgMergeMode').value);close()};
};
})();
