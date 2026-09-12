const ESPN_SITE_ROOT = "https://site.web.api.espn.com/apis/site/v2/sports";
const ESPN_CORE_ROOT = "https://sports.core.api.espn.com/v2/sports";
const SUPPORTED_COMPETITIONS = [
  { sport: "soccer", league: "eng.1", name: "Premier League", order: 0 },
  { sport: "soccer", league: "eng.2", name: "Championship", order: 1 },
  { sport: "soccer", league: "sco.1", name: "Scottish Premiership", order: 2 },
  { sport: "soccer", league: "esp.1", name: "LaLiga", order: 3 },
  { sport: "soccer", league: "ger.1", name: "Bundesliga", order: 4 },
  { sport: "soccer", league: "ita.1", name: "Serie A", order: 5 },
  { sport: "soccer", league: "fra.1", name: "Ligue 1", order: 6 },
  { sport: "soccer", league: "usa.1", name: "MLS", order: 7 },
  { sport: "soccer", league: "aus.1", name: "A-League Men", order: 8 },
  { sport: "rugby-league", league: "3", name: "NRL", order: 9 }
];
const SUPPORTED_LEAGUES = SUPPORTED_COMPETITIONS.map(item => item.league);
const LEAGUE_HIERARCHY = Object.fromEntries(SUPPORTED_COMPETITIONS.map(item => [item.league, item.order]));
const LEAGUE_NAMES = Object.fromEntries(SUPPORTED_COMPETITIONS.map(item => [item.league, item.name]));
const COMPETITION_KEYS = SUPPORTED_COMPETITIONS.map(item => `${item.sport}:${item.league}`);
const DEFAULT_ENABLED_COMPETITIONS = SUPPORTED_COMPETITIONS.filter(item => item.sport === "soccer").map(item => `${item.sport}:${item.league}`);
function competitionConfig(sport, league) {
  return SUPPORTED_COMPETITIONS.find(item => item.sport === sport && item.league === league)
    || SUPPORTED_COMPETITIONS.find(item => item.league === league)
    || SUPPORTED_COMPETITIONS[0];
}
function normaliseEnabledCompetitions(values) {
  const selected = Array.isArray(values) ? values : DEFAULT_ENABLED_COMPETITIONS;
  return [...new Set(selected)].filter(key => COMPETITION_KEYS.includes(key));
}
function siteBase(sport) { return `${ESPN_SITE_ROOT}/${encodeURIComponent(sport)}`; }
function coreBase(sport, league) { return `${ESPN_CORE_ROOT}/${encodeURIComponent(sport)}/leagues/${leaguePath(league)}`; }
const DEFAULT_BROADCAST_RULES = { ukPremierLeagueSaturdayBlackout: true };
const LIVE_CALL_DELAY_MIN_MS = 7 * 60 * 1000;
const LIVE_CALL_DELAY_MAX_MS = 8 * 60 * 1000;
const nextLiveCallAt = () => Date.now() + LIVE_CALL_DELAY_MIN_MS + Math.random() * (LIVE_CALL_DELAY_MAX_MS - LIVE_CALL_DELAY_MIN_MS);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
}
function leaguePath(league) { return encodeURIComponent((league || "eng.1").trim().toLowerCase()); }
async function readJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json, text/plain, */*", "accept-language": "en-GB,en;q=0.9", "origin": "https://www.espn.com", "referer": "https://www.espn.com/", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "x-requested-with": "XMLHttpRequest", "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "cross-site", 'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"', "sec-ch-ua-mobile": "?0", 'sec-ch-ua-platform': '"Windows"' } });
  if (!response.ok) throw new Error(`ESPN returned ${response.status}`);
  return response.json();
}
async function readCorePlays(baseUrl) {
  const first = await readJson(`${baseUrl}/plays?limit=300&page=1&lang=en&region=us`);
  const pageCount = Math.min(Number(first.pageCount || 1), 10);
  const pages = await Promise.all(Array.from({ length: pageCount - 1 }, (_, i) => readJson(`${baseUrl}/plays?limit=300&page=${i + 2}&lang=en&region=us`)));
  return { ...first, items: [ ...(first.items || []), ...pages.flatMap(page => page.items || []) ] };
}
async function readCorePlayPage(baseUrl) { return readJson(`${baseUrl}/plays?limit=300&page=1`); }
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
    const config = competitionConfig(null, league), slug = leaguePath(config.league), sport = config.sport;
    if (url.pathname === "/api/espn/fixtures") {
      const date = url.searchParams.get("date");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return json({ error: "date must be YYYY-MM-DD" }, 400);
      const data = await readJson(`${siteBase(sport)}/${slug}/scoreboard?dates=${date.replaceAll("-", "")}`);
      return json({ provider: "ESPN", league, date, fixtures: (data.events || []).map(item => ({ ...fixture(item), sport, league: config.league, competition: config.name || config.league })), raw: data });
    }
    if (bits[2] === "match" && bits[3]) {
      const id = bits[3];
      const summaryUrl = `${siteBase(sport)}/${slug}/summary?event=${encodeURIComponent(id)}`;
      const coreUrl = `${coreBase(sport, slug)}/events/${encodeURIComponent(id)}/competitions/${encodeURIComponent(id)}`;
      const [summary, plays, situation, probabilities] = await Promise.allSettled([
        readJson(summaryUrl),
        readCorePlays(coreUrl),
        readJson(`${coreUrl}/situation`),
        readJson(`${coreUrl}/probabilities?limit=300`)
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

async function validateLeague(sport, league, programme) {
  try {
    const matches = programme.filter(event => event.status?.type?.state === "post").slice(-3);
    const rows = await Promise.all(matches.map(async match => {
      try {
        const config = competitionConfig(sport, league);
        const base = `${coreBase(config.sport, config.league)}/events/${encodeURIComponent(match.id)}/competitions/${encodeURIComponent(match.id)}`;
        const plays = await readJson(`${base}/plays?limit=300&page=1&lang=en&region=us`);
        const events = (plays.items || []).map((item, index) => normaliseEvent(item, index, "coverage-core")).filter(event => event.type !== "other" && event.offset != null);
        return { id: String(match.id), events: events.length, types: [...new Set(events.map(event => event.type))] };
      } catch { return { id: String(match.id), events: 0, types: [] }; }
    }));
    const has = type => rows.filter(row => row.types.includes(type)).length, sampleSize = rows.length;
    const averageEvents = sampleSize ? Math.round(rows.reduce((sum, row) => sum + row.events, 0) / sampleSize) : 0;
    const approved = sampleSize >= 1 && averageEvents >= 1;
    return { sport, league, approved, checkedAt: Date.now(), sampleSize, matchesWithData: rows.filter(row => row.events > 0).length, averageEvents, coverage: { corner: has("corner"), foul: has("foul"), card: has("card"), goal: has("goal"), substitution: has("substitution"), shot: has("shot") }, reason: approved ? "Core feed has timestamped event coverage" : "no timestamped event coverage returned by ESPN" };
  } catch (error) { return { sport, league, approved: false, checkedAt: Date.now(), sampleSize: 0, matchesWithData: 0, averageEvents: 0, coverage: {}, reason: error.message || "coverage check failed" }; }
}
function inUkSaturdayClosedPeriod(value) {
  if (!value) return false;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(value)).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return parts.weekday === "Sat" && minutes >= 14 * 60 + 45 && minutes < 17 * 60 + 15;
}

async function scoreboardEvents(sport, league, start, end) {
  try {
    return (await readJson(`${siteBase(sport)}/${leaguePath(league)}/scoreboard?dates=${start}-${end}`)).events || [];
  } catch {
    const dates = [...new Set([start, end, new Date().toISOString().slice(0, 10).replaceAll("-", "")])];
    const results = await Promise.all(dates.map(date => readJson(`${siteBase(sport)}/${leaguePath(league)}/scoreboard?dates=${date}`)));
    return results.flatMap(result => result.events || []);
  }
}
async function pullFixtures(broadcastRules = DEFAULT_BROADCAST_RULES, enabledCompetitions = DEFAULT_ENABLED_COMPETITIONS) {
  const now = Date.now();
  const enabled = new Set(normaliseEnabledCompetitions(enabledCompetitions));
  const start = new Date(now - 21 * 86400000).toISOString().slice(0, 10).replaceAll("-", "");
  const end = new Date(now + 7 * 86400000).toISOString().slice(0, 10).replaceAll("-", "");
  const programmes = await Promise.allSettled(SUPPORTED_COMPETITIONS.filter(config => enabled.has(`${config.sport}:${config.league}`)).map(async config => ({
    sport: config.sport,
    league: config.league,
    events: await scoreboardEvents(config.sport, config.league, start, end)
  })));
  const coverageResults = await Promise.all(programmes.map(result => result.status === "fulfilled"
    ? validateLeague(result.value.sport, result.value.league, result.value.events)
    : ({ sport: "unknown", league: "unknown", approved: false, checkedAt: Date.now(), sampleSize: 0, matchesWithData: 0, averageEvents: 0, coverage: {}, reason: result.reason?.message || "programme pull failed" })));
  const coverage = Object.fromEntries(coverageResults.map(result => [`${result.sport}:${result.league}`, result]));
  const horizon = now + 2 * 60 * 60 * 1000;
  const fixtures = programmes.flatMap(result => result.status === "fulfilled"
    ? result.value.events.map(item => {
        const config = competitionConfig(result.value.sport, result.value.league);
        return { ...fixture(item), sport: config.sport, league: config.league, competition: config.name };
      })
    : []).filter(f => {
      const kickoff = new Date(f.date || 0).getTime();
      const isLive = f.state === "in";
      const isUpcoming = f.state === "pre" && Number.isFinite(kickoff) && kickoff >= now && kickoff <= horizon;
      const coverageKey = `${f.sport}:${f.league}`;
      return (isLive || isUpcoming) && coverage[coverageKey]?.approved
        && (!broadcastRules.ukPremierLeagueSaturdayBlackout || f.league !== "eng.1" || !inUkSaturdayClosedPeriod(f.date));
    }).sort((a, b) => {
      const byKickoff = new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime();
      if (byKickoff) return byKickoff;
      const byCompetition = (LEAGUE_HIERARCHY[a.league] ?? 999) - (LEAGUE_HIERARCHY[b.league] ?? 999);
      return byCompetition || a.name.localeCompare(b.name);
    });
  return { provider: "ESPN", fixtureIndexVersion: 2, fetchedAt: now, fixtures, leagueCoverage: coverage, broadcastRules, enabledCompetitions: [...enabled], windowMinutes: 120 };
}
async function refreshFixtureIndex(env) {
  const id = env.FIXTURE_INDEX.idFromName("supported-fixtures");
  return env.FIXTURE_INDEX.get(id).fetch("https://fixture-index/refresh", { method: "POST" });
}
async function removeFixtureFromIndex(env, eventId) {
  if (!env?.FIXTURE_INDEX || !eventId) return;
  const id = env.FIXTURE_INDEX.idFromName("supported-fixtures");
  await env.FIXTURE_INDEX.get(id).fetch("https://fixture-index/remove", { method: "POST", body: JSON.stringify({ eventId }), headers: { "content-type": "application/json" } });
}
async function liveFixtures(env) {
  const id = env.FIXTURE_INDEX.idFromName("supported-fixtures");
  let response = await env.FIXTURE_INDEX.get(id).fetch("https://fixture-index/fixtures");
  let data = await response.json();
  const staleIndex = response.status === 404 || Date.now() - Number(data.fetchedAt || 0) > 60000;
  const staleSchema = data.fixtureIndexVersion !== 2 || data.windowMinutes !== 120 || !Array.isArray(data.enabledCompetitions);
  if (staleIndex || staleSchema) { await refreshFixtureIndex(env); response = await env.FIXTURE_INDEX.get(id).fetch("https://fixture-index/fixtures"); data = await response.json(); }
  const now = Date.now(), horizon = now + 2 * 60 * 60 * 1000, staleCutoff = now - 5 * 3600000;
  data.fixtures = (data.fixtures || []).filter(item => {
    const kickoff = new Date(item.date || 0).getTime();
    const isLive = item.state === "in" && kickoff > staleCutoff;
    const isUpcoming = item.state === "pre" && Number.isFinite(kickoff) && kickoff >= now && kickoff <= horizon;
    return isLive || isUpcoming;
  });
  return json(data, response.status);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/build-id") {
      const id = env.CF_VERSION_METADATA?.id || env.COMMIT_SHA || "local";
      return json({ buildId: String(id).slice(0, 12) });
    }
    if (url.pathname === "/admin" || url.pathname === "/admin/") return env.ASSETS.fetch(new Request(new URL("/admin.html", request.url), request));
    if (url.pathname === "/api/admin/refresh-fixtures" && request.method === "POST") return refreshFixtureIndex(env);
    if (url.pathname === "/api/admin/live-rooms" && request.method === "GET") { const id = env.FIXTURE_INDEX.idFromName("supported-fixtures"); return env.FIXTURE_INDEX.get(id).fetch(new Request("https://fixture-index/live-rooms")); }
    if (url.pathname === "/api/admin/fixture-config" && (request.method === "GET" || request.method === "POST")) { const id = env.FIXTURE_INDEX.idFromName("supported-fixtures"); return env.FIXTURE_INDEX.get(id).fetch(new Request(`https://fixture-index/config`, { method: request.method, body: request.method === "POST" ? await request.text() : undefined, headers: request.method === "POST" ? { "content-type": "application/json" } : undefined })); }
    if (url.pathname === "/api/live-fixtures") return liveFixtures(env);
    if (url.pathname.startsWith("/api/espn/")) { const response = await espnApi(url); if (response) return response; }
    if (url.pathname === "/api/room/fixture" && request.method === "POST") {
      try {
        const input = await request.json();
        if (!input.fixture?.id) return json({ error: "fixture.id is required" }, 400);
        const id = env.MATCH_ROOM.idFromName(`espn:${input.league || "eng.1"}:${input.fixture.id}`);
        return env.MATCH_ROOM.get(id).fetch(new Request("https://room/create", { method: "POST", body: JSON.stringify({ ...input, mode: input.mode === "simulation" ? "simulation" : "live" }), headers: { "content-type": "application/json" } }));
      } catch (error) { return json({ error: error.message || "Could not create fixture room" }, 400); }
    }
    if (url.pathname === "/api/room" && request.method === "POST") {
      const body = await request.text();
      let input = null;
      try { input = JSON.parse(body); } catch { /* MatchRoom will return the validation error. */ }
      const isLiveFixture = input?.mode !== "simulation" && input?.fixture?.id;
      const id = isLiveFixture
        ? env.MATCH_ROOM.idFromName(`espn:${input.league || input.fixture.league || "eng.1"}:${input.fixture.id}`)
        : env.MATCH_ROOM.newUniqueId();
      return env.MATCH_ROOM.get(id).fetch(new Request("https://room/create", { method: "POST", body, headers: { "content-type": "application/json" } }));
    }
    if (url.pathname.startsWith("/api/room/")) { try { return env.MATCH_ROOM.get(env.MATCH_ROOM.idFromString(url.pathname.split("/").pop())).fetch(request); } catch { return new Response("Invalid room", { status: 400 }); } }
    const directPlay = url.pathname.match(/^\/play\/([^/]+)$/i);
    if (directPlay) { const target = new URL("/game.html", request.url); target.search = "?room=" + encodeURIComponent(directPlay[1]); return env.ASSETS.fetch(new Request(target, request)); }
    if (url.pathname === "/play") { const target = new URL("/game.html", request.url); target.search = url.search; return env.ASSETS.fetch(new Request(target, request)); }
    if (url.pathname === "/test" || url.pathname === "/test/") return env.ASSETS.fetch(new Request(new URL("/test/index.html", request.url), request));
    return env.ASSETS.fetch(request);
  },
  scheduled(event, env, ctx) { ctx.waitUntil(refreshFixtureIndex(env)); }
};
export class FixtureIndex {
  constructor(state) { this.state = state; }
  async fetch(request) {
    if (request.method === "POST" && new URL(request.url).pathname === "/refresh") {
      try {
        const saved = await this.state.storage.get("fixtureConfig") || {};
        const broadcastRules = { ...DEFAULT_BROADCAST_RULES, ...(saved.broadcastRules || await this.state.storage.get("broadcastRules") || {}) };
        const enabledCompetitions = normaliseEnabledCompetitions(saved.enabledCompetitions);
        const data = await pullFixtures(broadcastRules, enabledCompetitions);
        await this.state.storage.put("index", data);
        return json({ ...data, refreshed: true });
      } catch (error) { return json({ error: error.message || "Could not refresh fixture index" }, 502); }
    }
    if (request.method === "GET" && new URL(request.url).pathname === "/config") {
      const saved = await this.state.storage.get("fixtureConfig") || {};
      const broadcastRules = { ...DEFAULT_BROADCAST_RULES, ...(saved.broadcastRules || await this.state.storage.get("broadcastRules") || {}) };
      return json({ broadcastRules, enabledCompetitions: normaliseEnabledCompetitions(saved.enabledCompetitions), competitions: SUPPORTED_COMPETITIONS });
    }
    if (request.method === "POST" && new URL(request.url).pathname === "/config") {
      try {
        const input = await request.json();
        const saved = await this.state.storage.get("fixtureConfig") || {};
        const broadcastRules = { ...DEFAULT_BROADCAST_RULES, ...(saved.broadcastRules || {}), ukPremierLeagueSaturdayBlackout: input.broadcastRules?.ukPremierLeagueSaturdayBlackout !== false };
        const enabledCompetitions = normaliseEnabledCompetitions(input.enabledCompetitions);
        await this.state.storage.put("fixtureConfig", { broadcastRules, enabledCompetitions });
        await this.state.storage.put("broadcastRules", broadcastRules);
        return json({ broadcastRules, enabledCompetitions, saved: true });
      } catch (error) { return json({ error: error.message || "Could not save fixture configuration" }, 400); }
    }
    if (request.method === "POST" && new URL(request.url).pathname === "/remove") {
      try {
        const input = await request.json(), data = await this.state.storage.get("index");
        if (!data) return json({ removed: false });
        const before = data.fixtures?.length || 0;
        data.fixtures = (data.fixtures || []).filter(item => String(item.id) !== String(input.eventId));
        if (data.fixtures.length !== before) await this.state.storage.put("index", data);
        return json({ removed: data.fixtures.length !== before });
      } catch (error) { return json({ error: error.message || "Could not remove fixture" }, 400); }
    }
    if (request.method === "POST" && new URL(request.url).pathname === "/register-room") {
      try {
        const input = await request.json();
        if (!input.roomId) return json({ error: "roomId is required" }, 400);
        const rooms = await this.state.storage.get("liveRooms") || {};
        rooms[String(input.roomId)] = input;
        await this.state.storage.put("liveRooms", rooms);
        return json({ saved: true });
      } catch (error) { return json({ error: error.message || "Could not register live room" }, 400); }
    }
    if (request.method === "POST" && new URL(request.url).pathname === "/remove-room") {
      try {
        const input = await request.json(), rooms = await this.state.storage.get("liveRooms") || {};
        delete rooms[String(input.roomId)]; await this.state.storage.put("liveRooms", rooms); return json({ removed: true });
      } catch (error) { return json({ error: error.message || "Could not remove live room" }, 400); }
    }
    if (request.method === "GET" && new URL(request.url).pathname === "/live-rooms") {
      const rooms = await this.state.storage.get("liveRooms") || {}, cutoff = Date.now() - 6 * 60 * 60 * 1000;
      const live = Object.values(rooms).filter(room => Number(room.updatedAt || 0) >= cutoff && room.fixture?.state === "in" && room.session?.status !== "complete");
      return json({ rooms: live.sort((a, b) => String(a.fixture?.name || "").localeCompare(String(b.fixture?.name || ""))) });
    }
    const data = await this.state.storage.get("index");
    return data ? json(data) : json({ error: "Fixture index has not been refreshed yet" }, 404);
  }
}
export class MatchRoom {
  constructor(state, env) { this.state = state; this.env = env; this.sockets = new Set(state.getWebSockets ? state.getWebSockets() : []); this.room = null; }
  async fetch(request) {
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair(); this.state.acceptWebSocket(pair[1]); this.sockets.add(pair[1]);
      if (!this.room) await this.load();
      if (this.room.fixture?.id && this.room.mode === "live") { await this.refreshLive(); await this.save(); }
      pair[1].send(JSON.stringify({ type: "state", state: this.public() }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (request.method === "POST" && !this.room) {
      await this.load();
      try {
        const input = await request.json();
        if (input.fixture) {
          this.room.fixture = input.fixture;
          this.room.provider = { name: "ESPN", sport: input.sport || input.fixture.sport || "soccer", league: input.league || "eng.1", eventId: input.fixture.id, error: null };
          this.room.timeline = (input.events || []).filter(e => e && e.offset != null).map(e => ({ id: String(e.id), type: e.type, offset: Number(e.offset), minute: e.minute, text: e.text, team: e.team || null })); this.room.mode = input.mode === "simulation" ? "simulation" : "live"; this.room.speed = Math.max(1, Math.min(50, Number(input.speed) || 1)); this.room.session.mode = this.room.mode; this.room.session.speed = this.room.speed; this.room.session.manualPaused = false; this.room.preMatch = this.buildPreMatch();
          this.room.session.status = this.room.fixture.state === "in" ? "lobby" : "lobby";
        }
      } catch {}
      await this.save(); return Response.json({ roomId: this.state.id.toString(), state: this.public() });
    }
    return new Response("Room unavailable", { status: 404 });
  }
  async load() {
    this.room = await this.state.storage.get("room") || {
      createdAt: Date.now(), lastActivity: Date.now(), fixture: null, provider: { name: "ESPN", league: "eng.1", eventId: null, error: null },
      timeline: [], preMatch: [], mode: "live", speed: 1, session: { status: "lobby", startedAt: null, round: null, clock: 0, clockBase: 0, speed: 1 }, players: [], predictions: {}, leaderboard: [],
      events: [{ label: "Fixture room opened", detail: "Live data from ESPN" }], lastProviderEventIds: [], lastLivePollAt: 0
    };
  }
  async save() { this.room.lastActivity = Date.now(); await this.state.storage.put("room", this.room); await this.state.storage.setAlarm(Date.now() + 7200000); await this.syncAdminRoom(); }
  async syncAdminRoom(force = false) {
    if (!this.room?.fixture?.id || !this.env?.FIXTURE_INDEX || (!force && Date.now() - (this.adminSyncAt || 0) < 10000)) return;
    this.adminSyncAt = Date.now();
    const rounds = [...(this.room.session?.rounds || []), this.room.session?.round].filter(Boolean).map(round => ({ id: round.id, type: round.targetType, question: round.question, status: round.status, result: round.result || null, openedAt: round.openedAt || null, voteEndsAt: round.voteEndsAt || null }));
    const summary = { roomId: this.state.id.toString(), updatedAt: this.adminSyncAt, fixture: this.room.fixture, session: { status: this.room.session?.status, clock: this.room.session?.clock || 0, clockDisplay: this.room.session?.clockDisplay || null, nextQuestionAt: this.room.session?.nextQuestionAt || null }, playerCount: this.room.players?.length || 0, players: (this.room.players || []).map(player => ({ name: player.name, points: player.points || 0, calls: player.calls || player.rounds || 0, correct: player.correct || 0 })), calls: rounds, provider: { lastLivePollAt: this.room.lastLivePollAt || 0, error: this.room.provider?.error || null } };
    try { const id = this.env.FIXTURE_INDEX.idFromName("supported-fixtures"); await this.env.FIXTURE_INDEX.get(id).fetch("https://fixture-index/register-room", { method: "POST", body: JSON.stringify(summary), headers: { "content-type": "application/json" } }); } catch {}
  }
  async removeAdminRoom() { if (!this.env?.FIXTURE_INDEX) return; try { const id = this.env.FIXTURE_INDEX.idFromName("supported-fixtures"); await this.env.FIXTURE_INDEX.get(id).fetch("https://fixture-index/remove-room", { method: "POST", body: JSON.stringify({ roomId: this.state.id.toString() }), headers: { "content-type": "application/json" } }); } catch {} }
  public() {
    if (this.room.fixture?.id && !this.room.preMatch?.length) this.room.preMatch = this.buildPreMatch();
    const rounds = [...(this.room.session?.rounds || []), this.room.session?.round].filter(Boolean);
    const answerLabel = (item, answer) => item?.choices?.find(choice => choice.key === answer)?.label || String(answer || "");
    const statusFor = (item, answer) => {
      if (item?.status === "settled" || item?.settled) return item.result?.correct && answer === item.result.correct ? "Correct" : "Missed";
      if (item?.status === "locked") return "Locked";
      return "Committed";
    };
    const committedCalls = this.room.players.map(player => {
      const predictions = this.room.predictions[player.id] || {}, calls = [];
      for (const question of [...(this.room.preMatch || []), ...(this.room.playerPreMatch?.[player.id] || [])]) {
        const answer = predictions.pre?.[question.id];
        if (answer != null) calls.push({ id: question.id, question: question.question, answer: answerLabel(question, answer), status: statusFor(question, answer) });
      }
      for (const round of rounds) {
        const answer = predictions[round.id];
        if (answer != null) calls.push({ id: round.id, question: round.question, answer: answerLabel(round, answer), status: statusFor(round, answer) });
      }
      return { id: player.id, name: player.name, calls, points: player.points || 0, correct: player.correct || 0 };
    });
    const settledEventIds = [...(this.room.preMatch || []), ...rounds].map(item => item.result?.eventId).filter(Boolean).map(String);
    const playerPreMatch = Object.fromEntries(Object.entries(this.room.playerPreMatch || {}));
    return { ...this.room, predictions: undefined, playerStatus: Object.fromEntries(this.room.players.map(p => [p.id, Object.keys(this.room.predictions[p.id]?.pre || {})])), playerPreMatch, committedCalls, settledEventIds };
  }
  broadcast() { this.sockets = new Set(this.state.getWebSockets ? this.state.getWebSockets() : this.sockets); const m = JSON.stringify({ type: "state", state: this.public() }); for (const ws of this.sockets) { try { ws.send(m); } catch {} } }
  schedule(ms) { this.state.storage.setAlarm(Date.now() + Math.max(250, Math.min(ms, 7200000))); }
  buildPreMatch(lateJoin = false, playerId = "") {
    const f = this.room.fixture || {}, home = f.home?.name || "Home", away = f.away?.name || "Away";
    const suffix = lateJoin ? "-" + playerId : "";
    const hasEvent = type => this.room.timeline.some(event => event.type === type);
    const nextGoal = lateJoin && hasEvent("goal");
    const nextGoalKick = lateJoin && hasEvent("goal-kick");
    const nextFoul = lateJoin && hasEvent("foul");
    const after = (enabled, type) => enabled
      ? Math.max(this.room.session?.clock || 0, ...this.room.timeline.filter(event => event.type === type).map(event => Number(event.offset) || 0))
      : null;
    return [
      { id: (nextGoal ? "next-goal-team" : "first-goal-team") + suffix, type: nextGoal ? "next-goal-team" : "first-goal-team", question: nextGoal ? "Which team scores next?" : "Which team scores first?", choices: [{ key: "home", label: home }, { key: "away", label: away }], settled: false, result: null, afterOffset: after(nextGoal, "goal") },
      { id: (nextGoalKick ? "next-goal-kick-time" : "first-goal-kick-time") + suffix, type: nextGoalKick ? "next-goal-kick-time" : "first-goal-kick-time", question: nextGoalKick ? "What’s the time of the next goal kick?" : "What’s the time of the first goal kick?", input: { min: 0, max: 120, step: 1, suffix: "minutes", lateJoin: nextGoalKick }, choices: [], settled: false, result: null, afterOffset: after(nextGoalKick, "goal-kick") },
      { id: (nextFoul ? "next-foul-team" : "first-foul-team") + suffix, type: nextFoul ? "next-foul-team" : "first-foul-team", question: nextFoul ? "Which team commits the next foul?" : "Which team commits the first foul?", choices: [{ key: "home", label: home }, { key: "away", label: away }], settled: false, result: null, afterOffset: after(nextFoul, "foul") }
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
  async refreshLive() {
    if (!this.room.fixture?.id || this.room.mode !== "live") return;
    const league = this.room.provider?.league || "eng.1", config = competitionConfig(this.room.provider?.sport, league), sport = config.sport, id = this.room.provider.eventId;
    try {
      const data = await readJson(`${siteBase(sport)}/${leaguePath(league)}/summary?event=${encodeURIComponent(id)}`);
      const competition = data.header?.competitions?.[0] || data.competitions?.[0] || {};
      const nextFixture = fixture({ id, name: competition.shortName || competition.name, date: competition.date, competitions: [{ ...competition, competitors: competition.competitors || [] }], status: competition.status });
      this.room.fixture = { ...this.room.fixture, ...nextFixture, home: { ...this.room.fixture.home, ...nextFixture.home }, away: { ...this.room.fixture.away, ...nextFixture.away } };
      const coreUrl = `${coreBase(sport, league)}/events/${encodeURIComponent(id)}/competitions/${encodeURIComponent(id)}`;
      const now = Date.now(), paginateCore = !this.room.lastCorePaginationAt || now - this.room.lastCorePaginationAt >= 60000;
      const [core, summary] = await Promise.allSettled([paginateCore ? readCorePlays(coreUrl) : readCorePlayPage(coreUrl), Promise.resolve(data)]);
      const coreItems = core.status === "fulfilled" ? (core.value.items || []) : [];
      const source = coreItems.length ? "core-live" : "summary-live-fallback";
      const incoming = (coreItems.length ? coreItems : (summary.value?.plays || [])).map((p, i) => normaliseEvent(p, i, source)).filter(e => e.offset != null && e.type !== "other");
      const known = new Set(this.room.timeline.map(e => e.id));
      for (const e of incoming) if (!known.has(e.id)) { this.room.timeline.push({ id: e.id, type: e.type, offset: e.offset, minute: e.minute, text: e.text, team: e.team || null }); this.room.events.unshift({ label: e.type === "goal" ? "GOAL" : "Match update", detail: e.text }); }
      this.room.timeline.sort((a, b) => a.offset - b.offset);
      const homeName = String(this.room.fixture.home?.name || "").toLowerCase();
      const awayName = String(this.room.fixture.away?.name || "").toLowerCase();
      const goals = this.room.timeline.filter(event => event.type === "goal");
      const homeGoals = goals.filter(event => String(event.team || "").toLowerCase() === homeName).length;
      const awayGoals = goals.filter(event => String(event.team || "").toLowerCase() === awayName).length;
      if (homeGoals || awayGoals) {
        this.room.fixture.home.score = Math.max(Number(this.room.fixture.home.score) || 0, homeGoals);
        this.room.fixture.away.score = Math.max(Number(this.room.fixture.away.score) || 0, awayGoals);
      }
      this.room.lastProviderEventIds = this.room.timeline.map(e => e.id);
      this.room.lastLivePollAt = Date.now();
      this.room.provider.playsSource = source;
      this.room.provider.playsProcessed = incoming.length;
      this.room.provider.pollIntervalSeconds = 15;
      this.room.provider.corePaginationIntervalSeconds = 60;
      if (paginateCore) this.room.lastCorePaginationAt = now;
      if (this.room.session.status === "running") { const liveClock = this.liveClock(nextFixture, data); this.room.session.clock = liveClock.seconds; this.room.session.clockDisplay = liveClock.display; }
    } catch (error) { this.room.provider.error = error.message || "Live feed unavailable"; }
  }
  liveClock(fixtureData, summary) {
    const status = fixtureData.status || {};
    const detail = String(status.shortDetail || status.detail || "");
    const rawClock = String(summary?.header?.competitions?.[0]?.status?.displayClock || "").trim();
    const stoppage = rawClock.match(/^(\d+)\s*\+\s*(\d+)$/) || detail.match(/^(\d+)\s*['’]?\s*\+\s*(\d+)/);
    if (stoppage) {
      const minutes = Number(stoppage[1]), extra = Number(stoppage[2]);
      return { seconds: (minutes + extra) * 60, display: `${minutes}+${extra}` };
    }
    const normalClock = rawClock.match(/^(\d+)\s*:\s*(\d{1,2})$/);
    if (normalClock) {
      const minutes = Number(normalClock[1]), seconds = Number(normalClock[2]);
      return { seconds: minutes * 60 + seconds, display: `${minutes}:${String(seconds).padStart(2, "0")}` };
    }
    if (/^\d{3,4}$/.test(rawClock)) {
      const extraDigits = rawClock.length === 4 ? 2 : 1;
      const minutes = Number(rawClock.slice(0, -extraDigits)), extra = Number(rawClock.slice(-extraDigits));
      return { seconds: (minutes + extra) * 60, display: `${minutes}+${extra}` };
    }
    const minuteOnly = rawClock.match(/^(\d+)$/);
    if (minuteOnly) {
      const minutes = Number(minuteOnly[1]);
      return { seconds: minutes * 60, display: null };
    }
    const detailClock = detail.match(/(\d+)\s*['’]/);
    return { seconds: detailClock ? Number(detailClock[1]) * 60 : this.room.session.clock || 0, display: null };
  }
  nextLiveType() {
    const types = ["corner", "card", "goal", "foul"];
    const previous = this.room.session.lastQuestionType;
    return types.find(type => type !== previous) || "corner";
  }
  async openLiveRound() {
    const type = this.nextLiveType(), f = this.room.fixture || {};
    if (this.room.session.round?.status === "voting") { this.room.session.rounds ||= []; this.room.session.rounds.push(this.room.session.round); }
    const round = { id: "round-" + (this.room.session.nextRoundIndex || 0), targetEventId: null, targetType: type, question: "Who gets the next " + type + "?", choices: [{ key: "home", label: f.home?.name || "Home" }, { key: "away", label: f.away?.name || "Away" }], status: "voting", warmupEndsAt: null, voteEndsAt: null, result: null, openedAt: Date.now(), baselineEventIds: this.room.timeline.map(e => e.id) };
    this.room.session.lastQuestionType = type; this.room.session.round = round; this.room.session.nextRoundIndex = (this.room.session.nextRoundIndex || 0) + 1; this.room.session.nextQuestionAt = nextLiveCallAt();
    this.room.events.unshift({ label: "Vote now", detail: round.question }); await this.save(); this.broadcast(); this.schedule(10000);
  }
  targetForQuestion(q) { return this.room.timeline.find(e => (((q.type === "first-goal-team" || q.type === "next-goal-team") && e.type === "goal") || ((q.type === "first-goal-kick-time" || q.type === "next-goal-kick-time") && e.type === "goal-kick") || ((q.type === "first-foul-team" || q.type === "next-foul-team") && e.type === "foul")) && (q.afterOffset == null || e.offset > q.afterOffset)); }
  keyForQuestion(q, target) {
    if (!target) return null;
    if (q.type === "first-goal-kick-time" || q.type === "next-goal-kick-time") return String(Math.floor((target.offset || 0) / 60));
    const f = this.room.fixture || {}, normalise = value => String(value || "").toLowerCase().replace(/\b(fc|afc|city|town|united)\\b/g, "").replace(/[^a-z0-9]/g, "");
    const targetName = normalise(target.team || target.text);
    const homeName = normalise(f.home?.name), awayName = normalise(f.away?.name);
    if (targetName && homeName && (targetName.includes(homeName) || homeName.includes(targetName))) return "home";
    if (targetName && awayName && (targetName.includes(awayName) || awayName.includes(targetName))) return "away";
    return null;
  }
  settlePreMatch(clock) {
    let changed = false;
    const sets = [{ playerId: null, questions: this.room.preMatch || [] }, ...Object.entries(this.room.playerPreMatch || {}).map(([playerId, questions]) => ({ playerId, questions }))];
    for (const set of sets) for (const q of set.questions) {
      if (q.settled) continue; const target = this.targetForQuestion(q);
      if (!target || target.offset > clock) continue;
      const correct = this.keyForQuestion(q, target); q.settled = true; q.result = { correct, event: target.text || "Event occurred", eventId: target.id }; changed = true;
      const players = set.playerId ? this.room.players.filter(p => p.id === set.playerId) : this.room.players;
      for (const p of players) { const answer = this.room.predictions[p.id]?.pre?.[q.id]; if (answer) p.calls = Math.max(p.calls || 0, Object.keys(this.room.predictions[p.id]?.pre || {}).length); if (correct && answer === correct) { p.points = (p.points || 0) + 100; p.correct = (p.correct || 0) + 1; } }
    }
    if (changed) this.rebuildLeaderboard(); return changed;
  }
  rebuildLeaderboard() { this.room.leaderboard = [...this.room.players].sort((a,b) => (b.points||0)-(a.points||0)).map((p,i) => ({ rank:i+1, name:p.name, points:p.points||0, rounds:p.calls ?? p.rounds ?? 0 })); }
  async startSession() {
    if (this.room.mode === "live") { this.room.session = { status: "running", startedAt: Date.now(), round: null, clock: 0, nextRoundIndex: 0, nextQuestionAt: nextLiveCallAt(), mode: "live", speed: 1, lastQuestionType: null }; await this.save(); this.broadcast(); this.schedule(1000); return; }
    const first = this.nextTarget(0);
    if (!first) { this.room.session.status = "complete"; return; }
    this.room.session = { status: "running", startedAt: Date.now(), round: null, clock: 0, clockBase: 0, nextRoundIndex: 0, mode: this.room.mode || "live", speed: this.room.mode === "simulation" ? (this.room.speed || 1) : 1 };
    await this.openRound(first, 0);
  }
  async openRound(target, index) {
    const round = this.roundFor(target, index); const now = Date.now();
    const leadMs = Math.max(0, (target.offset - this.room.session.clock) * 1000);
    const speed = this.room.session.speed || 1, warmupSeconds = Math.max(0, leadMs - 40000); round.warmupEndsAt = now + (warmupSeconds * 1000) / speed; round.voteEndsAt = round.warmupEndsAt + (30000 / speed); if (this.room.session.mode === "simulation" && this.room.session.clock === 0) { round.warmupEndsAt = now + 3000; round.voteEndsAt = round.warmupEndsAt + 10000; }
    if (leadMs < 40000) round.warmupEndsAt = now;
    this.room.session.round = round; this.room.session.status = "warmup"; this.room.events.unshift({ label: "Prediction warming up", detail: round.question });
    await this.save(); this.broadcast(); this.schedule(Math.max(250, round.warmupEndsAt - now));
  }
  async advance() {
    const s = this.room.session, r = s.round;
    if (s.mode === "live") {
      await this.refreshLive();
      this.settlePreMatch(s.clock);
      if (s.status === "running" && this.room.fixture.state === "in" && Date.now() >= (s.nextQuestionAt || 0)) { await this.openLiveRound(); return; }
      const openRounds = [...(s.rounds || []), s.round].filter(round => round?.status === "voting");
      const resolvedRound = openRounds.find(round => this.room.timeline.some(e => !(round.baselineEventIds || []).includes(e.id) && e.type === round.targetType) || this.room.fixture.state === "post");
      if (resolvedRound) { await this.settleLiveRound(resolvedRound); return; }
      if (s.status === "running" && this.room.fixture.state === "post") { s.status = "complete"; await removeFixtureFromIndex(this.env, this.room.fixture.id); await this.removeAdminRoom(); await this.save(); await this.state.storage.deleteAlarm(); this.broadcast(); return; }
      await this.save(); this.broadcast(); this.schedule(Math.max(250, (s.nextQuestionAt || Date.now() + 15000) - Date.now())); return;
    }
    if (!r) return;
    if (s.manualPaused) return;
    const now = Date.now(), elapsed = s.holding ? s.clock : (s.clockBase || 0) + (now - s.startedAt) / 1000 * (s.speed || 1);
    s.clock = Math.max(0, elapsed); this.settlePreMatch(s.clock);
    if (r.status === "warmup" && now >= r.warmupEndsAt) { r.status = "voting"; r.voteEndsAt = now + (s.mode === "simulation" ? 10000 : (10000 / (s.speed || 1))); if (s.mode === "simulation") s.holding = true; this.room.events.unshift({ label: "Vote now", detail: r.question }); await this.save(); this.broadcast(); this.schedule(10000); return; }
    if (r.status === "voting" && now >= r.voteEndsAt) { r.status = "locked"; if (s.mode === "simulation") { s.holding = false; s.clockBase = s.clock; s.startedAt = now; } await this.save(); this.broadcast(); this.schedule(Math.max(250, ((this.room.timeline.find(e => e.id === r.targetEventId)?.offset || s.clock) - s.clock) * 1000 / (s.speed || 1))); return; }
    if (r.status === "locked") { const target = this.room.timeline.find(e => e.id === r.targetEventId); if (target && s.clock < target.offset) { this.schedule(Math.max(250, (target.offset - s.clock) * 1000 / (s.speed || 1))); return; } await this.settleRound(r); return; }
    if (r.status === "settled") { const next = this.nextTarget(s.clock); if (next) { s.nextRoundIndex = (s.nextRoundIndex || 0) + 1; await this.openRound(next, s.nextRoundIndex); } else { s.status = "complete"; await this.save(); this.broadcast(); } return; }
    this.schedule(r.status === "warmup" ? r.warmupEndsAt - now : r.voteEndsAt - now);
  }
  async settleRound(round) {
    const target = this.room.timeline.find(e => e.id === round.targetEventId); const correct = target ? this.keyForQuestion({ type: "first-goal-team" }, target) : null;
    round.result = { correct, event: target?.text || "Event occurred", eventId: target?.id || null }; round.status = "settled";
    for (const p of this.room.players) {
      const answer = this.room.predictions[p.id]?.[round.id]; const hit = correct && answer === correct;
      if (hit) p.points = (p.points || 0) + 100;
      if (hit) p.correct = (p.correct || 0) + 1;
      if (!p.rounds) p.rounds = 0; if (answer) p.rounds++;
    }
    this.room.leaderboard = [...this.room.players].sort((a,b) => (b.points||0)-(a.points||0)).map((p,i) => ({ rank:i+1, name:p.name, points:p.points||0, rounds:p.rounds||0 }));
    this.room.events.unshift({ label: correct ? "Prediction settled" : "Prediction settled", detail: round.result.event });
    await this.save(); this.broadcast(); this.schedule(1500);
  }
  async settleLiveRound(round) {
    const baseline = new Set(round.baselineEventIds || []), target = this.room.timeline.find(e => !baseline.has(e.id) && e.type === round.targetType);
    const correct = target ? this.keyForQuestion({ type: "first-goal-team" }, target) : null;
    round.result = { correct, event: target?.text || `No ${round.targetType} recorded during the call`, eventId: target?.id || null }; round.status = "settled";
    for (const p of this.room.players) { const answer = this.room.predictions[p.id]?.[round.id]; if (answer) p.calls = (p.calls || 0) + 1; if (correct && answer === correct) { p.points = (p.points || 0) + 100; p.correct = (p.correct || 0) + 1; } if (answer) p.rounds = (p.rounds || 0) + 1; }
    this.rebuildLeaderboard(); this.room.session.nextQuestionAt = nextLiveCallAt(); this.room.events.unshift({ label: "Prediction settled", detail: round.result.event }); await this.save(); this.broadcast(); this.schedule(Math.max(250, (this.room.session.nextQuestionAt || Date.now() + 15000) - Date.now()));
  }
  async webSocketMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch { return; } if (!this.room) await this.load(); this.room.lastActivity = Date.now();
    if (m.type === "join") { let p = this.room.players.find(x => x.id === m.playerId); if (!p) { p = { id: crypto.randomUUID(), name: String(m.name || "Supporter").slice(0,20), points: 0, rounds: 0, calls: 0, correct: 0 }; this.room.players.push(p); } else if (m.name) p.name = String(m.name).slice(0,20); this.room.playerPreMatch ||= {}; if (this.room.fixture?.state === "in") { const current = this.buildPreMatch(true, p.id), hasRelevantEvent = this.room.timeline.some(e => ["goal", "goal-kick", "foul"].includes(e.type)); if (!this.room.playerPreMatch[p.id] && hasRelevantEvent) this.room.playerPreMatch[p.id] = current; else if (this.room.playerPreMatch[p.id]) { this.room.playerPreMatch[p.id].forEach((oldQuestion, index) => { const nextQuestion = current[index]; if (oldQuestion && nextQuestion && !oldQuestion.settled && nextQuestion.type.startsWith("next-")) Object.assign(oldQuestion, { type: nextQuestion.type, question: nextQuestion.question, input: nextQuestion.input, choices: nextQuestion.choices, afterOffset: nextQuestion.afterOffset }); }); } } if (this.room.mode === "live" && this.room.session.status === "lobby") { this.room.session = { status: "running", startedAt: Date.now(), round: null, clock: 0, nextRoundIndex: 0, nextQuestionAt: nextLiveCallAt(), mode: "live", speed: 1, lastQuestionType: null }; } this.rebuildLeaderboard(); ws.send(JSON.stringify({ type:"identity", playerId:p.id })); }
    if (m.type === "prematch") { const p = this.room.players.find(x => x.id === m.playerId), q = (this.room.playerPreMatch?.[m.playerId] || []).find(x => x.id === m.questionId) || (this.room.preMatch || []).find(x => x.id === m.questionId); if (p && q && !q.settled && ((q.input && Number.isInteger(Number(m.answer)) && Number(m.answer) >= q.input.min && Number(m.answer) <= q.input.max) || q.choices.some(c => c.key === m.answer))) { this.room.predictions[p.id] ||= {}; this.room.predictions[p.id].pre ||= {}; if (!this.room.predictions[p.id].pre[q.id]) p.calls = (p.calls || 0) + 1; this.room.predictions[p.id].pre[q.id] = String(m.answer); } }
    if (m.type === "start") await this.startSession();
    if (m.type === "predict") { const p = this.room.players.find(x => x.id === m.playerId), r = this.room.session.round, voteOpen = !r?.voteEndsAt || Date.now() < r.voteEndsAt; if (p && r?.status === "voting" && voteOpen && r.id === m.roundId) { this.room.predictions[p.id] ||= {}; if (!this.room.predictions[p.id][r.id]) p.calls = (p.calls || 0) + 1; this.room.predictions[p.id][r.id] = m.answer; if (this.room.session.mode === "simulation") { r.status = "locked"; this.room.session.holding = false; this.room.session.clockBase = this.room.session.clock; this.room.session.startedAt = Date.now(); } } }
    if (m.type === "simulation-control" && this.room.mode === "simulation") {
      const s = this.room.session, now = Date.now();
      if (!s.manualPaused && !s.holding && s.status === "running") s.clock = (s.clockBase || 0) + (now - s.startedAt) / 1000 * (s.speed || 1);
      if (m.action === "pause" && s.status === "running" && !s.holding) { s.clockBase = s.clock; s.startedAt = now; s.manualPaused = true; }
      if (m.action === "resume" && s.manualPaused) { s.clockBase = s.clock; s.startedAt = now; s.manualPaused = false; }
      if (m.action === "speed") { const speed = Number(m.speed); if ([1, 2, 5, 10, 20, 50].includes(speed)) { s.speed = speed; this.room.speed = speed; if (!s.manualPaused && !s.holding) { s.clockBase = s.clock; s.startedAt = now; } } }
    }
    await this.save(); this.broadcast();
    if (m.type === "start" || m.type === "predict" || m.type === "join" || m.type === "simulation-control") this.schedule(500);
  }
  async closeRoom(ws) { this.sockets = new Set(this.state.getWebSockets ? this.state.getWebSockets() : this.sockets); this.sockets.delete(ws); if (this.sockets.size === 0) { if (this.room) await this.state.storage.put("room", this.room); this.schedule(30000); } }
  async webSocketClose(ws) { await this.closeRoom(ws); }
  async webSocketError(ws) { await this.closeRoom(ws); }
  async alarm() { this.sockets = new Set(this.state.getWebSockets ? this.state.getWebSockets() : this.sockets); if (this.sockets.size === 0) { if (this.room) await this.removeAdminRoom(); if (this.room) { await this.state.storage.delete("room"); this.room = null; } await this.state.storage.deleteAlarm(); } else { await this.load(); await this.advance(); } }
}
