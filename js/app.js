import { buildGraph, aStar, planMultiStop } from "./astar.js";

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const STATUS_LABELS = {SUBMITTED:"Submitted",NEEDS_REVIEW:"Needs review",APPROVED:"Approved",SCHEDULED:"Scheduled",IN_PROGRESS:"In progress",COMPLETED:"Completed",REJECTED:"Rejected"};
const STATUS_ORDER = ["SUBMITTED","NEEDS_REVIEW","APPROVED","SCHEDULED","IN_PROGRESS","COMPLETED","REJECTED"];
const CATEGORY_META = {"Organic":"🥬","Plastic":"♻️","Paper & cardboard":"📦","Glass":"🫙","Metal":"🥫","E-waste":"🔋","Potentially hazardous":"⚠️","Textile":"🧵","Mixed / unknown":"❔"};
const state = { zones: [], graph: null, policies: null, initialRequests: [], requests: [], analyses: [], route: null, selectedImage: null, selectedImageUrl: null, map: null, mapLayers: [], currentPage: "overview" };

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load ${path}. Start this project through a local static web server, not by opening index.html directly.`);
  return res.json();
}
function escapeHtml(value="") { return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function fmtDate(iso) { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined,{month:"short",day:"numeric"}); }
function pct(n) { return `${Math.round(n*100)}%`; }
function toast(message, type="") { const el=document.createElement("div"); el.className=`toast ${type}`; el.textContent=message; $("#toast-region").append(el); setTimeout(()=>el.remove(),3600); }
function zoneById(id) { return state.zones.find(z=>z.id===id); }
function saveLocal() { localStorage.setItem("ecosort.requests", JSON.stringify(state.requests)); localStorage.setItem("ecosort.zones", JSON.stringify(state.zones)); }
function loadLocal() {
  try { const req=JSON.parse(localStorage.getItem("ecosort.requests")); if(Array.isArray(req)) state.requests=req; } catch {}
  try { const zones=JSON.parse(localStorage.getItem("ecosort.zones")); if(Array.isArray(zones)&&zones.length) state.zones=zones; } catch {}
}
function setPage(name) {
  state.currentPage=name;
  $$(".page").forEach(p=>p.classList.toggle("active",p.id===`page-${name}`));
  $$(".nav-item[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===name));
  const active=$(`.nav-item[data-page="${name}"]`);
  $("#page-crumb").textContent=active ? active.textContent.trim().replace(/^.\s*/,"") : name;
  $("#sidebar").classList.remove("open");
  if(name==="routes") setTimeout(()=>{ initMap(); renderRouteMap(); },60);
  if(name==="overview") renderOverview();
  if(name==="requests") renderRequests();
  if(name==="zones") renderZones();
}
function statusClass(s) { return `status-${String(s).toLowerCase()}`; }
function renderMetrics(target, metrics) {
  $(target).innerHTML=metrics.map(m=>`<div class="metric-card"><div class="metric-top"><span>${m.label}</span><span class="metric-icon" style="background:${m.bg};color:${m.color}">${m.icon}</span></div><div class="metric-value">${m.value}</div><div class="metric-foot">${m.foot}</div></div>`).join("");
}
function renderOverview() {
  const total=state.requests.length, pending=state.requests.filter(r=>!["COMPLETED","REJECTED"].includes(r.status)).length, review=state.requests.filter(r=>r.status==="NEEDS_REVIEW").length, done=state.requests.filter(r=>r.status==="COMPLETED").length;
  renderMetrics("#overview-metrics",[
    {label:"Total requests",value:total,icon:"▤",bg:"#e6f5eb",color:"#278354",foot:"<strong>Live local state</strong> · demo"},
    {label:"Awaiting collection",value:pending,icon:"◷",bg:"#fff2dd",color:"#b67b23",foot:"Open and scheduled requests"},
    {label:"Manual review",value:review,icon:"⚑",bg:"#fff0ef",color:"#b94c46",foot:"Uncertain or sensitive items"},
    {label:"Completed pickups",value:done,icon:"✓",bg:"#eee9fc",color:"#8063bf",foot:"Marked complete in prototype"}
  ]);
  const counts=STATUS_ORDER.map(s=>({s,n:state.requests.filter(r=>r.status===s).length})).filter(x=>x.n);
  $("#status-chart").innerHTML=counts.length?counts.map(x=>`<div class="bar-row"><span>${STATUS_LABELS[x.s]}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(6,x.n/Math.max(1,total)*100)}%"></div></div><span class="bar-count">${x.n}</span></div>`).join(""):`<p class="microcopy">No requests yet.</p>`;
  $("#compliance-list").innerHTML=state.zones.slice().sort((a,b)=>b.compliance-a.compliance).map(z=>`<div class="compliance-item"><div class="compliance-item-head"><span>${escapeHtml(z.name)}</span><span>${pct(z.compliance)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${z.compliance*100}%;background:${z.compliance<.6?"#c77a63":z.compliance<.8?"#d3a04b":"#59ae7d"}"></div></div></div>`).join("");
}
function renderRequestMetrics() {
  renderMetrics("#request-metrics",[
    {label:"All requests",value:state.requests.length,icon:"▤",bg:"#e6f5eb",color:"#278354",foot:"All current records"},
    {label:"Needs review",value:state.requests.filter(r=>r.status==="NEEDS_REVIEW").length,icon:"⚑",bg:"#fff0ef",color:"#b94c46",foot:"Human review required"},
    {label:"Scheduled",value:state.requests.filter(r=>r.status==="SCHEDULED").length,icon:"◷",bg:"#eee9fc",color:"#8063bf",foot:"Awaiting pickup"},
    {label:"Completed",value:state.requests.filter(r=>r.status==="COMPLETED").length,icon:"✓",bg:"#e6f5eb",color:"#278354",foot:"Completed in demo"}
  ]);
}
function renderRequests() {
  renderRequestMetrics();
  const q=$("#request-search").value.toLowerCase(), f=$("#request-filter").value;
  const list=state.requests.filter(r=>(f==="all"||r.status===f)&&[r.id,r.category,r.zoneId,r.location,r.status].join(" ").toLowerCase().includes(q));
  $("#requests-table").innerHTML=list.map(r=>{
    const zone=zoneById(r.zoneId);
    return `<tr><td><span class="request-id">${escapeHtml(r.id)}</span><span class="request-sub">${escapeHtml(r.location)}</span></td><td><span class="category-cell"><span>${r.emoji||CATEGORY_META[r.category]||"♻️"}</span>${escapeHtml(r.category)}</span></td><td>${escapeHtml(zone?.name||r.zoneId)}</td><td><span class="priority-badge priority-${String(r.priority||"Normal").toLowerCase()}">${escapeHtml(r.priority||"Normal")}</span></td><td><span class="status-badge ${statusClass(r.status)}">${STATUS_LABELS[r.status]||r.status}</span></td><td>${fmtDate(r.submittedAt)}</td><td><button class="table-action" data-request-action="${escapeHtml(r.id)}">Update</button></td></tr>`;
  }).join("");
  $("#requests-empty").classList.toggle("hidden",list.length>0);
}
function renderZones() {
  $("#zone-grid").innerHTML=state.zones.map(z=>`<article class="zone-card"><div class="zone-card-top"><span class="zone-symbol">◉</span><span class="subtle-label">${z.id}</span></div><h3>${escapeHtml(z.name)}</h3><p>${z.pendingRequests} pending requests</p><div class="zone-percent">${pct(z.compliance)}</div><div class="bar-track"><div class="bar-fill" style="width:${z.compliance*100}%;background:${z.compliance<.6?"#c77a63":z.compliance<.8?"#d3a04b":"#59ae7d"}"></div></div><div class="zone-foot"><span>Compliance</span><strong>${z.avgServiceMinutes} min avg.</strong></div></article>`).join("");
  $("#zones-table").innerHTML=state.zones.map(z=>`<tr><td><strong>${escapeHtml(z.name)}</strong><span class="request-sub">${z.id}</span></td><td>${pct(z.compliance)}</td><td>${z.pendingRequests}</td><td>${z.avgServiceMinutes} min</td><td><div class="zone-edit"><input type="number" min="0" max="100" step="1" value="${Math.round(z.compliance*100)}" aria-label="Compliance percent for ${escapeHtml(z.name)}" data-zone-input="${z.id}"><button class="table-action" data-zone-save="${z.id}">Save %</button></div></td></tr>`).join("");
  $("#form-zone").innerHTML=state.zones.map(z=>`<option value="${z.id}">${escapeHtml(z.name)}</option>`).join("");
}
function initMap() {
  if(state.map || !window.L) return;
  state.map=L.map("route-map",{zoomControl:true}).setView([30.903,75.856],13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(state.map);
}
function routeGraph() { return buildGraph(state.graph,state.zones,Number($("#compliance-weight").value)); }
function renderRouteMap() {
  initMap();
  if(!state.map) return;
  state.mapLayers.forEach(l=>state.map.removeLayer(l)); state.mapLayers=[];
  const nodeMap=new Map(state.graph.nodes.map(n=>[n.id,n]));
  const routeSet=new Set(state.route?.path||[]);
  state.graph.edges.forEach(([a,b,d])=>{
    const na=nodeMap.get(a),nb=nodeMap.get(b);
    const line=L.polyline([[na.lat,na.lng],[nb.lat,nb.lng]],{color:"#cbd8ce",weight:3,opacity:.85}).addTo(state.map);
    state.mapLayers.push(line);
  });
  state.graph.nodes.forEach(n=>{
    const isDepot=n.type==="depot", isStop=state.route?.stopOrder?.includes(n.id);
    const marker=L.circleMarker([n.lat,n.lng],{radius:isDepot?8:isStop?7:5,color:isDepot?"#176b50":isStop?"#c18a34":"#94a69a",weight:2,fillColor:isDepot?"#176b50":isStop?"#f3c46c":"#fff",fillOpacity:1}).bindTooltip(`${n.name}${n.zoneId?` · ${n.zoneId}`:""}`).addTo(state.map);
    state.mapLayers.push(marker);
  });
  if(state.route?.path?.length>1){
    const coords=state.route.path.map(id=>nodeMap.get(id)).filter(Boolean).map(n=>[n.lat,n.lng]);
    const line=L.polyline(coords,{color:"#19865a",weight:5,opacity:.95}).addTo(state.map);
    state.mapLayers.push(line);
    state.map.fitBounds(line.getBounds().pad(.18));
  } else state.map.setView([30.903,75.856],13);
}
function renderRouteSummary(result) {
  const nodeMap=new Map(state.graph.nodes.map(n=>[n.id,n]));
  const stops=result.stopOrder.map(id=>nodeMap.get(id)).filter(Boolean);
  $("#route-result").innerHTML=`<div class="route-stat-grid"><div class="route-stat"><small>ROAD DISTANCE</small><strong>${result.distance.toFixed(1)} km</strong></div><div class="route-stat"><small>WEIGHTED COST</small><strong>${result.cost.toFixed(1)}</strong></div><div class="route-stat"><small>COLLECTION STOPS</small><strong>${stops.length}</strong></div><div class="route-stat"><small>ROUTE SEGMENTS</small><strong>${result.segments.length}</strong></div></div><div class="result-section"><h4>Recommended stop order</h4><div class="stop-list"><div class="stop-item"><span class="stop-number depot">D</span><div class="stop-copy"><strong>${escapeHtml(nodeMap.get(result.startId)?.name||result.startId)}</strong><small>Starting depot</small></div></div>${stops.map((n,i)=>`<div class="stop-item"><span class="stop-number">${i+1}</span><div class="stop-copy"><strong>${escapeHtml(n.name)}</strong><small>${escapeHtml(n.zoneId||"No zone")} · ${escapeHtml(zoneById(n.zoneId)?.name||"")}</small></div></div>`).join("")}</div></div><div class="route-note">Compliance weight: ${Number($("#compliance-weight").value).toFixed(1)}. Distance and weighted cost are different metrics. Stop ordering is heuristic and not guaranteed globally optimal.</div><button class="button secondary full" id="export-route-button">↓ Export route JSON</button>`;
  $("#export-route-button").addEventListener("click",()=>downloadJson("ecosort-route.json",{...result,generatedAt:new Date().toISOString(),complianceWeight:Number($("#compliance-weight").value)}));
}
function calculateRoute() {
  try {
    const graph=routeGraph(), start=$("#depot-select").value;
    const stopIds=state.graph.nodes.filter(n=>n.type==="collection").map(n=>n.id);
    state.route=planMultiStop(graph,start,stopIds,$("#route-strategy").value);
    renderRouteSummary(state.route); renderRouteMap(); toast("Route calculated using the custom A* engine.");
  } catch(e) { toast(e.message||"Could not calculate route.","error"); }
}
function downloadJson(name,data) {
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);
}
function openRequestDialog(category) {
  if(category) $("#form-category").value=category;
  $("#request-dialog").showModal();
}
function createRequest(data) {
  const id=`ES-${1055+state.requests.length}`;
  const req={id,category:data.category,emoji:CATEGORY_META[data.category]||"♻️",zoneId:data.zoneId,location:data.location,quantity:data.quantity,priority:["E-waste","Potentially hazardous","Mixed / unknown"].includes(data.category)?"High":"Normal",status:["E-waste","Potentially hazardous","Mixed / unknown"].includes(data.category)?"NEEDS_REVIEW":"SUBMITTED",submittedAt:new Date().toISOString(),notes:data.notes||"",confidence:null};
  state.requests.unshift(req); saveLocal(); renderOverview(); renderRequests(); renderZones(); return req;
}
function showAnalysisLoading() {
  $("#analysis-empty").classList.add("hidden"); $("#analysis-result").classList.add("hidden"); $("#analysis-loading").classList.remove("hidden"); $("#result-live").textContent="ANALYZING"; $("#result-live").className="result-live";
}
function renderAnalysis(result, source) {
  $("#analysis-loading").classList.add("hidden"); $("#analysis-empty").classList.add("hidden"); $("#analysis-result").classList.remove("hidden"); $("#result-live").textContent=source==="gemini"?"GEMINI RESULT":"DEMO RESULT"; $("#result-live").className="result-live success";
  const policy=state.policies.categories[result.category]||state.policies.categories["Mixed / unknown"];
  const conf=Math.max(0,Math.min(1,Number(result.confidence)||0));
  const forcedReview=policy.review||conf<state.policies.confidenceThreshold||result.requiresManualReview;
  const risk=policy.risk;
  const advice=policy.advice;
  const evidence=Array.isArray(result.visibleEvidence)?result.visibleEvidence:[result.visibleEvidence||"The model described visible item features."];
  const uncertainties=Array.isArray(result.uncertaintyReasons)?result.uncertaintyReasons:[];
  $("#analysis-result").innerHTML=`<div class="analysis-card"><div class="analysis-top"><div class="category-emoji">${policy.emoji}</div><div><h2>${escapeHtml(policy.label)}</h2><p>${escapeHtml(result.itemDescription||"Waste item detected")} · ${source==="gemini"?"Gemini image analysis":"Simulated demo analysis"}</p></div></div><div class="confidence-block"><div class="confidence-head"><span>Model-reported confidence estimate</span><strong>${Math.round(conf*100)}%</strong></div><div class="bar-track"><div class="bar-fill" style="width:${conf*100}%;background:${conf<.8?"#d3a04b":"#59ae7d"}"></div></div><p class="microcopy">This is a model-reported estimate, not a calibrated probability.</p></div><div class="risk-banner ${risk}"><strong>${forcedReview?"⚑ Manual review recommended":"✓ Suggested handling pathway"}</strong><br>${forcedReview?"Do not rely on this prediction alone. Confirm the item and follow local municipal handling rules.": "Apply local collection rules before disposal. Classification does not establish chemical or biological safety."}</div><div class="result-section"><h4>Visible evidence · AI-generated</h4><ul>${evidence.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul></div><div class="result-section"><h4>Recommended disposal action</h4><p>${escapeHtml(advice)}</p></div>${uncertainties.length?`<div class="result-section"><h4>Uncertainty</h4><ul>${uncertainties.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul></div>`:""}<div class="result-section"><h4>Limitations</h4><p>${escapeHtml(result.limitations||"Image-based analysis can be wrong. Verify the category and local disposal rules, especially for potentially hazardous items.")}</p></div><div class="result-actions"><button class="button primary" id="analysis-request-button">＋ Create collection request</button><button class="button secondary" id="analysis-export-button">Export result JSON</button></div></div>`;
  $("#analysis-request-button").addEventListener("click",()=>openRequestDialog(result.category));
  $("#analysis-export-button").addEventListener("click",()=>downloadJson("ecosort-analysis.json",{...result,finalPolicy:{risk,advice,requiresManualReview:forcedReview},source,createdAt:new Date().toISOString()}));
  state.lastAnalysis={...result,source,policy,requiresManualReview:forcedReview};
}
async function analyzeWithGemini() {
  if(!state.selectedImage) { toast("Choose a waste image first.","error"); return; }
  const key=sessionStorage.getItem("ecosort.geminiKey");
  if(!key) { toast("Add your Gemini API key in Settings, or use the sample analysis button.","error"); setPage("settings"); return; }
  const model=(sessionStorage.getItem("ecosort.geminiModel")||"gemini-2.5-flash").trim();
  showAnalysisLoading();
  try {
    const base64=await fileToBase64(state.selectedImage);
    const prompt=`Analyze this household waste image for an academic waste-segregation prototype. Return only JSON with these fields: category (one of "Organic","Plastic","Paper & cardboard","Glass","Metal","E-waste","Potentially hazardous","Textile","Mixed / unknown"), itemDescription (string), visibleEvidence (array of short strings describing visible features), confidence (number from 0 to 1 representing your estimate, not a calibrated probability), riskLevel ("low","medium","high"), recyclable (boolean or null), requiresManualReview (boolean), uncertaintyReasons (array of strings), limitations (string). Do not claim chemical safety from appearance. If batteries, electronics, chemical containers, medical waste, sharp objects, unknown substances, or uncertainty are present, prefer manual review. Do not invent municipal rules; local policy will be applied separately. ${$("#resident-note").value.trim()?`Resident context: ${$("#resident-note").value.trim()}`:""}`;
    const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({contents:[{parts:[{text:prompt},{inline_data:{mime_type:state.selectedImage.type,data:base64}}]}],generationConfig:{responseMimeType:"application/json",temperature:0.1}})
    });
    const payload=await response.json();
    if(!response.ok) throw new Error(payload?.error?.message||`Gemini API returned HTTP ${response.status}`);
    const raw=payload?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("").trim();
    if(!raw) throw new Error("Gemini returned an empty response.");
    const result=JSON.parse(raw);
    const allowed=Object.keys(state.policies.categories);
    if(!allowed.includes(result.category)) result.category="Mixed / unknown";
    result.confidence=Number.isFinite(Number(result.confidence))?Math.max(0,Math.min(1,Number(result.confidence))):0;
    result.requiresManualReview=Boolean(result.requiresManualReview);
    result.visibleEvidence=Array.isArray(result.visibleEvidence)?result.visibleEvidence:[String(result.visibleEvidence||"No specific evidence provided.")];
    result.uncertaintyReasons=Array.isArray(result.uncertaintyReasons)?result.uncertaintyReasons:[];
    renderAnalysis(result,"gemini");
  } catch(e) {
    $("#analysis-loading").classList.add("hidden"); $("#analysis-empty").classList.remove("hidden");
    $("#result-live").textContent="ERROR"; $("#result-live").className="result-live";
    toast(`Gemini analysis failed: ${e.message}. Try again or use demo analysis.`, "error");
  }
}
function fileToBase64(file) { return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(",")[1]);r.onerror=reject;r.readAsDataURL(file);}); }
function demoAnalyze() {
  if(!state.selectedImage) { toast("Choose an image first. A sample result will still need an uploaded image for preview.","error"); return; }
  showAnalysisLoading();
  setTimeout(()=>{
    const choices=[
      {category:"Plastic",itemDescription:"Bottle or rigid plastic container",confidence:.94,visibleEvidence:["Rigid container-like shape","Smooth reflective surface","Bottle-like outline"],uncertaintyReasons:[],limitations:"Simulated result; no image model was called.",requiresManualReview:false},
      {category:"Organic",itemDescription:"Food scraps or plant matter",confidence:.87,visibleEvidence:["Irregular organic-looking shapes","Mixed natural color and texture"],uncertaintyReasons:["Image appearance alone cannot establish composition."],limitations:"Simulated result; no image model was called.",requiresManualReview:false},
      {category:"E-waste",itemDescription:"Possible battery or electronic item",confidence:.62,visibleEvidence:["Compact manufactured object","Material cannot be verified visually"],uncertaintyReasons:["Potentially hazardous item requires confirmation."],limitations:"Simulated result; no image model was called.",requiresManualReview:true}
    ];
    const result=choices[Math.floor(Math.random()*choices.length)];
    renderAnalysis(result,"demo");
  },650);
}
function acceptImage(file) {
  if(!file) return;
  if(!["image/jpeg","image/png","image/webp"].includes(file.type)) { toast("Please choose a JPG, PNG, or WEBP image.","error"); return; }
  if(file.size>8*1024*1024) { toast("Image must be 8 MB or smaller.","error"); return; }
  state.selectedImage=file;
  if(state.selectedImageUrl) URL.revokeObjectURL(state.selectedImageUrl);
  state.selectedImageUrl=URL.createObjectURL(file);
  $("#image-preview").src=state.selectedImageUrl;
  $("#image-preview-wrap").classList.remove("hidden"); $("#upload-zone").classList.add("hidden");
}
function clearImage() {
  state.selectedImage=null;
  if(state.selectedImageUrl) URL.revokeObjectURL(state.selectedImageUrl);
  state.selectedImageUrl=null; $("#waste-image").value=""; $("#image-preview").src="";
  $("#image-preview-wrap").classList.add("hidden"); $("#upload-zone").classList.remove("hidden");
}
function exportRequests() { downloadJson("ecosort-requests.json",state.requests); }
function bindEvents() {
  $$(".nav-item[data-page]").forEach(b=>b.addEventListener("click",()=>setPage(b.dataset.page)));
  $$("[data-go]").forEach(b=>b.addEventListener("click",()=>setPage(b.dataset.go)));
  $("#mobile-menu").addEventListener("click",()=>$("#sidebar").classList.toggle("open"));
  $("#waste-image").addEventListener("change",e=>acceptImage(e.target.files?.[0]));
  $("#remove-image").addEventListener("click",clearImage);
  const dz=$("#upload-zone");
  ["dragenter","dragover"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("dragging");}));
  ["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("dragging");}));
  dz.addEventListener("drop",e=>acceptImage(e.dataTransfer.files?.[0]));
  $("#analyze-button").addEventListener("click",analyzeWithGemini);
  $("#demo-analyze-button").addEventListener("click",demoAnalyze);
  $("#request-search").addEventListener("input",renderRequests);
  $("#request-filter").addEventListener("change",renderRequests);
  $("#new-request-button").addEventListener("click",()=>openRequestDialog());
  $("#close-request-dialog").addEventListener("click",()=>$("#request-dialog").close());
  $("#cancel-request").addEventListener("click",()=>$("#request-dialog").close());
  $("#request-form").addEventListener("submit",e=>{
    e.preventDefault();
    const data={category:$("#form-category").value,quantity:$("#form-quantity").value,zoneId:$("#form-zone").value,location:$("#form-location").value.trim(),notes:$("#form-notes").value.trim()};
    if(!data.location) return;
    const req=createRequest(data); $("#request-dialog").close(); $("#request-form").reset(); renderZones(); toast(`Request ${req.id} created.`);
    setPage("requests");
  });
  $("#requests-table").addEventListener("click",e=>{
    const btn=e.target.closest("[data-request-action]"); if(!btn)return;
    const r=state.requests.find(x=>x.id===btn.dataset.requestAction); if(!r)return;
    const current=STATUS_ORDER.indexOf(r.status), next=STATUS_ORDER[(current+1)%STATUS_ORDER.length];
    const select=document.createElement("select");
    select.setAttribute("aria-label","Choose new request status");
    select.innerHTML=STATUS_ORDER.map(s=>`<option value="${s}" ${s===r.status?"selected":""}>${STATUS_LABELS[s]}</option>`).join("");
    const dialog=document.createElement("dialog");dialog.className="modal";dialog.innerHTML=`<form method="dialog"><div class="modal-head"><h2>Update ${escapeHtml(r.id)}</h2><button class="icon-button" value="cancel">×</button></div><div class="field"><label>Status</label><div id="status-holder"></div></div><div class="modal-actions"><button class="button secondary" value="cancel">Cancel</button><button class="button primary" id="save-status" value="save">Save status</button></div></form>`;
    document.body.append(dialog);dialog.querySelector("#status-holder").append(select);dialog.showModal();
    dialog.querySelector("#save-status").addEventListener("click",ev=>{ev.preventDefault();r.status=select.value;if(r.status==="NEEDS_REVIEW")r.priority="High";saveLocal();renderRequests();renderOverview();dialog.close();dialog.remove();toast(`${r.id} updated to ${STATUS_LABELS[r.status]}.`);});
    dialog.addEventListener("close",()=>dialog.remove());
  });
  $("#plan-route-button").addEventListener("click",calculateRoute);
  $("#compliance-weight").addEventListener("input",()=>$("#weight-value").textContent=Number($("#compliance-weight").value).toFixed(1));
  $("#zones-table").addEventListener("click",e=>{
    const b=e.target.closest("[data-zone-save]");if(!b)return;
    const z=zoneById(b.dataset.zoneSave),input=$(`[data-zone-input="${b.dataset.zoneSave}"]`);
    if(!z||!input)return;
    const v=Number(input.value);if(!Number.isFinite(v)||v<0||v>100){toast("Compliance must be between 0 and 100.","error");return;}
    z.compliance=v/100;saveLocal();renderZones();renderOverview();toast(`${z.name} compliance updated.`);
  });
  $("#save-api-button").addEventListener("click",()=>{
    const key=$("#api-key").value.trim(),model=$("#gemini-model").value.trim();
    if(!key){toast("Enter a Gemini API key first.","error");return;}
    if(!model){toast("Enter a model ID.","error");return;}
    sessionStorage.setItem("ecosort.geminiKey",key);sessionStorage.setItem("ecosort.geminiModel",model);
    $("#api-key").value="";$("#api-message").textContent="Key saved for this browser session. It is not written to the project files.";$("#api-message").className="inline-message success";$("#mode-status").textContent="Gemini key configured";toast("Gemini settings saved for this session.");
  });
  $("#clear-api-button").addEventListener("click",()=>{sessionStorage.removeItem("ecosort.geminiKey");sessionStorage.removeItem("ecosort.geminiModel");$("#api-key").value="";$("#api-message").textContent="API key cleared from session storage." ;$("#api-message").className="inline-message success";$("#mode-status").textContent="Demo data active";toast("API key cleared.");});
  $("#reset-data-button").addEventListener("click",()=>{
    if(!confirm("Reset local requests and zone values to the original JSON demo data?"))return;
    state.requests=structuredClone(state.initialRequests);state.zones=state.defaultZones.map(z=>({...z}));saveLocal();renderOverview();renderRequests();renderZones();toast("Demo data reset.");
  });
}
async function init() {
  try {
    const [zones,graph,policies,requests]=await Promise.all([loadJson("./data/zones.json"),loadJson("./data/graph.json"),loadJson("./data/policies.json"),loadJson("./data/requests.json")]);
    state.zones=zones;state.defaultZones=structuredClone(zones);state.graph=graph;state.policies=policies;state.initialRequests=requests;state.requests=structuredClone(requests);
    loadLocal();
    $("#depot-select").innerHTML=graph.nodes.filter(n=>n.type==="depot"||n.type==="junction").map(n=>`<option value="${n.id}" ${n.id===graph.depot?"selected":""}>${escapeHtml(n.name)}</option>`).join("");
    bindEvents();renderOverview();renderRequests();renderZones();
    if(sessionStorage.getItem("ecosort.geminiKey"))$("#mode-status").textContent="Gemini key configured";
    setPage("overview");
  } catch(e) {
    document.body.innerHTML=`<main style="font:16px sans-serif;max-width:720px;margin:10vh auto;padding:24px;color:#20392d"><h1>EcoSort AI could not load its JSON data</h1><p>${escapeHtml(e.message)}</p><p>Start a local static server in the project folder (for example, VS Code Live Server or <code>python -m http.server 8000</code>) and open <code>http://localhost:8000</code>.</p></main>`;
  }
}
init();
