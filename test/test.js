const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const state = { date: new Date().toISOString().slice(0,10), league: "eng.1", fixtures: [], fixture: null, match: null, speed: 1, filter: "all", started: false, paused: false, released: new Set(), timer: null, startedAt: 0, pausedAt: 0, elapsedBeforePause: 0 };

$("#dateInput").value = state.date;
const api = async (path) => { const r = await fetch(path); const d = await r.json(); if (!r.ok) throw Error(d.error || "Request failed"); return d; };
function openSetup() { $("#setupLayer").classList.remove("hidden"); $("#setupModal").classList.remove("hidden"); $("#fixturesModal").classList.add("hidden"); }
function closeSetup() { $("#setupLayer").classList.add("hidden"); }
function showError(el, message) { el.textContent = message || ""; }
function formatDate(value) { return new Date(value).toLocaleDateString(undefined, { day:"numeric", month:"short", year:"numeric" }); }
function formatClock(seconds) { const s = Math.max(0, Math.floor(seconds)); return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`; }
function formatOffset(seconds) { return seconds == null ? "—" : `${Math.floor(seconds/60)}'${String(Math.floor(seconds%60)).padStart(2,"0")}`; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c])); }

$("#openSetup").onclick = openSetup;
$$("[data-close]").forEach(b => b.onclick = closeSetup);
$("#backSetup").onclick = () => { $("#fixturesModal").classList.add("hidden"); $("#setupModal").classList.remove("hidden"); };

$("#setupForm").onsubmit = async (e) => {
  e.preventDefault(); const date = $("#dateInput").value; const league = $("#leagueInput").value.trim();
  showError($("#setupError"), "Pulling ESPN programme…");
  try {
    const data = await api(`/api/espn/fixtures?date=${encodeURIComponent(date)}&league=${encodeURIComponent(league)}`);
    state.date = date; state.league = league; state.fixtures = data.fixtures || [];
    $("#fixtureHeading").textContent = `${formatDate(date)} · ${league}`;
    $("#setupModal").classList.add("hidden"); $("#fixturesModal").classList.remove("hidden"); renderFixtures();
    showError($("#setupError"), "");
  } catch (err) { showError($("#setupError"), err.message); }
};

function renderFixtures() {
  const target = $("#fixtures");
  if (!state.fixtures.length) { target.innerHTML = '<div class="empty">ESPN returned no fixtures for this date and competition.</div>'; return; }
  target.innerHTML = state.fixtures.map(f => `<button class="fixture" data-id="${escapeHtml(f.id)}"><span><strong>${escapeHtml(f.home.name)} v ${escapeHtml(f.away.name)}</strong><small>${escapeHtml(f.status)}${f.venue ? " · " + escapeHtml(f.venue) : ""}</small></span><b>${f.home.score ?? "–"} — ${f.away.score ?? "–"}</b></button>`).join("");
  $$(".fixture").forEach(b => b.onclick = () => selectFixture(b.dataset.id));
}

async function selectFixture(id) {
  const f = state.fixtures.find(x => x.id === id); if (!f) return;
  showError($("#fixtureError"), "Pulling match summary and related data…");
  try { state.fixture = f; state.match = await api(`/api/espn/match/${encodeURIComponent(id)}?league=${encodeURIComponent(state.league)}`); closeSetup(); renderMatch(); $("#intro").classList.add("hidden"); $("#playback").classList.remove("hidden"); showError($("#fixtureError"), ""); }
  catch (err) { showError($("#fixtureError"), err.message); }
}

function renderMatch() {
  const f = state.match.fixture || state.fixture; const events = state.match.events || [];
  $("#matchTitle").textContent = `${f.home.name} v ${f.away.name}`; $("#matchMeta").textContent = `${formatDate(f.date || state.date)} · ${state.league} · ${events.length} timestamped updates`;
  $("#homeName").textContent = f.home.name; $("#awayName").textContent = f.away.name; $("#homeScore").textContent = f.home.score ?? "–"; $("#awayScore").textContent = f.away.score ?? "–";
  $("#rawData").textContent = JSON.stringify(state.match.raw, null, 2); resetReplay();
}
function resetReplay() { state.started=false; state.paused=false; state.released=new Set(); state.elapsedBeforePause=0; if(state.timer) cancelAnimationFrame(state.timer); $("#matchClock").textContent="00:00"; $("#cueStatus").textContent="Ready for kick-off cue"; $("#pause").disabled=true; $("#pause").textContent="Pause"; $("#printerCount").textContent="0 RELEASED"; $("#printer").innerHTML='<div class="empty">Form the kick-off cue to begin the replay.</div>'; }
function renderPrinter() {
  const events = (state.match?.events || []).filter(e => state.filter === "all" || e.type === state.filter);
  const visible = events.filter(e => state.released.has(e.id));
  $("#printerCount").textContent = `${visible.length} RELEASED`;
  $("#printer").innerHTML = visible.length ? visible.map(e => `<div class="print-line"><span class="time">${formatOffset(e.offset)}</span><span class="tag">${escapeHtml(e.type)}</span><span class="detail">${escapeHtml(e.text)}${e.team ? ` <strong>· ${escapeHtml(e.team)}</strong>` : ""}</span></div>`).join("") : '<div class="empty">No updates match this filter yet.</div>';
  $("#printer").scrollTop = $("#printer").scrollHeight;
}
function tick(now) {
  if (!state.started || state.paused) return;
  const elapsed = (now - state.startedAt) / 1000 * state.speed + state.elapsedBeforePause;
  $("#matchClock").textContent = formatClock(elapsed);
  const events = state.match.events || [];
  events.filter(e => e.offset != null && e.offset <= elapsed).forEach(e => state.released.add(e.id));
  renderPrinter();
  if (events.some(e => e.offset != null && !state.released.has(e.id))) state.timer = requestAnimationFrame(tick);
  else { state.paused=true; $("#pause").disabled=true; $("#cueStatus").textContent="Replay complete"; }
}
$("#kickoff").onclick = () => { state.started=true; state.paused=false; state.elapsedBeforePause=0; state.startedAt=performance.now(); $("#kickoff").disabled=true; $("#pause").disabled=false; $("#cueStatus").textContent=`Kick-off cue formed · ${state.speed}×`; state.timer=requestAnimationFrame(tick); };
$("#pause").onclick = () => { if(!state.started)return; if(!state.paused){ state.elapsedBeforePause=(performance.now()-state.startedAt)/1000*state.speed+state.elapsedBeforePause; state.paused=true; $("#pause").textContent="Resume"; $("#cueStatus").textContent="Replay paused"; } else { state.paused=false; state.startedAt=performance.now(); $("#pause").textContent="Pause"; $("#cueStatus").textContent=`Replay running · ${state.speed}×`; state.timer=requestAnimationFrame(tick); } };
$("#reset").onclick = resetReplay;
$("#changeMatch").onclick = () => { $("#playback").classList.add("hidden"); $("#intro").classList.remove("hidden"); openSetup(); };
$$("[data-speed]").forEach(b => b.onclick = () => { state.speed=Number(b.dataset.speed); $$(".speed-row button").forEach(x=>x.classList.toggle("selected",x===b)); if(state.started&&!state.paused){ state.elapsedBeforePause=(performance.now()-state.startedAt)/1000*state.speed+state.elapsedBeforePause; state.startedAt=performance.now(); } $("#cueStatus").textContent = state.started ? `Replay running · ${state.speed}×` : `Ready for kick-off cue · ${state.speed}×`; });
$$("[data-filter]").forEach(b => b.onclick = () => { state.filter=b.dataset.filter; $$(".filter-row button").forEach(x=>x.classList.toggle("selected",x===b)); renderPrinter(); });
