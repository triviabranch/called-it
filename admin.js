const button = document.querySelector("#refresh-button");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const summary = document.querySelector("#summary");
const coverage = document.querySelector("#coverage");
const blackoutRule = document.querySelector("#blackout-rule");
const saveConfig = document.querySelector("#save-config");
const configStatus = document.querySelector("#config-status");
const competitionList = document.querySelector("#competition-list");
const roomsRefresh = document.querySelector("#rooms-refresh");
const roomsStatus = document.querySelector("#rooms-status");
const roomsTable = document.querySelector("#rooms-table");
const callsTable = document.querySelector("#calls-table");
const modalRoot = document.querySelector("#admin-modal-root");
const esc = value => String(value ?? "").replace(/[&<>\"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#039;" }[c]));
fetch("/api/build-id").then(response => response.json()).then(data => { document.querySelector("#build-id").textContent = data.buildId || "local"; }).catch(() => { document.querySelector("#build-id").textContent = "local"; });

const loadConfig = async () => {
  try {
    const response = await fetch("/api/admin/fixture-config");
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Could not load rules");
    blackoutRule.checked = data.broadcastRules?.ukPremierLeagueSaturdayBlackout !== false;
    competitionList.innerHTML = (data.competitions || []).map(item => { const key = `${item.sport}:${item.league}`; const checked = (data.enabledCompetitions || []).includes(key); return `<label class="competition-toggle"><input type="checkbox" value="${esc(key)}" ${checked ? "checked" : ""}><span><strong>${esc(item.name)}</strong><small>${esc(item.sport)} · ${esc(item.league)}</small></span></label>`; }).join("");
    configStatus.textContent = "Saved rules loaded.";
  } catch (error) { configStatus.textContent = error.message || "Could not load saved rules."; }
};

saveConfig.onclick = async () => {
  saveConfig.disabled = true;
  configStatus.textContent = "Saving…";
  try {
    const response = await fetch("/api/admin/fixture-config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ broadcastRules: { ukPremierLeagueSaturdayBlackout: blackoutRule.checked }, enabledCompetitions: [...competitionList.querySelectorAll("input:checked")].map(input => input.value) }) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Could not save rules");
    configStatus.textContent = "Saved. Run fixture refresh to apply this rule.";
  } catch (error) { configStatus.textContent = error.message || "Could not save rules."; }
  finally { saveConfig.disabled = false; }
};

loadConfig();

