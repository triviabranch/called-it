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
  if (/goal.?kick/.test(kind)) return "goal-kick";
  if (item?.scoringPlay || /(^|[- ])(goal|score)(?![- ]?kick)/.test(kind)) return "goal";
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
  if (/goal kick/.test(text)) return "goal-kick";
  if (/(scores|scored|penalty kick goal|own goal|goal!)/.test(text) && !/goal kick/.test(text)) return "goal";
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
function normaliseCommentary(item, index) { const play = item?.play || item; return normaliseEvent({ ...play, clock: play.clock || item.time, text: item.text || play.text || play.shortText }, index, "commentary"); }
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
      const commentary = (data.commentary || []).map(normaliseCommentary);
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
    if (url.pathname === "/api/room" && request.method === "POST") { const id = env.MATCH_ROOM.newUniqueId(); return env.MATCH_ROOM.get(id).fetch(new Request("https://room/create", { method: "POST", body: await request.text(), headers: { "content-type": "application/json" } })); }
    if (url.pathname.startsWith("/api/room/")) { try { return env.MATCH_ROOM.get(env.MATCH_ROOM.idFromString(url.pathname.split("/").pop())).fetch(request); } catch { return new Response("Invalid room", { status: 400 }); } }
    if (url.pathname === "/play") { const target = new URL("/game.html", request.url); target.search = url.search; return env.ASSETS.fetch(new Request(target, request)); }
    if (url.pathname === "/test" || url.pathname === "/test/") return env.ASSETS.fetch(new Request(new URL("/test/index.html", request.url), request));
    return env.ASSETS.fetch(request);
  }
};
export class MatchRoom {
  constructor(state, env) { this.state = state; this.env = env; this.sockets = new Set(); this.room = null; }
  async fetch(request) {
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair(); this.state.acceptWebSocket(pair[1]); this.sockets.add(pair[1]);
      if (!this.room) await this.load(); pair[1].send(JSON.stringify({ type: "state", state: this.public() }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (request.method === "POST" && !this.room) {
      await this.load();
      try {
        const input = await request.json();
        if (input.fixture) {
          this.room.fixture = input.fixture;
          this.room.provider = { name: "ESPN", league: input.league || "eng.1", eventId: input.fixture.id, error: null };
          this.room.timeline = (input.events || []).filter(e => e && e.offset != null).map(e => ({ id: String(e.id), type: e.type, offset: Number(e.offset), minute: e.minute, text: e.text, team: e.team || null })); this.room.mode = input.mode === "simulation" ? "simulation" : "live"; this.room.speed = Math.max(1, Math.min(50, Number(input.speed) || 1)); this.room.preMatch = this.buildPreMatch();
        }
      } catch {}
      await this.save(); return Response.json({ roomId: this.state.id.toString(), state: this.public() });
    }
    return new Response("Room unavailable", { status: 404 });
  }
  async load() {
    this.room = await this.state.storage.get("room") || {
      createdAt: Date.now(), lastActivity: Date.now(), fixture: null, provider: { name: "ESPN", league: "eng.1", eventId: null, error: null },
      timeline: [], preMatch: [], mode: "live", speed: 1, session: { status: "lobby", startedAt: null, round: null, clock: 0, speed: 1 }, players: [], predictions: {}, leaderboard: [],
      events: [{ label: "Room opened", detail: "Powered by ESPN" }]
    };
  }
  async save() { this.room.lastActivity = Date.now(); await this.state.storage.put("room", this.room); await this.state.storage.setAlarm(Date.now() + 7200000); }
  public() { if (this.room.fixture?.id && !this.room.preMatch?.length) this.room.preMatch = this.buildPreMatch(); return { ...this.room, predictions: undefined, playerStatus: Object.fromEntries(this.room.players.map(p => [p.id, Object.keys(this.room.predictions[p.id]?.pre || {})])) }; }
  broadcast() { const m = JSON.stringify({ type: "state", state: this.public() }); for (const ws of this.sockets) { try { ws.send(m); } catch {} } }
  schedule(ms) { this.state.storage.setAlarm(Date.now() + Math.max(250, Math.min(ms, 7200000))); }
  buildPreMatch() {
    const f = this.room.fixture || {}, home = f.home?.name || "Home", away = f.away?.name || "Away";
    return [
      { id: "first-goal-team", type: "first-goal-team", question: "Which team scores first?", choices: [{ key: "home", label: home }, { key: "away", label: away }], settled: false, result: null },
      { id: "first-goal-kick-time", type: "first-goal-kick-time", question: "What’s the time of the first goal kick?", input: { min: 0, max: 120, step: 1, suffix: "minutes" }, choices: [], settled: false, result: null },
      { id: "first-foul-team", type: "first-foul-team", question: "Which team commits the first foul?", choices: [{ key: "home", label: home }, { key: "away", label: away }], settled: false, result: null }
    ];
  }
  roundFor(target, index) {
    const f = this.room.fixture || {}; const home = f.home?.name || "Home", away = f.away?.name || "Away";
    return { id: "round-" + index, targetEventId: target.id, targetType: target.type, question: "Who gets the next " + target.type.replace("-", " ") + "?", choices: [{ key: "home", label: home }, { key: "away", label: away }], status: "warmup", warmupEndsAt: null, voteEndsAt: null, result: null };
  }
  nextTarget(clock) {
    const types = ["corner", "goal", "card"], minimumGap = clock > 0 ? 600 : 0;
    return this.room.timeline.find(e => e.offset >= clock + minimumGap && types.includes(e.type));
  }
  targetForQuestion(q) { return this.room.timeline.find(e => (q.type === "first-goal-team" && e.type === "goal") || (q.type === "first-goal-kick-time" && e.type === "goal-kick") || (q.type === "first-foul-team" && e.type === "foul")); }
  keyForQuestion(q, target) {
    if (!target) return null;
    if (q.type === "first-goal-kick-time") return String(Math.floor((target.offset || 0) / 60));
    const f = this.room.fixture || {}; return target.team === f.home?.name ? "home" : target.team === f.away?.name ? "away" : null;
  }
  settlePreMatch(clock) {
    let changed = false;
    for (const q of this.room.preMatch || []) {
      if (q.settled) continue; const target = this.targetForQuestion(q);
      if (!target || target.offset > clock) continue;
      const correct = this.keyForQuestion(q, target); q.settled = true; q.result = { correct, event: target.text || "Event occurred" }; changed = true;
      for (const p of this.room.players) { const answer = this.room.predictions[p.id]?.pre?.[q.id]; if (correct && answer === correct) p.points = (p.points || 0) + 100; }
    }
    if (changed) this.rebuildLeaderboard(); return changed;
  }
  rebuildLeaderboard() { this.rebuildLeaderboard(); }
  async startSession() {
    const first = this.nextTarget(0);
    if (!first) { this.room.session.status = "complete"; return; }
    this.room.session = { status: "running", startedAt: Date.now(), round: null, clock: 0, nextRoundIndex: 0, mode: this.room.mode || "live", speed: this.room.mode === "simulation" ? (this.room.speed || 1) : 1 };
    await this.openRound(first, 0);
  }
  async openRound(target, index) {
    const round = this.roundFor(target, index); const now = Date.now();
    const leadMs = Math.max(0, (target.offset - this.room.session.clock) * 1000);
    const speed = this.room.session.speed || 1, warmupSeconds = Math.max(0, leadMs - 40000); round.warmupEndsAt = now + (warmupSeconds * 1000) / speed; round.voteEndsAt = round.warmupEndsAt + (30000 / speed);
    if (leadMs < 40000) round.warmupEndsAt = now;
    this.room.session.round = round; this.room.session.status = "warmup"; this.room.events.unshift({ label: "Prediction warming up", detail: round.question });
    await this.save(); this.broadcast(); this.schedule(Math.max(250, round.warmupEndsAt - now));
  }
  async advance() {
    const s = this.room.session, r = s.round; if (!r) return;
    const now = Date.now(), elapsed = s.holding ? s.clock : (now - s.startedAt) / 1000 * (s.speed || 1);
    s.clock = Math.max(0, elapsed); this.settlePreMatch(s.clock);
    if (r.status === "warmup" && now >= r.warmupEndsAt) { r.status = "voting"; r.voteEndsAt = now + (s.mode === "simulation" ? 10000 : (10000 / (s.speed || 1))); if (s.mode === "simulation") s.holding = true; this.room.events.unshift({ label: "Vote now", detail: r.question }); await this.save(); this.broadcast(); this.schedule(10000); return; }
    if (r.status === "voting" && now >= r.voteEndsAt) { r.status = "locked"; if (s.mode === "simulation") { s.holding = false; s.startedAt = now; } await this.save(); this.broadcast(); this.schedule(Math.max(250, ((this.room.timeline.find(e => e.id === r.targetEventId)?.offset || s.clock) - s.clock) * 1000 / (s.speed || 1))); return; }
    if (r.status === "locked") { const target = this.room.timeline.find(e => e.id === r.targetEventId); if (target && s.clock < target.offset) { this.schedule(Math.max(250, (target.offset - s.clock) * 1000 / (s.speed || 1))); return; } await this.settleRound(r); return; }
    if (r.status === "settled") { const next = this.nextTarget(s.clock); if (next) { s.nextRoundIndex = (s.nextRoundIndex || 0) + 1; await this.openRound(next, s.nextRoundIndex); } else { s.status = "complete"; await this.save(); this.broadcast(); } return; }
    this.schedule(r.status === "warmup" ? r.warmupEndsAt - now : r.voteEndsAt - now);
  }
  async settleRound(round) {
    const target = this.room.timeline.find(e => e.id === round.targetEventId); const correct = target?.team && this.room.fixture ? (target.team === this.room.fixture.home.name ? "home" : target.team === this.room.fixture.away.name ? "away" : null) : null;
    round.result = { correct, event: target?.text || "Event occurred" }; round.status = "settled";
    for (const p of this.room.players) {
      const answer = this.room.predictions[p.id]?.[round.id]; const hit = correct && answer === correct;
      if (hit) p.points = (p.points || 0) + 100;
      if (!p.rounds) p.rounds = 0; if (answer) p.rounds++;
    }
    this.room.leaderboard = [...this.room.players].sort((a,b) => (b.points||0)-(a.points||0)).map((p,i) => ({ rank:i+1, name:p.name, points:p.points||0, rounds:p.rounds||0 }));
    this.room.events.unshift({ label: correct ? "Prediction settled" : "Prediction settled", detail: round.result.event });
    await this.save(); this.broadcast(); this.schedule(1500);
  }
  async webSocketMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch { return; } if (!this.room) await this.load(); this.room.lastActivity = Date.now();
    if (m.type === "join") { let p = this.room.players.find(x => x.id === m.playerId); if (!p) { p = { id: crypto.randomUUID(), name: String(m.name || "Supporter").slice(0,20), points: 0, rounds: 0 }; this.room.players.push(p); } else if (m.name) p.name = String(m.name).slice(0,20); ws.send(JSON.stringify({ type:"identity", playerId:p.id })); }
    if (m.type === "prematch") { const p = this.room.players.find(x => x.id === m.playerId), q = (this.room.preMatch || []).find(x => x.id === m.questionId); if (p && q && !q.settled && ((q.input && Number.isInteger(Number(m.answer)) && Number(m.answer) >= q.input.min && Number(m.answer) <= q.input.max) || q.choices.some(c => c.key === m.answer))) { this.room.predictions[p.id] ||= {}; this.room.predictions[p.id].pre ||= {}; this.room.predictions[p.id].pre[q.id] = String(m.answer); } }
    if (m.type === "start") await this.startSession();
    if (m.type === "predict") { const p = this.room.players.find(x => x.id === m.playerId), r = this.room.session.round; if (p && r?.status === "voting" && Date.now() < r.voteEndsAt && r.id === m.roundId) { this.room.predictions[p.id] ||= {}; this.room.predictions[p.id][r.id] = m.answer; if (this.room.session.mode === "simulation") { r.status = "locked"; this.room.session.holding = false; this.room.session.startedAt = Date.now(); } } }
    await this.save(); this.broadcast();
    if (m.type === "start" || m.type === "predict") this.schedule(500);
  }
  async closeRoom(ws) { this.sockets.delete(ws); if (this.sockets.size === 0) { if (this.room) { await this.state.storage.delete("room"); this.room = null; } await this.state.storage.deleteAlarm(); } }
  async webSocketClose(ws) { await this.closeRoom(ws); }
  async webSocketError(ws) { await this.closeRoom(ws); }
  async alarm() { if (this.sockets.size === 0) { if (this.room) { await this.state.storage.delete("room"); this.room = null; } await this.state.storage.deleteAlarm(); } else { await this.load(); await this.advance(); } }
}
