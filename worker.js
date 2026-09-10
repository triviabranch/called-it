const ESPN_SITE = "https://site.web.api.espn.com/apis/site/v2/sports/soccer";
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/soccer/leagues";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
}
function leaguePath(league) { return encodeURIComponent((league || "eng.1").trim().toLowerCase()); }
async function readJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json, text/plain, */*", "accept-language": "en-GB,en;q=0.9", "origin": "https://www.espn.com", "referer": "https://www.espn.com/", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "x-requested-with": "XMLHttpRequest" } });
  if (!response.ok) throw new Error(`ESPN returned ${response.status}`);
  return response.json();
}
async function readCorePlays(baseUrl) {
  const first = await readJson(`${baseUrl}/plays?limit=300&page=1`);
  const pageCount = Math.min(Number(first.pageCount || 1), 10);
  const pages = await Promise.all(Array.from({ length: pageCount - 1 }, (_, i) => readJson(`${baseUrl}/plays?limit=300&page=${i + 2}`)));
  return { ...first, items: [ ...(first.items || []), ...pages.flatMap(page => page.items || []) ] };
}
function fixture(item) {
  const competition = item?.competitions?.[0] || {};
  const teams = competition.competitors || [];
  const home = teams.find(t => t.homeAway === "home") || teams[0] || {};
  const away = teams.find(t => t.homeAway === "away") || teams[1] || {};
  return { id: String(item.id), name: item.name || `${home.team?.displayName || "Home"} v ${away.team?.displayName || "Away"}`, date: item.date, status: item.status?.type?.shortDetail || item.status?.type?.detail || item.status?.type?.name || "Scheduled", state: item.status?.type?.state || "pre", home: { name: home.team?.displayName || "Home", abbr: home.team?.abbreviation || "", score: home.score ?? null, logo: home.team?.logo || null }, away: { name: away.team?.displayName || "Away", abbr: away.team?.abbreviation || "", score: away.score ?? null, logo: away.team?.logo || null }, venue: competition.venue?.fullName || competition.venue?.address?.city || null };
}
function eventClock(item) {
  const value = Number(item?.clock?.value);
  const display = item?.clock?.displayValue || item?.displayValue || item?.time?.displayValue || "";
  let seconds = Number.isFinite(value) ? value : null;
  if (seconds == null) {
    const match = String(display).match(/(\d+)\s*:\s*(\d{1,2})/);
    if (match) seconds = Number(match[1]) * 60 + Number(match[2]);
  }
  if (seconds == null) {
    const minute = Number(item?.minute ?? item?.time?.minute);
    seconds = Number.isFinite(minute) ? minute * 60 : null;
  }
  const period = Number(item?.period?.number || item?.period?.id || 1);
  return seconds != null && period > 1 && seconds < 2700 ? seconds + (period - 1) * 2700 : seconds;
}
function eventType(item) {
  const kind = String(item?.type?.type || item?.type?.name || "").toLowerCase();
  if (item?.scoringPlay || /goal|score/.test(kind)) return "goal";
  if (item?.redCard || /red.?card|sent.?off/.test(kind)) return "card";
  if (item?.yellowCard || /yellow.?card|caution|booking/.test(kind)) return "card";
  if (item?.substitution || /substitut/.test(kind)) return "substitution";
  if (/corner/.test(kind)) return "corner";
  if (/foul|free.?kick/.test(kind)) return "foul";
  if (/offside/.test(kind)) return "offside";
  if (/shot|save|miss|block/.test(kind)) return "shot";
  if (/var|video/.test(kind)) return "var";
  if (/kickoff|kick.?off|halftime|half.?time|full.?time|match.?end/.test(kind)) return "phase";
  const text = [item?.type?.text, item?.type?.name, item?.text, item?.shortText, item?.description, item?.detail].filter(Boolean).join(" ").toLowerCase();
  if (/goal|scores|scored|penalty kick goal|own goal/.test(text)) return "goal";
  if (/corner/.test(text)) return "corner";
  if (/foul|free kick/.test(text)) return "foul";
  if (/yellow card|red card|caution|booking|sent off/.test(text)) return "card";
  if (/substitut|replaced by/.test(text)) return "substitution";
  if (/offside/.test(text)) return "offside";
  if (/shot|save|missed|blocked/.test(text)) return "shot";
  if (/var|video review/.test(text)) return "var";
  return "other";
}
function normaliseEvent(item, index, source) {
  const offset = eventClock(item);
  return { id: String(item?.id || `${source}-${index}`), source, type: eventType(item), offset, minute: offset == null ? null : Math.floor(offset / 60), period: item?.period?.number || item?.period?.displayValue || null, text: item?.text || item?.shortText || item?.description || item?.detail || item?.type?.text || "Match update", athletes: (item?.participants || item?.athletes || []).map(p => p?.athlete?.displayName || p?.displayName).filter(Boolean), team: item?.team?.displayName || item?.team?.shortDisplayName || null, raw: item };
}
function normaliseCorePlay(item, index) { return normaliseEvent({ ...item, text: item.text || item.shortText || item.alternativeText || item.type?.text }, index, "core-play"); }
function meaningful(item) { return eventType(item) !== "other"; }

async function espnApi(url) {
  try {
    const bits = url.pathname.split("/").filter(Boolean);
    const league = url.searchParams.get("league") || "eng.1";
    const slug = leaguePath(league);
    if (url.pathname === "/api/espn/fixtures") {
      const date = url.searchParams.get("date");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return json({ error: "date must be YYYY-MM-DD" }, 400);
      const data = await readJson(`${ESPN_SITE}/${slug}/scoreboard?dates=${date.replaceAll("-", "")}`);
      return json({ provider: "ESPN", league, date, fixtures: (data.events || []).map(fixture), raw: data });
    }
    if (bits[2] === "match" && bits[3]) {
      const id = bits[3];
      const summaryUrl = `${ESPN_SITE}/${slug}/summary?event=${encodeURIComponent(id)}`;
      const coreBase = `${ESPN_CORE}/${slug}/events/${encodeURIComponent(id)}/competitions/${encodeURIComponent(id)}`;
      const [summary, plays, situation, probabilities] = await Promise.allSettled([
        readJson(summaryUrl),
        readCorePlays(coreBase),
        readJson(`${coreBase}/situation`),
        readJson(`${coreBase}/probabilities?limit=300`)
      ]);
      if (summary.status === "rejected") throw summary.reason;
      const data = summary.value;
      const competition = data.header?.competitions?.[0] || data.competitions?.[0] || {};
      const f = fixture({ id, name: competition.shortName || competition.name, date: competition.date, competitions: [{ ...competition, competitors: competition.competitors || [] }], status: competition.status });
      const coreItems = plays.status === "fulfilled" ? (plays.value.items || plays.value.plays || []) : [];
      const summaryPlays = (data.plays || []).map((p, i) => normaliseEvent(p, i, "summary-play"));
      const commentary = (data.commentary || []).map((p, i) => normaliseEvent(p, i, "commentary"));
      const primary = coreItems.length ? coreItems.filter(meaningful).map(normaliseCorePlay) : summaryPlays.filter(e => e.type !== "other");
      const seen = new Set();
      const events = [...primary, ...commentary].filter(e => {
        const key = `${e.type}|${e.offset}|${e.text}`;
        if (seen.has(key)) return false;
        seen.add(key); return e.offset != null;
      }).sort((a, b) => a.offset - b.offset || a.id.localeCompare(b.id));
      return json({ provider: "ESPN", league, eventId: id, fixture: f, events, sources: { summary: "site-api", plays: plays.status === "fulfilled" ? "core-api" : "summary-fallback", situation: situation.status === "fulfilled", probabilities: probabilities.status === "fulfilled" }, related: { summary: data, plays: plays.status === "fulfilled" ? plays.value : { error: plays.reason?.message }, situation: situation.status === "fulfilled" ? situation.value : { error: situation.reason?.message }, probabilities: probabilities.status === "fulfilled" ? probabilities.value : { error: probabilities.reason?.message } } });
    }
  } catch (error) { return json({ error: error.message || "ESPN request failed" }, 502); }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/espn/")) { const response = await espnApi(url); if (response) return response; }
    if (url.pathname === "/api/room" && request.method === "POST") { const id = env.MATCH_ROOM.newUniqueId(); return env.MATCH_ROOM.get(id).fetch(new Request("https://room/create", { method: "POST" })); }
    if (url.pathname.startsWith("/api/room/")) { try { return env.MATCH_ROOM.get(env.MATCH_ROOM.idFromString(url.pathname.split("/").pop())).fetch(request); } catch { return new Response("Invalid room", { status: 400 }); } }
    if (url.pathname === "/play") return env.ASSETS.fetch(new Request(new URL("/game.html", request.url), request));
    if (url.pathname === "/test" || url.pathname === "/test/") return env.ASSETS.fetch(new Request(new URL("/test/index.html", request.url), request));
    return env.ASSETS.fetch(request);
  }
};
export class MatchRoom {
  constructor(state, env) { this.state = state; this.env = env; this.sockets = new Set(); this.room = null; }
  async fetch(request) {
    if (request.headers.get("Upgrade") === "websocket") { const pair = new WebSocketPair(); this.state.acceptWebSocket(pair[1]); this.sockets.add(pair[1]); if (!this.room) await this.load(); pair[1].send(JSON.stringify({ type: "state", state: this.public() })); return new Response(null, { status: 101, webSocket: pair[0] }); }
    if (request.method === "POST" && !this.room) { await this.load(); await this.save(); return Response.json({ roomId: this.state.id.toString(), state: this.public() }); }
    return new Response("Room unavailable", { status: 404 });
  }
  async load() { this.room = await this.state.storage.get("room") || { createdAt: Date.now(), lastActivity: Date.now(), home: "Arsenal", away: "Chelsea", score: [0, 0], status: "PRE", players: [], predictions: {}, events: [{ label: "Room opened", detail: "Powered by ESPN" }], provider: { name: "ESPN", league: "eng.1", eventId: null, error: null } }; }
  async save() { this.room.lastActivity = Date.now(); await this.state.storage.put("room", this.room); await this.state.storage.setAlarm(Date.now() + 7200000); }
  public() { return { ...this.room, predictions: undefined }; }
  broadcast() { const m = JSON.stringify({ type: "state", state: this.public() }); for (const ws of this.sockets) { try { ws.send(m); } catch {} } }
  async updateESPN() { try { const data = await readJson("eng.1/scoreboard"); const e = data.events?.find(x => x.status?.type?.state === "in") || data.events?.[0]; if (!e) throw Error("No current ESPN event"); const teams = e.competitions?.[0]?.competitors || [], h = teams.find(x => x.homeAway === "home"), a = teams.find(x => x.homeAway === "away"); this.room.home = h?.team?.displayName || this.room.home; this.room.away = a?.team?.displayName || this.room.away; this.room.score = [Number(h?.score || 0), Number(a?.score || 0)]; this.room.status = e.status?.type?.shortDetail || e.status?.type?.name || this.room.status; this.room.provider.eventId = e.id; this.room.provider.error = null; this.room.events.unshift({ label: "ESPN update", detail: this.room.status }); } catch (err) { this.room.provider.error = err.message; } }
  async webSocketMessage(ws, raw) { let m; try { m = JSON.parse(raw); } catch { return; } if (!this.room) await this.load(); this.room.lastActivity = Date.now(); if (m.type === "join") { const p = { id: crypto.randomUUID(), name: (m.name || "Supporter").slice(0, 20), points: 0 }; this.room.players.push(p); this.room.events.unshift({ label: p.name + " joined", detail: "Ready to call it" }); } if (m.type === "refresh") await this.updateESPN(); await this.save(); this.broadcast(); }
  async closeRoom(ws) { this.sockets.delete(ws); if (this.sockets.size === 0) { if (this.room) { await this.state.storage.delete("room"); this.room = null; } await this.state.storage.deleteAlarm(); } }
  async webSocketClose(ws) { await this.closeRoom(ws); }
  async webSocketError(ws) { await this.closeRoom(ws); }
  async alarm() { if (this.sockets.size === 0) { if (this.room) { await this.state.storage.delete("room"); this.room = null; } await this.state.storage.deleteAlarm(); } else await this.state.storage.setAlarm(Date.now() + 7200000); }
}