let liveRooms = [];
const roomLabel = room => `${room.fixture?.home?.name || "Home"} v ${room.fixture?.away?.name || "Away"}`;
const callStatus = call => call.status === "voting" ? "OPEN" : String(call.status || "—").toUpperCase();
function showRoomModal(room) {
  const calls = room.calls || [];
  modalRoot.innerHTML = `<div class="admin-modal-backdrop" data-modal-close><section class="admin-modal" role="dialog" aria-modal="true" aria-label="Live room details"><div class="admin-section-head"><div><p class="eyebrow">Live room</p><h2>${esc(roomLabel(room))}</h2></div><button class="modal-close" data-modal-close aria-label="Close">×</button></div><div class="modal-meta"><span>${esc(room.session?.status || "—")}</span><span>${room.playerCount || 0} players</span><span>${calls.length} calls</span></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Call</th><th>Status</th><th>Opened</th><th>Outcome</th></tr></thead><tbody>${calls.map(call => `<tr><td>${esc(call.question || call.type || "Call")}</td><td>${callStatus(call)}</td><td>${call.openedAt ? esc(new Date(call.openedAt).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })) : "—"}</td><td>${esc(call.result?.event || "Awaiting match event")}</td></tr>`).join("") || '<tr><td colspan="4">No calls spawned yet.</td></tr>'}</tbody></table></div><p class="modal-note">Last provider poll: ${room.provider?.lastLivePollAt ? esc(new Date(room.provider.lastLivePollAt).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })) : "—"}</p><button class="table-action danger-action" data-kill-room="${esc(room.roomId)}">Kill this room</button></section></div>`;
}
function showCallModal(room, call) {
  modalRoot.innerHTML = `<div class="admin-modal-backdrop" data-modal-close><section class="admin-modal" role="dialog" aria-modal="true" aria-label="Call details"><div class="admin-section-head"><div><p class="eyebrow">Call detail</p><h2>${esc(roomLabel(room))}</h2></div><button class="modal-close" data-modal-close aria-label="Close">×</button></div><p class="modal-call-question">${esc(call.question || call.type || "Call")}</p><div class="modal-meta"><span>${callStatus(call)}</span><span>${call.openedAt ? esc(new Date(call.openedAt).toLocaleString([], { dateStyle:"medium", timeStyle:"short" })) : "Opened time unavailable"}</span></div><div class="modal-result"><span>Outcome</span><strong>${esc(call.result?.event || "Still open — waiting for the match event")}</strong></div></section></div>`;
}
function bindModals() {
  document.querySelectorAll("[data-room]").forEach(button => button.onclick = () => showRoomModal(liveRooms.find(room => room.roomId === button.dataset.room)));
  document.querySelectorAll("[data-call]").forEach(button => { const [roomId, callId] = button.dataset.call.split("::"); button.onclick = () => { const room = liveRooms.find(item => item.roomId === roomId); const call = room?.calls?.find(item => item.id === callId); if (room && call) showCallModal(room, call); }; });
  modalRoot.querySelectorAll("[data-modal-close]").forEach(item => item.onclick = event => { if (event.target === item || item.classList.contains("modal-close")) modalRoot.innerHTML = ""; });
}
async function loadRooms() {
  try {
    const response = await fetch("/api/admin/live-rooms", { cache:"no-store" }), data = await response.json();
    if (!response.ok) throw Error(data.error || "Could not load live rooms");
    liveRooms = data.rooms || [];
    roomsTable.innerHTML = liveRooms.map(room => `<tr><td><strong>${esc(roomLabel(room))}</strong><small>${esc(room.fixture?.competition || room.fixture?.venue || "Live fixture")}</small></td><td>${esc(String(room.session?.status || "—").toUpperCase())}</td><td>${room.playerCount || 0}</td><td>${(room.calls || []).length}</td><td><button class="table-action" data-room="${esc(room.roomId)}">View room</button><button class="table-action danger-action" data-kill-room="${esc(room.roomId)}">Kill</button></td></tr>`).join("") || '<tr><td colspan="5">No live rooms are currently registered.</td></tr>';
    callsTable.innerHTML = liveRooms.flatMap(room => (room.calls || []).map(call => `<tr><td>${esc(roomLabel(room))}</td><td><strong>${esc(call.question || call.type || "Call")}</strong></td><td>${callStatus(call)}</td><td>${esc(call.result?.event || "Awaiting match event")}</td><td><button class="table-action" data-call="${esc(room.roomId)}::${esc(call.id)}">View call</button></td></tr>`)).join("") || '<tr><td colspan="5">No calls have been spawned in live rooms yet.</td></tr>';
    roomsStatus.textContent = `${liveRooms.length} live room${liveRooms.length === 1 ? "" : "s"} · updated ${new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}`;
    bindModals();
    document.querySelectorAll("[data-kill-room]").forEach(button => button.onclick = async event => {
      event.stopPropagation();
      if (!confirm("Kill this room for every connected player?")) return;
      button.disabled = true;
      try {
        const response = await fetch("/api/admin/kill-room", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ roomId:button.dataset.killRoom }) });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "Could not kill room");
        modalRoot.innerHTML = "";
        await loadRooms();
      } catch (error) { button.disabled = false; roomsStatus.textContent = error.message || "Could not kill room"; }
    });
  } catch (error) { roomsStatus.textContent = error.message || "Could not load live rooms."; }
}
roomsRefresh.onclick = loadRooms;
loadRooms();
setInterval(loadRooms, 15000);

button.onclick = async () => {
  button.disabled = true;
  status.textContent = "Refreshing fixtures and validating leagues…";
  try {
    const response = await fetch("/api/admin/refresh-fixtures", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Refresh failed");
    const leagues = Object.values(data.leagueCoverage || {});
    const approved = leagues.filter(league => league.approved).length;
    summary.innerHTML = `<div><b>${data.fixtures?.length || 0}</b><span>fixtures published</span></div><div><b>${approved}/${leagues.length}</b><span>leagues approved</span></div><div><b>${new Date(data.fetchedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</b><span>last fetched</span></div>`;
    coverage.innerHTML = leagues.map(league => `<article class="coverage-row ${league.approved ? "approved" : "held"}"><div><strong>${esc(league.league)}</strong><span>${esc(league.reason)}</span></div><b>${league.approved ? "READY" : "HELD"}</b><small>${league.sampleSize || 0} matches · ${league.averageEvents || 0} avg events · corners ${league.coverage?.corner || 0}/${league.sampleSize || 0} · fouls ${league.coverage?.foul || 0}/${league.sampleSize || 0} · cards ${league.coverage?.card || 0}/${league.sampleSize || 0}</small></article>`).join("") || "<p>No league results returned.</p>";
    result.hidden = false;
    status.textContent = "Refresh complete.";
  } catch (error) { status.textContent = error.message || "Refresh failed."; }
  finally { button.disabled = false; }
};
