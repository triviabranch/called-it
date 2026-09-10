let ws,roomId,state,playerId,role;
const app=document.querySelector("#app"), q=new URLSearchParams(location.search);
const esc=v=>String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function connect(){ws=new WebSocket((location.protocol==="https:"?"wss":"ws")+"://"+location.host+"/api/room/"+roomId);ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==="identity"){playerId=m.playerId;localStorage.setItem("calledItPlayer:"+roomId,playerId)}if(m.state){state=m.state;render()}}}
function send(m){if(ws?.readyState===1)ws.send(JSON.stringify(m))}
function clock(s){s=Math.max(0,Math.floor(s||0));return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0")}
function render(){
 if(!state)return;
 const f=state.fixture||{home:{name:"Home"},away:{name:"Away"}}, r=state.session?.round, me=(state.players||[]).find(p=>p.id===playerId);
 const now=Date.now(), remaining=r?.status==="warmup"?Math.max(0,Math.ceil((r.warmupEndsAt-now)/1000)):r?.status==="voting"?Math.max(0,Math.ceil((r.voteEndsAt-now)/1000)):0;
 const answers=r?.choices||[];
 app.innerHTML='<header class="brand">CALLED IT <span class="room">'+esc(state.session?.status||"LOBBY")+'</span></header>'+
 '<div class="eyebrow">LIVE PREDICTION ROOM · ESPN</div><h1>'+esc(f.home?.name)+' <i>'+(f.home?.score??"–")+' — '+(f.away?.score??"–")+'</i> '+esc(f.away?.name)+'</h1>'+
 '<p class="muted">'+(state.provider?.eventId?"ESPN event "+esc(state.provider.eventId):"Waiting for fixture")+' · match clock '+clock(state.session?.clock)+'</p>'+
 (state.session?.status==="lobby"?'<section class="card"><h2>Join this room</h2><input id="name" placeholder="Your name" maxlength="20"><button id="join">Join match</button>'+(role==="host"?' <button class="secondary" id="start">Start session</button>':'')+'</section>':
 '<section class="card live-card '+(r?.status==="voting"?"hot":"")+'"><div class="phase">'+esc(r?.status||"LIVE")+'</div><h2>'+esc(r?.question||"Watching the match")+'</h2><p class="countdown">'+(r?.status==="warmup"?"Get ready · "+remaining+"s":r?.status==="voting"?"CALL NOW · "+remaining+"s":r?.status==="settled"?"Settled":"Waiting")+'</p>'+
 '<div class="answers">'+answers.map(a=>'<button class="answer" data-answer="'+esc(a.key)+'">'+esc(a.label)+'</button>').join("")+'</div>'+
 (r?.result?'<p class="result"><b>Result:</b> '+esc(r.result.event)+' · correct call: '+esc(r.result.correct||"unavailable")+'</p>':'')+'</section>')+
 '<section class="card"><h2>Leaderboard</h2><div class="leaders">'+(state.leaderboard||[]).map(p=>'<div><b>#'+p.rank+' '+esc(p.name)+'</b><span>'+p.points+' pts · '+p.rounds+' calls</span></div>').join("")||'<p class="muted">Players appear here after joining.</p>'+'</div></section>'+
 '<section class="card"><h2>Room activity</h2>'+(state.events||[]).slice(0,5).map(e=>'<div class="event"><b>'+esc(e.label)+'</b><br><span class="muted">'+esc(e.detail)+'</span></div>').join("")+'</section>';
 const join=document.querySelector("#join"); if(join)join.onclick=()=>{const name=document.querySelector("#name").value||"Supporter";send({type:"join",name});join.disabled=true};
 const start=document.querySelector("#start"); if(start)start.onclick=()=>send({type:"start"});
 document.querySelectorAll("[data-answer]").forEach(b=>b.onclick=()=>send({type:"predict",playerId,roundId:r?.id,answer:b.dataset.answer}));
 if(r?.status==="warmup"||r?.status==="voting"){if(r?.status==="voting"&&navigator.vibrate)navigator.vibrate([120,80,120]);setTimeout(render,1000)}
}
async function boot(){roomId=q.get("room");role=q.get("role")||"player";if(!roomId){const r=await fetch("/api/room",{method:"POST"}),d=await r.json();roomId=d.roomId;history.replaceState({}, "","/play?room="+roomId)}playerId=localStorage.getItem("calledItPlayer:"+roomId);connect()}
boot();