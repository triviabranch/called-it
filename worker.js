const ESPN_SITE_ROOT = "https://site.web.api.espn.com/apis/site/v2/sports";
const ESPN_CORE_ROOT = "https://sports.core.api.espn.com/v2/sports";
const SUPPORTED_COMPETITIONS = [
  { sport: "soccer", league: "eng.1", name: "Premier League", order: 0 },
  { sport: "soccer", league: "eng.2", name: "Championship", order: 1 },
  { sport: "soccer", league: "eng.league_cup", name: "Carabao Cup", order: 2 },
  { sport: "soccer", league: "eng.fa", name: "FA Cup", order: 3 },
  { sport: "soccer", league: "uefa.europa", name: "Europa League", order: 4 },
  { sport: "soccer", league: "uefa.europa.conf", name: "Europa Conference League", order: 5 },
  { sport: "soccer", league: "sco.1", name: "Scottish Premiership", order: 6 },
  { sport: "soccer", league: "esp.1", name: "LaLiga", order: 5 },
  { sport: "soccer", league: "ger.1", name: "Bundesliga", order: 6 },
  { sport: "soccer", league: "ita.1", name: "Serie A", order: 7 },
  { sport: "soccer", league: "fra.1", name: "Ligue 1", order: 8 },
  { sport: "soccer", league: "usa.1", name: "MLS", order: 9 },
  { sport: "soccer", league: "aus.1", name: "A-League Men", order: 10 },
  { sport: "rugby-league", league: "3", name: "NRL", order: 11 }
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
const DEFAULT_ACCESS_RULES = { minimumMinutesBeforeKickoff: 120 };
function normaliseAccessRules(value) {
  const minutes = Number(value?.minimumMinutesBeforeKickoff);
  return { minimumMinutesBeforeKickoff: Number.isFinite(minutes) ? Math.max(0, Math.min(1440, Math.round(minutes))) : DEFAULT_ACCESS_RULES.minimumMinutesBeforeKickoff };
}
function applyFixtureAccess(fixture, accessRules, now = Date.now()) {
  const minutes = normaliseAccessRules(accessRules).minimumMinutesBeforeKickoff;
  const kickoff = Date.parse(fixture?.date);
  if (!Number.isFinite(kickoff) || fixture?.state !== "pre") return { ...fixture, accessRules: { minimumMinutesBeforeKickoff: minutes }, accessState: "open", opensAt: null };
  const opensAt = kickoff - minutes * 60000;
  return { ...fixture, accessRules: { minimumMinutesBeforeKickoff: minutes }, accessState: now >= opensAt ? "open" : "locked", opensAt };
}
async function fixtureAccess(env, fixture) {
  const id = env.FIXTURE_INDEX.idFromName("supported-fixtures");
  const response = await env.FIXTURE_INDEX.get(id).fetch(new Request("https://fixture-index/config"));
  const config = await response.json();
  const accessRules = normaliseAccessRules(config.accessRules);
  const opened = applyFixtureAccess(fixture, accessRules);
  return { ...opened, locked: opened.accessState === "locked" };
}
const BROADCAST_REGIONS = [
  { code: "gb", espn: "uk", label: "United Kingdom" },
  { code: "au", espn: "au", label: "Australia" },
  { code: "us", espn: "us", label: "United States" },
  { code: "ca", espn: "ca", label: "Canada" },
  { code: "nz", espn: "nz", label: "New Zealand" },
  { code: "ie", espn: "ie", label: "Ireland" }
];
const REGION_BY_CODE = Object.fromEntries(BROADCAST_REGIONS.map(item => [item.code, item]));
const DEFAULT_ENABLED_REGIONS = BROADCAST_REGIONS.map(item => item.code);
function normaliseEnabledRegions(values) {
  const selected = Array.isArray(values) ? values : DEFAULT_ENABLED_REGIONS;
  return [...new Set(selected)].filter(code => REGION_BY_CODE[code]);
}
const COUNTRY_TO_REGION = { GB: "gb", UK: "gb", AU: "au", US: "us", CA: "ca", NZ: "nz", IE: "ie" };
const REGION_BROADCAST_FALLBACKS = {
  gb: {
    "eng.league_cup": [{ name: "Sky Sports+", market: "uk" }]
  }
};
function normaliseRegion(value) {
  const key = String(value || "").trim().toLowerCase();
  return REGION_BY_CODE[key] ? key : "gb";
}
function regionForRequest(request) {
  return normaliseRegion(COUNTRY_TO_REGION[String(request?.cf?.country || "").toUpperCase()] || "gb");
}
function regionInfo(value) {
  const code = normaliseRegion(value);
  return REGION_BY_CODE[code];
}
function broadcastsForFixture(fixture, config, region) {
  // ESPN can return a national/US broadcaster even when the request is for
  // the UK. Apply authoritative UK competition mappings before trusting that
  // payload.
  if (region === "gb" && config.league === "eng.league_cup") {
    return [{ name: "Sky Sports+", market: "uk" }];
  }
  // ESPN's NRL Core feed does not expose broadcaster rows, even for live
  // matches that are carried in the selected market. Keep NRL discoverable
  // under Called It's televised-fixture rule while retaining the provenance
  // in the label rather than pretending ESPN supplied a network name.
  if (config.sport === "rugby-league" && config.league === "3") {
    return fixture.broadcasts?.length ? fixture.broadcasts : [{ name: "NRL coverage", market: region }];
  }
  if (fixture.broadcasts?.length) return fixture.broadcasts;
  return REGION_BROADCAST_FALLBACKS[region]?.[config.league] || [];
}
const LIVE_CALL_INTERVAL_MS = 7.5 * 60 * 1000;
const LIVE_PROVIDER_POLL_MS = 15 * 1000;
const FIXTURE_INDEX_REFRESH_MAX_AGE_MS = 5 * 60 * 1000;
function nextLiveCallAt(fixture, now = Date.now()) {
  const kickoff = Date.parse(fixture?.date);
  if (!Number.isFinite(kickoff)) return now + LIVE_CALL_INTERVAL_MS;
  const firstCall = kickoff + LIVE_CALL_INTERVAL_MS;
  if (now <= firstCall) return firstCall;
  return firstCall + Math.ceil((now - firstCall) / LIVE_CALL_INTERVAL_MS) * LIVE_CALL_INTERVAL_MS;
}
function dateKey(value) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(value));
}
function formatMatchTime(seconds, display) {
  const raw = String(display || "").trim();
  const stoppage = raw.match(/^(\d{1,3})\s*(?:\+|['’])\s*(\d{1,2})$/);
  if (stoppage) return `${Number(stoppage[1])}+${Number(stoppage[2])}`;
  const normal = raw.match(/^(\d{1,3})\s*:\s*(\d{1,2})$/);
  if (normal) return `${String(Number(normal[1])).padStart(2, "0")}:${String(Number(normal[2])).padStart(2, "0")}`;
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
}
function leaguePath(league) { return encodeURIComponent((league || "eng.1").trim().toLowerCase()); }
async function readJson(url) {
  const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json, text/plain, */*", "cache-control": "no-cache", pragma: "no-cache", "accept-language": "en-GB,en;q=0.9", "origin": "https://www.espn.com", "referer": "https://www.espn.com/", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "x-requested-with": "XMLHttpRequest", "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "cross-site", 'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"', "sec-ch-ua-mobile": "?0", 'sec-ch-ua-platform': '"Windows"' } });
  if (!response.ok) throw new Error(`ESPN returned ${response.status}`);
  return response.json();
}
async function readCorePlays(baseUrl) {
  const first = await readJson(`${baseUrl}/plays?limit=300&page=1&lang=en&region=us`);
  const pageCount = Math.min(Number(first.pageCount || 1), 10);
  const pages = await Promise.all(Array.from({ length: pageCount - 1 }, (_, i) => readJson(`${baseUrl}/plays?limit=300&page=${i + 2}&lang=en&region=us`)));
  return { ...first, items: [ ...(first.items || []), ...pages.flatMap(page => page.items || []) ] };
}
async function readCorePlayPage(baseUrl) {
  // Live polling only needs the newest ESPN page. Historical pages are
  // fetched separately by readCorePlays() when a player backfills a room.
  const first = await readJson(`${baseUrl}/plays?limit=300&page=1`);
  const pageCount = Math.min(Number(first.pageCount || 1), 10);
  if (pageCount <= 1) return first;
  return readJson(`${baseUrl}/plays?limit=300&page=${pageCount}`);
}
function fixture(item) {
  const competition = item?.competitions?.[0] || {};
  const teams = competition.competitors || [];
  const home = teams.find(t => t.homeAway === "home") || teams[0] || {};
  const away = teams.find(t => t.homeAway === "away") || teams[1] || {};
  const broadcastItems = [
    ...(Array.isArray(item.broadcasts) ? item.broadcasts : []),
    ...(Array.isArray(competition.broadcasts) ? competition.broadcasts : [])
  ];
  const broadcasts = [...new Map(broadcastItems.map(item => {
    const name = (Array.isArray(item?.names) ? item.names : []).filter(Boolean).join(" / ") || item?.name || item?.media?.shortName || item?.type?.shortName || "Televised";
    return [name, { name, market: item?.market?.type || item?.market || null }];
  })).values()];
  return { id: String(item.id), name: item.name || `${home.team?.displayName || "Home"} v ${away.team?.displayName || "Away"}`, date: item.date, status: item.status?.type?.shortDetail || item.status?.type?.detail || item.status?.type?.name || "Scheduled", state: item.status?.type?.state || "pre", televised: broadcasts.length > 0, broadcasts, home: { name: home.team?.displayName || "Home", abbr: home.team?.abbreviation || "", score: home.score ?? null, logo: home.team?.logo || null }, away: { name: away.team?.displayName || "Away", abbr: away.team?.abbreviation || "", score: away.score ?? null, logo: away.team?.logo || null }, venue: competition.venue?.fullName || competition.venue?.address?.city || null };
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
  const reversalText = [item?.type?.text, item?.type?.name, item?.text, item?.shortText, item?.description, item?.detail].filter(Boolean).join(" ").toLowerCase();
  if (/no goal|goal (?:disallowed|overturned|cancelled)|(?:disallowed|overturned|cancelled).*goal|var.*(?:no goal|disallowed|overturned|cancelled)/.test(reversalText)) return "var";
  // NRL uses rugby scoring terminology rather than football's goal events.
  // Keep tries and other scoring plays in the existing score-resolution lane
  // while retaining conversions as a visible feed event.
  if (/\btry\b|penalty.?goal|drop.?goal|field.?goal/.test(kind)) return "goal";
  if (/\bconversion\b/.test(kind)) return "conversion";
  if (/goal.?kick/.test(kind)) return "goal-kick";
  if (item?.scoringPlay || /(^|[- ])(goal|score)(?![- ]?kick)/.test(kind)) return "goal";
  if (item?.redCard || /red.?card|sent.?off/.test(kind)) return "card";
  if (item?.yellowCard || /yellow.?card|caution|booking/.test(kind)) return "card";
  if (item?.substitution || /substitut/.test(kind)) return "substitution";
  if (/corner/.test(kind)) return "corner";
  if (/foul/.test(kind)) return "foul";
  if (/offside/.test(kind)) return "offside";
  if (/shot|save|miss|block/.test(kind)) return "shot";
  if (/var|video/.test(kind)) return "var";
  if (/kickoff|kick.?off|halftime|half.?time|full.?time|match.?end/.test(kind)) return "phase";
  const text = [item?.type?.text, item?.type?.name, item?.text, item?.shortText, item?.description, item?.detail].filter(Boolean).join(" ").toLowerCase();
  if (/\btry\b|penalty goal|drop goal|field goal/.test(text)) return "goal";
  if (/\bconversion\b/.test(text)) return "conversion";
  if (/goal kick/.test(text)) return "goal-kick";
  if (/(scores|scored|penalty kick goal|own goal|goal!)/.test(text) && !/goal kick/.test(text)) return "goal";
  if (/corner/.test(text)) return "corner";
  if (/foul/.test(text)) return "foul";
  if (/yellow card|red card|caution|booking|sent off/.test(text)) return "card";
  if (/substitut|replaced by/.test(text)) return "substitution";
  if (/offside/.test(text)) return "offside";
  if (/shot|save|missed|blocked/.test(text)) return "shot";
  if (/var|video review/.test(text)) return "var";
  return "other";
}
function normaliseEvent(item, index, source) {
  const offset = eventClock(item);
  const text = item?.text || item?.shortText || item?.description || item?.detail || item?.type?.text || "Match update";
  const providerClock = String(item?.clock?.displayValue || item?.displayValue || item?.time?.displayValue || "").match(/^(\d{1,3})\s*['’]/);
  const textClock = String(text).match(/\bat\s+(\d{1,3})['’]/i);
  const minute = providerClock ? Number(providerClock[1]) : textClock ? Number(textClock[1]) : (offset == null ? null : Math.floor(offset / 60));
  const participantRows = [item?.participants, item?.athletes, item?.scorers, item?.scoringPlayers, item?.scoringPlayer, item?.goalScorer, item?.scorer].flatMap(value => Array.isArray(value) ? value : value ? [value] : []);
  const athletes = [...new Set(participantRows.map(player => {
    const athlete = player?.athlete || player?.player || player;
    return athlete?.displayName || athlete?.fullName || athlete?.shortName || athlete?.name || (typeof athlete === "string" ? athlete : "");
  }).filter(Boolean))];
  const textTeam = String(text).match(/\(([^)]+)\)/)?.[1]
    || String(text).match(/^Corner(?:\s+awarded)?[,]?\s+([^.;]+?)(?:\.|$)/i)?.[1]?.trim()
    || null;
  const team = item?.team?.displayName || item?.team?.shortDisplayName || item?.team?.name || item?.competitor?.team?.displayName || item?.competitor?.displayName || textTeam;
  return { id: String(item?.id || (source + "-" + index)), source, type: eventType(item), offset, minute, period: item?.period?.number || item?.period?.displayValue || null, text, athletes, team, valid: item?.valid !== false, scoringPlay: Boolean(item?.scoringPlay), raw: item };
}
function normaliseCorePlay(item, index) { return normaliseEvent({ ...item, text: item.text || item.shortText || item.alternativeText || item.type?.text }, index, "core-play"); }
function normaliseCommentary(item, index) { const play = item?.play || item; return normaliseEvent({ ...play, clock: play.clock || item.time, text: item.text || play.text || play.shortText }, index, "commentary"); }
function meaningful(item) { return eventType(item) !== "other"; }

function normaliseMatchStats(data) {
  const allowed = new Set(["possessionPct", "totalShots", "shotsOnTarget", "wonCorners", "foulsCommitted", "offsides", "yellowCards", "redCards", "saves"]);
  const teams = (data?.boxscore?.teams || []).map(row => ({
    name: row?.team?.displayName || row?.team?.shortDisplayName || row?.team?.name || "Team",
    stats: Object.fromEntries((row?.statistics || []).filter(stat => allowed.has(stat?.name)).map(stat => [stat.name, { label: stat.label || stat.name, value: String(stat.displayValue ?? stat.value ?? "") }]))
  }));
  return teams.length === 2 ? { updatedAt: Date.now(), teams } : null;
}

function normaliseTeamName(value) {
  return String(value || "").toLowerCase().replace(/\b(fc|afc|city|town|united)\b/g, "").replace(/[^a-z0-9]/g, "");
}

function opposingTeam(team, fixture) {
  const target = normaliseTeamName(team);
  const home = fixture?.home?.name || "";
  const away = fixture?.away?.name || "";
  if (!target) return null;
  if (normaliseTeamName(home).includes(target) || target.includes(normaliseTeamName(home))) return away || null;
  if (normaliseTeamName(away).includes(target) || target.includes(normaliseTeamName(away))) return home || null;
  return null;
}

function foulCommittingTeam(event, fixture) {
  if (event?.type !== "foul") return event?.team || null;
  const text = String(event?.text || "").toLowerCase();
  const explicitOffender = text.match(/(?:^|\b)([^.]+?)\s+(?:commits?|committed|fouls?)\s+(?:a\s+)?foul\b/i);
  if (explicitOffender && event.team && !/wins?|draws?|earns?|awarded|on\b/i.test(explicitOffender[1])) return event.team;
  // ESPN commonly reports the fouled player/team, e.g. “Allan (Manchester
  // City) wins a foul”. The opponent is the team that committed it.
  if (/\b(?:wins?|draws?|earns?|is awarded)\s+(?:a\s+)?foul\b|\bfoul\s+on\b|\bfouled\b/.test(text)) {
    return opposingTeam(event.team, fixture) || null;
  }
  return event.team || null;
}

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
    const completedMatches = programme.filter(event => event.status?.type?.state === "post").slice(-3);
    // A new competition can have live/upcoming fixtures before the rolling
    // completed-match sample contains anything. Probe live events in that case
    // so a valid ESPN feed is not incorrectly held.
    const matches = completedMatches.length
      ? completedMatches
      : programme.filter(event => event.status?.type?.state === "in").slice(0, 3);
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

async function scoreboardEvents(sport, league, start, end, region = "gb") {
  const market = regionInfo(region).espn;
  const isNrl = sport === "rugby-league" && String(league) === "3";
  if (isNrl) return coreNrlEvents(sport, league, start, end, market);
  try {
    const ranged = await readJson(`${siteBase(sport)}/${leaguePath(league)}/scoreboard?dates=${start}-${end}&region=${market}&lang=en`);
    if (Array.isArray(ranged.events) && ranged.events.length) return ranged.events;
    throw new Error(ranged.message || "ESPN returned no ranged events");
  } catch {
    // UEFA scoreboard endpoints reject multi-day ranges even though their
    // single-day endpoints return the fixtures correctly.
    const dates = [...new Set([start, end, new Date().toISOString().slice(0, 10).replaceAll("-", "")])];
    const results = await Promise.all(dates.map(date => readJson(`${siteBase(sport)}/${leaguePath(league)}/scoreboard?dates=${date}&region=${market}&lang=en`)));
    return results.flatMap(result => result.events || []);
  }
}

async function readCoreReference(reference) {
  if (!reference) return null;
  return readJson(String(reference).replace(/^http:/, "https:"));
}

async function coreNrlEvents(sport, league, start, end, market) {
  // ESPN does not implement the normal site scoreboard endpoint for NRL.
  // Its Core API does expose the current programme and the complete live
  // event records, including status, score and team references.
  const programme = await readCoreReference(`${coreBase(sport, league)}/events?limit=100&lang=en&region=${market}`);
  const refs = (programme?.items || []).map(item => item?.["$ref"] || item?.ref).filter(Boolean);
  const events = await Promise.all(refs.map(readCoreReference));
  const from = Number(start), to = Number(end);
  return (await Promise.all(events.filter(Boolean).map(async event => {
    const competition = event.competitions?.[0] || {};
    const competitors = await Promise.all((competition.competitors || []).map(async competitor => {
      const team = competitor.team?.["$ref"] ? await readCoreReference(competitor.team["$ref"]) : competitor.team || {};
      let score = competitor.score;
      if (score && typeof score === "object" && score["$ref"]) {
        const scoreData = await readCoreReference(score["$ref"]);
        score = scoreData?.displayValue ?? scoreData?.value ?? scoreData?.score ?? null;
      }
      return { ...competitor, team, score };
    }));
    const status = competition.status?.["$ref"] ? await readCoreReference(competition.status["$ref"]) : competition.status || {};
    const broadcasts = competition.broadcasts?.["$ref"] ? await readCoreReference(competition.broadcasts["$ref"]) : competition.broadcasts;
    const broadcastRows = Array.isArray(broadcasts?.items) ? broadcasts.items : Array.isArray(broadcasts) ? broadcasts : [];
    return {
      id: String(event.id),
      name: event.name,
      date: event.date,
      status: { type: status?.type || status || {} },
      broadcasts: broadcastRows,
      competitions: [{ ...competition, competitors, status: { type: status?.type || status || {} }, broadcasts: broadcastRows }]
    };
  }))).filter(event => {
    const key = String(event.date || "").slice(0, 10).replaceAll("-", "");
    return !key || (key >= String(from) && key <= String(to));
  });
}
async function pullFixtures(broadcastRules = DEFAULT_BROADCAST_RULES, enabledCompetitions = DEFAULT_ENABLED_COMPETITIONS, region = "gb") {
  const now = Date.now();
  const selectedRegion = normaliseRegion(region);
  const enabled = new Set(normaliseEnabledCompetitions(enabledCompetitions));
  const start = new Date(now - 21 * 86400000).toISOString().slice(0, 10).replaceAll("-", "");
  const end = new Date(now + 7 * 86400000).toISOString().slice(0, 10).replaceAll("-", "");
  const programmes = await Promise.allSettled(SUPPORTED_COMPETITIONS.filter(config => enabled.has(`${config.sport}:${config.league}`)).map(async config => ({
    sport: config.sport,
    league: config.league,
    events: await scoreboardEvents(config.sport, config.league, start, end, selectedRegion)
  })));
  const coverageResults = await Promise.all(programmes.map(result => result.status === "fulfilled"
    ? validateLeague(result.value.sport, result.value.league, result.value.events)
    : ({ sport: "unknown", league: "unknown", approved: false, checkedAt: Date.now(), sampleSize: 0, matchesWithData: 0, averageEvents: 0, coverage: {}, reason: result.reason?.message || "programme pull failed" })));
  const coverage = Object.fromEntries(coverageResults.map(result => [`${result.sport}:${result.league}`, result]));
  // Keep the complete fetched programme available to the discovery
  // surface. The public endpoint selects today's fixtures.
  const published = programmes.flatMap(result => result.status === "fulfilled"
    ? result.value.events.map(item => {
        const config = competitionConfig(result.value.sport, result.value.league);
        const parsed = fixture(item);
        const broadcasts = broadcastsForFixture(parsed, config, selectedRegion);
        return { ...parsed, televised: broadcasts.length > 0, broadcasts, sport: config.sport, league: config.league, competition: config.name };
      })
    : []).filter(f => {
      const coverageKey = `${f.sport}:${f.league}`;
      // Discovery and event-coverage validation are separate concerns. A
      // fixture must not disappear from the catalogue merely because the
      // rolling play sample is unavailable for its competition.
      return f.televised === true
        && (!broadcastRules.ukPremierLeagueSaturdayBlackout || f.league !== "eng.1" || !inUkSaturdayClosedPeriod(f.date));
    });
  const fixtures = published.filter(f => {
    const kickoff = new Date(f.date || 0).getTime();
    const isLive = f.state === "in";
    const isUpcoming = f.state === "pre" && Number.isFinite(kickoff) && dateKey(f.date) === dateKey(now);
    return isLive || isUpcoming;
  }).sort((a, b) => {
    const byKickoff = new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime();
    if (byKickoff) return byKickoff;
    const byCompetition = (LEAGUE_HIERARCHY[a.league] ?? 999) - (LEAGUE_HIERARCHY[b.league] ?? 999);
    return byCompetition || a.name.localeCompare(b.name);
  });
  const completedFixtures = published.filter(f => f.state === "post" && dateKey(f.date) === dateKey(now))
    .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
  return { provider: "ESPN", fixtureIndexVersion: 6, fetchedAt: now, region: selectedRegion, regionLabel: regionInfo(selectedRegion).label, fixtures, completedFixtures, leagueCoverage: coverage, broadcastRules, enabledCompetitions: [...enabled] };
}
async function refreshFixtureIndex(env, region = "gb") {
  const id = env.FIXTURE_INDEX.idFromName("supported-fixtures");
  return env.FIXTURE_INDEX.get(id).fetch("https://fixture-index/refresh", { method: "POST", body: JSON.stringify({ region: normaliseRegion(region) }), headers: { "content-type": "application/json" } });
}
async function refreshConfiguredFixtureIndexes(env) {
  const id = env.FIXTURE_INDEX.idFromName("supported-fixtures");
  const response = await env.FIXTURE_INDEX.get(id).fetch(new Request("https://fixture-index/config"));
  const config = await response.json();
  const regions = normaliseEnabledRegions(config.enabledRegions);
  if (!regions.length) return json({ error: "Select at least one supported country before refreshing fixtures." }, 400);
  const results = await Promise.all(regions.map(region => refreshFixtureIndex(env, region)));
  const failed = results.find(result => !result.ok);
  return failed || results[0];
}
async function archiveCompletedFixture(env, fixture, leaderboard) {
  if (!env?.FIXTURE_INDEX || !fixture?.id) return;
  const id = env.FIXTURE_INDEX.idFromName("supported-fixtures");
  await env.FIXTURE_INDEX.get(id).fetch("https://fixture-index/complete-fixture", {
    method: "POST",
    body: JSON.stringify({ fixture, leaderboard, roomId: this.state.id.toString() }),
    headers: { "content-type": "application/json" }
  });
}
async function removeFixtureFromIndex(env, eventId) {
  if (!env?.FIXTURE_INDEX || !eventId) return;
  const id = env.FIXTURE_INDEX.idFromName("supported-fixtures");
  await env.FIXTURE_INDEX.get(id).fetch("https://fixture-index/remove", { method: "POST", body: JSON.stringify({ eventId }), headers: { "content-type": "application/json" } });
}
async function liveFixtures(request, env) {
  const url = new URL(request.url);
  const requestedRegion = url.searchParams.get("region");
  const region = requestedRegion ? normaliseRegion(requestedRegion) : regionForRequest(request);
  const id = env.FIXTURE_INDEX.idFromName("supported-fixtures");
  const configResponse = await env.FIXTURE_INDEX.get(id).fetch(new Request("https://fixture-index/config"));
  const config = await configResponse.json();
  if (!normaliseEnabledRegions(config.enabledRegions).includes(region)) return json({ error: `${regionInfo(region).label} is not currently supported` }, 403);
  // The fixture page is the discovery surface. Pull the current programme when
  // it is opened so today's fixtures do not depend on the background cron.
  let response = await refreshFixtureIndex(env, region);
  let data = await response.json();
  // If ESPN is temporarily unavailable, retain the last known catalogue.
  if (!response.ok) {
    response = await env.FIXTURE_INDEX.get(id).fetch(new Request(`https://fixture-index/fixtures?region=${region}`));
    data = await response.json();
  }
  const now = Date.now(), staleCutoff = now - 5 * 3600000, today = dateKey(now);
  // The fixture page is a day catalogue. Keep every supported fixture for
  // today's UK/local-region date; the two-hour rule belongs to live gameplay,
  // not discovery.
  data.fixtures = (data.fixtures || []).filter(item => {
    const kickoff = new Date(item.date || 0).getTime();
    const isToday = dateKey(item.date) === today;
    const isLive = item.state === "in" && kickoff > staleCutoff;
    const isUpcoming = item.state === "pre" && Number.isFinite(kickoff) && isToday;
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
    if (url.pathname === "/api/admin/refresh-fixtures" && request.method === "POST") return refreshConfiguredFixtureIndexes(env);
    if (url.pathname === "/api/admin/live-rooms" && request.method === "GET") { const id = env.FIXTURE_INDEX.idFromName("supported-fixtures"); return env.FIXTURE_INDEX.get(id).fetch(new Request("https://fixture-index/live-rooms")); }
    if (url.pathname === "/api/admin/kill-room" && request.method === "POST") {
      try {
        const input = await request.json();
        if (!input.roomId) return json({ error: "roomId is required" }, 400);
        const id = env.MATCH_ROOM.idFromString(String(input.roomId));
        return env.MATCH_ROOM.get(id).fetch(new Request("https://room/kill", { method: "POST" }));
      } catch (error) { return json({ error: error.message || "Could not kill room" }, 400); }
    }
    if (url.pathname === "/api/admin/fixture-config" && (request.method === "GET" || request.method === "POST")) { const id = env.FIXTURE_INDEX.idFromName("supported-fixtures"); return env.FIXTURE_INDEX.get(id).fetch(new Request(`https://fixture-index/config`, { method: request.method, body: request.method === "POST" ? await request.text() : undefined, headers: request.method === "POST" ? { "content-type": "application/json" } : undefined })); }
    if (url.pathname === "/api/live-fixtures") return liveFixtures(request, env);
    if (url.pathname.startsWith("/api/espn/")) { const response = await espnApi(url); if (response) return response; }
    if (url.pathname === "/api/room/fixture" && request.method === "POST") {
      try {
        const input = await request.json();
        if (!input.fixture?.id) return json({ error: "fixture.id is required" }, 400);
        const opened = await fixtureAccess(env, input.fixture);
        if (opened.locked) return json({ error: "too_early", message: "Called It has not opened for this fixture yet.", opensAt: opened.opensAt, kickoff: input.fixture.date, accessRules: opened.accessRules }, 403);
        const id = env.MATCH_ROOM.idFromName(`espn:${input.league || "eng.1"}:${input.fixture.id}`);
        return env.MATCH_ROOM.get(id).fetch(new Request("https://room/create", { method: "POST", body: JSON.stringify({ ...input, mode: input.mode === "simulation" ? "simulation" : "live" }), headers: { "content-type": "application/json" } }));
      } catch (error) { return json({ error: error.message || "Could not create fixture room" }, 400); }
    }
    if (url.pathname === "/api/room" && request.method === "POST") {
      const body = await request.text();
      let input = null;
      try { input = JSON.parse(body); } catch { /* MatchRoom will return the validation error. */ }
      const isLiveFixture = input?.mode !== "simulation" && input?.fixture?.id;
      if (isLiveFixture) {
        const opened = await fixtureAccess(env, input.fixture);
        if (opened.locked) return json({ error: "too_early", message: "Called It has not opened for this fixture yet.", opensAt: opened.opensAt, kickoff: input.fixture.date, accessRules: opened.accessRules }, 403);
      }
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
  scheduled(event, env, ctx) { ctx.waitUntil(refreshFixtureIndex(env, "gb")); }
};
export class FixtureIndex {
  constructor(state) { this.state = state; }
  async fetch(request) {
    if (request.method === "POST" && new URL(request.url).pathname === "/refresh") {
      try {
        const input = await request.json().catch(() => ({}));
        const region = normaliseRegion(input.region);
        const saved = await this.state.storage.get("fixtureConfig") || {};
        const broadcastRules = { ...DEFAULT_BROADCAST_RULES, ...(saved.broadcastRules || await this.state.storage.get("broadcastRules") || {}) };
        const enabledCompetitions = normaliseEnabledCompetitions(saved.enabledCompetitions);
        const enabledRegions = normaliseEnabledRegions(saved.enabledRegions);
        const accessRules = normaliseAccessRules(saved.accessRules);
        const data = await pullFixtures(broadcastRules, enabledCompetitions, region);
        data.fixtures = (data.fixtures || []).map(fixture => applyFixtureAccess(fixture, accessRules));
        data.completedFixtures = (data.completedFixtures || []).map(fixture => applyFixtureAccess(fixture, accessRules));
        data.accessRules = accessRules;
        data.enabledRegions = enabledRegions;
        const archivedFixtures = (await this.state.storage.get("completedFixtures") || [])
          .filter(item => dateKey(item.date) === dateKey(Date.now()));
        const completedFixtures = [...new Map([...archivedFixtures, ...(data.completedFixtures || [])]
          .filter(item => item?.id && dateKey(item.date) === dateKey(Date.now()))
          .map(item => [String(item.id), item])).values()];
        data.completedFixtures = completedFixtures;
        await this.state.storage.put("completedFixtures", completedFixtures);
        const previous = await this.state.storage.get(`index:${region}`);
        const dataIsEmpty = !(data.fixtures || []).length && !(data.completedFixtures || []).length;
        const previousIsSameDay = previous?.fetchedAt && dateKey(previous.fetchedAt) === dateKey(Date.now());
        if (dataIsEmpty && previousIsSameDay && ((previous.fixtures || []).length || (previous.completedFixtures || []).length)) {
          return json({ ...previous, refreshed: false, retainedPrevious: true });
        }
        await this.state.storage.put(`index:${region}`, data);
        return json({ ...data, refreshed: true });
      } catch (error) { return json({ error: error.message || "Could not refresh fixture index" }, 502); }
    }
    if (request.method === "GET" && new URL(request.url).pathname === "/fixtures") {
      const region = normaliseRegion(new URL(request.url).searchParams.get("region"));
      const data = await this.state.storage.get(`index:${region}`);
      return data ? json(data) : json({ error: "Fixture index has not been refreshed yet", region }, 404);
    }
    if (request.method === "GET" && new URL(request.url).pathname === "/config") {
      const saved = await this.state.storage.get("fixtureConfig") || {};
      const broadcastRules = { ...DEFAULT_BROADCAST_RULES, ...(saved.broadcastRules || await this.state.storage.get("broadcastRules") || {}) };
      return json({ broadcastRules, accessRules: normaliseAccessRules(saved.accessRules), enabledCompetitions: normaliseEnabledCompetitions(saved.enabledCompetitions), enabledRegions: normaliseEnabledRegions(saved.enabledRegions), regions: BROADCAST_REGIONS, competitions: SUPPORTED_COMPETITIONS });
    }
    if (request.method === "POST" && new URL(request.url).pathname === "/config") {
      try {
        const input = await request.json();
        const saved = await this.state.storage.get("fixtureConfig") || {};
        const broadcastRules = { ...DEFAULT_BROADCAST_RULES, ...(saved.broadcastRules || {}), ukPremierLeagueSaturdayBlackout: input.broadcastRules?.ukPremierLeagueSaturdayBlackout !== false };
        const accessRules = normaliseAccessRules(input.accessRules);
        const enabledCompetitions = normaliseEnabledCompetitions(input.enabledCompetitions);
        const enabledRegions = normaliseEnabledRegions(input.enabledRegions);
        await this.state.storage.put("fixtureConfig", { broadcastRules, accessRules, enabledCompetitions, enabledRegions });
        await this.state.storage.put("broadcastRules", broadcastRules);
        // Saving configuration is independent of the ESPN pull. The public
        // fixture page will use this selection on its next load or manual refresh.
        return json({ broadcastRules, accessRules, enabledCompetitions, enabledRegions, saved: true });
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
    if (request.method === "POST" && new URL(request.url).pathname === "/complete-fixture") {
      try {
        const input = await request.json();
        if (!input.fixture?.id) return json({ error: "fixture.id is required" }, 400);
        const completedFixtures = await this.state.storage.get("completedFixtures") || [];
        const completed = {
          ...input.fixture,
          state: "post",
          status: "Full Time",
          completed: true,
          completedAt: Date.now(),
          archiveVersion: 1,
          roomId: input.roomId || null,
          leaderboard: Array.isArray(input.leaderboard) ? input.leaderboard : []
        };
        const next = [completed, ...completedFixtures.filter(item => String(item.id) !== String(completed.id))]
          .filter(item => dateKey(item.date) === dateKey(Date.now()));
        await this.state.storage.put("completedFixtures", next);
        for (const region of BROADCAST_REGIONS.map(item => item.code)) {
          const index = await this.state.storage.get(`index:${region}`);
          if (index) {
            index.fixtures = (index.fixtures || []).filter(item => String(item.id) !== String(completed.id));
            index.completedFixtures = next;
            await this.state.storage.put(`index:${region}`, index);
          }
        }
        return json({ saved: true, fixture: completed });
      } catch (error) { return json({ error: error.message || "Could not archive completed fixture" }, 400); }
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
    const data = await this.state.storage.get("index:gb") || await this.state.storage.get("index");
    return data ? json(data) : json({ error: "Fixture index has not been refreshed yet", region: "gb" }, 404);
  }
}
export class MatchRoom {
  constructor(state, env) { this.state = state; this.env = env; this.sockets = new Set(state.getWebSockets ? state.getWebSockets() : []); this.room = null; }
  async fetch(request) {
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair(); this.state.acceptWebSocket(pair[1]); this.sockets.add(pair[1]);
      if (!this.room) await this.load();
      if (this.room.fixture?.id && this.room.mode === "live") { await this.refreshLive(); this.room.preMatch = this.repairScorerQuestions(this.room.preMatch); this.room.playerPreMatch = Object.fromEntries(Object.entries(this.room.playerPreMatch || {}).map(([playerId, questions]) => [playerId, this.repairScorerQuestions(questions)])); if (!this.room.players.length && !Object.keys(this.room.predictions || {}).length) this.room.preMatch = this.buildPreMatch(); this.anchorLiveSchedule(); this.settlePreMatch(this.room.session.clock || 0); await this.save(); if (this.room.session.status === "running") await this.advance(); }
      pair[1].send(JSON.stringify({ type: "state", state: this.public() }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (request.method === "POST" && new URL(request.url).pathname === "/kill") {
      await this.load();
      await this.removeAdminRoom();
      for (const socket of this.sockets) { try { socket.close(1000, "Room ended by admin"); } catch {} }
      this.sockets.clear();
      await this.state.storage.deleteAlarm();
      await this.state.storage.delete("room");
      this.room = null;
      return json({ killed: true });
    }
    if (request.method === "POST" && !this.room) {
      await this.load();
      try {
        const input = await request.json();
        if (input.fixture) {
          this.room.fixture = input.fixture;
          this.room.provider = { name: "ESPN", sport: input.sport || input.fixture.sport || "soccer", league: input.league || "eng.1", eventId: input.fixture.id, error: null };
          this.room.timeline = (input.events || []).filter(e => e && e.offset != null).map(e => ({ id: String(e.id), type: e.type, offset: Number(e.offset), minute: e.minute, text: e.text, team: e.team || null, committingTeam: foulCommittingTeam(e, this.room.fixture), athletes: e.athletes || [] })); this.room.mode = input.mode === "simulation" ? "simulation" : "live"; this.room.speed = Math.max(1, Math.min(50, Number(input.speed) || 1)); this.room.session.mode = this.room.mode; this.room.session.speed = this.room.speed; this.room.session.manualPaused = false; this.room.preMatch = this.buildPreMatch();
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
      timeline: [], preMatch: [], callArchive: [], matchStats: null, mode: "live", speed: 1, session: { status: "lobby", startedAt: null, round: null, clock: 0, clockBase: 0, speed: 1 }, players: [], predictions: {}, leaderboard: [],
      events: [{ label: "Fixture room opened", detail: "Live data from ESPN" }], lastProviderEventIds: [], lastLivePollAt: 0
    };
    this.room.callArchive ||= [];
    const ensureNoGoalChoice = question => {
      if (!question || !["first-goal-team", "next-goal-team"].includes(question.type) && question.targetType !== "goal") return;
      question.choices ||= [];
      if (!question.choices.some(choice => choice.key === "none")) question.choices.push({ key: "none", label: question.type === "first-goal-team" ? "No goals" : "No further goals" });
    };
    for (const question of this.room.preMatch || []) ensureNoGoalChoice(question);
    for (const questions of Object.values(this.room.playerPreMatch || {})) for (const question of questions || []) ensureNoGoalChoice(question);
    for (const round of [...(this.room.session?.rounds || []), this.room.session?.round].filter(Boolean)) ensureNoGoalChoice(round);
    const knownRounds = [...(this.room.session?.rounds || []), this.room.session?.round].filter(Boolean);
    for (const round of knownRounds) {
      if (!this.room.callArchive.some(call => String(call.id) === String(round.id))) {
        this.room.callArchive.push({
          id: round.id,
          question: round.question,
          type: round.targetType,
          choices: (round.choices || []).map(choice => ({ key: choice.key, label: choice.label })),
          presentedAtClock: round.presentedAtClock ?? null,
          presentedAtClockDisplay: round.presentedAtClockDisplay ?? null,
          presentedMatchTime: round.presentedMatchTime || null,
          openedAt: round.openedAt || null
        });
      }
    }
  }
  async save() { this.room.lastActivity = Date.now(); await this.state.storage.put("room", this.room); await this.state.storage.setAlarm(Date.now() + 7200000); await this.syncAdminRoom(); }
  async syncAdminRoom(force = false) {
    if (!this.room?.fixture?.id || !this.env?.FIXTURE_INDEX || (!force && Date.now() - (this.adminSyncAt || 0) < 10000)) return;
    this.adminSyncAt = Date.now();
    const rounds = [...(this.room.session?.rounds || []), this.room.session?.round].filter(Boolean).map(round => ({ id: round.id, type: round.targetType, question: round.question, status: round.status, result: round.result || null, openedAt: round.openedAt || null, presentedMatchTime: round.presentedMatchTime || null, voteEndsAt: round.voteEndsAt || null }));
    const summary = { roomId: this.state.id.toString(), updatedAt: this.adminSyncAt, fixture: this.room.fixture, session: { status: this.room.session?.status, clock: this.room.session?.clock || 0, clockDisplay: this.room.session?.clockDisplay || null, nextQuestionAt: this.room.session?.nextQuestionAt || null }, playerCount: this.room.players?.length || 0, players: (this.room.players || []).map(player => ({ name: player.name, points: player.points || 0, calls: player.calls || player.rounds || 0, correct: player.correct || 0 })), calls: rounds, provider: { lastLivePollAt: this.room.lastLivePollAt || 0, lastErrorAt: this.room.provider?.lastErrorAt || 0, error: this.room.provider?.error || null, errorCount: this.room.provider?.errorCount || 0, pollIntervalSeconds: this.room.provider?.pollIntervalSeconds || 15, playsProcessed: this.room.provider?.playsProcessed || 0, playsSource: this.room.provider?.playsSource || null } };
    try { const id = this.env.FIXTURE_INDEX.idFromName("supported-fixtures"); await this.env.FIXTURE_INDEX.get(id).fetch("https://fixture-index/register-room", { method: "POST", body: JSON.stringify(summary), headers: { "content-type": "application/json" } }); } catch {}
  }
  async archiveCompletedFixture() {
    await archiveCompletedFixture(this.env, this.room.fixture, this.room.leaderboard || []);
  }
  async removeAdminRoom() { if (!this.env?.FIXTURE_INDEX) return; try { const id = this.env.FIXTURE_INDEX.idFromName("supported-fixtures"); await this.env.FIXTURE_INDEX.get(id).fetch("https://fixture-index/remove-room", { method: "POST", body: JSON.stringify({ roomId: this.state.id.toString() }), headers: { "content-type": "application/json" } }); } catch {} }
  public() {
    if (this.room.fixture?.id && !this.room.preMatch?.length) this.room.preMatch = this.buildPreMatch();
    const rounds = [...(this.room.session?.rounds || []), this.room.session?.round].filter(Boolean);
    const answerLabel = (item, answer) => item?.choices?.find(choice => choice.key === answer)?.label || (answer === "home" ? this.room.fixture?.home?.name || "Home" : answer === "away" ? this.room.fixture?.away?.name || "Away" : String(answer || ""));
    const statusFor = (item, answer) => {
      if (item?.status === "settled" || item?.settled) return item.result?.correct && answer === item.result.correct ? "Correct" : "Missed";
      if (item?.status === "locked") return "Locked";
      return "Committed";
    };
    const committedCalls = this.room.players.map(player => {
      const predictions = this.room.predictions[player.id] || {}, calls = [];
      const knownQuestions = [...(this.room.preMatch || []), ...(this.room.playerPreMatch?.[player.id] || []), ...(this.room.session?.rounds || []), this.room.session?.round, ...(this.room.callArchive || [])].filter(Boolean);
      const added = new Set();
      const addCall = (id, question, answer, status, matchTime) => {
        if (answer == null || added.has(String(id))) return;
        added.add(String(id)); calls.push({ id, question: question?.question || question?.label || String(question || "Call"), answer: answerLabel(question, answer), status: statusFor(question, answer) || status || "Committed", matchTime });
      };
      for (const record of (player.callRecords || [])) {
        const question = knownQuestions.find(item => String(item.id) === String(record.id));
        // Keep the immutable call snapshot for provenance, but use the
        // authoritative live question when it has since been settled. The
        // previous synthetic snapshot masked result/status and made every
        // call appear permanently "Committed".
        const callQuestion = question
          ? { ...question, question: question.question || record.question, choices: question.choices?.length ? question.choices : (record.choices || []) }
          : { question: record.question || "Question unavailable", choices: record.choices || [] };
        addCall(record.id, callQuestion, record.answer, "Committed", record.matchTime || "IN PLAY");
      }
      for (const question of [...(this.room.preMatch || []), ...(this.room.playerPreMatch?.[player.id] || [])]) {
        const answer = predictions.pre?.[question.id];
        addCall(question.id, question, answer, "Committed", question.type?.startsWith("next-") ? "IN PLAY" : "BEFORE KICK-OFF");
      }
      for (const round of rounds) {
        const answer = predictions[round.id];
        const resolvingEvent = round.result?.eventId ? this.room.timeline.find(event => String(event.id) === String(round.result.eventId)) : null;
        const resolvedAt = round.status === "settled" && resolvingEvent?.minute != null ? `${resolvingEvent.minute}'` : null;
        addCall(round.id, round, answer, "Committed", resolvedAt || round.presentedMatchTime || formatMatchTime(round.presentedAtClock, round.presentedAtClockDisplay));
      }
      for (const [id, answer] of Object.entries(predictions.pre || {})) {
        addCall(id, knownQuestions.find(item => String(item.id) === String(id)) || { question: "Question unavailable" }, answer, "Committed", "BEFORE KICK-OFF");
      }
      for (const [id, answer] of Object.entries(predictions)) {
        if (id === "pre") continue;
        addCall(id, knownQuestions.find(item => String(item.id) === String(id)) || { question: "Question unavailable" }, answer, "Committed", "IN PLAY");
      }
      return { id: player.id, name: player.name, calls, points: player.points || 0, correct: player.correct || 0 };
    });
    const settledEventIds = [...(this.room.preMatch || []), ...rounds].map(item => item.result?.eventId).filter(Boolean).map(String);
    const playerPreMatch = Object.fromEntries(Object.entries(this.room.playerPreMatch || {}));
    const renderedPlayers = this.room.players.map(player => {
      const { token, ...safePlayer } = player;
      return {
      ...safePlayer,
      calls: committedCalls.find(item => String(item.id) === String(player.id))?.calls.length || 0
      };
    });
    return { ...this.room, players: renderedPlayers, predictions: undefined, playerStatus: Object.fromEntries(this.room.players.map(p => [p.id, Object.keys(this.room.predictions[p.id]?.pre || {})])), playerPreMatch, committedCalls, settledEventIds };
  }
  broadcast() { this.sockets = new Set(this.state.getWebSockets ? this.state.getWebSockets() : this.sockets); const m = JSON.stringify({ type: "state", state: this.public() }); for (const ws of this.sockets) { try { ws.send(m); } catch {} } }
  schedule(ms) { this.state.storage.setAlarm(Date.now() + Math.max(250, Math.min(ms, 7200000))); }
  providerPollDelayMs() { const seconds = Number(this.room?.provider?.pollIntervalSeconds) || 15; return Math.max(15000, Math.min(120000, seconds * 1000)); }
  lineupChoices() {
    return [...new Map((this.room.lineups || []).map(player => [player.key, { key: player.key, label: player.label, team: player.team }])).values()];
  }
  repairScorerQuestions(questions) {
    const choices = this.lineupChoices();
    return (questions || []).flatMap(question => {
      if (question.type !== "first-goalscorer" || question.settled) return [question];
      if (choices.length) return [{ ...question, choices }];
      // Older rooms may have persisted the scorer question before ESPN
      // returned line-ups. Never leave a player on an unanswerable screen.
      return [];
    });
  }
  buildPreMatch(lateJoin = false, playerId = "") {
    const f = this.room.fixture || {}, home = f.home?.name || "Home", away = f.away?.name || "Away";
    const suffix = lateJoin ? "-" + playerId : "";
    // A late joiner is always calling on the next occurrence. The current
    // timeline is the baseline, so events already seen cannot settle the call.
    const nextGoal = lateJoin;
    const nextGoalKick = lateJoin;
    const nextFoul = lateJoin;
    const baselineEventIds = lateJoin ? this.room.timeline.map(event => String(event.id)) : [];
    const currentMinutes = Math.min(120, Math.max(0, Math.floor(Number(this.room.session?.clock || 0) / 60)));
    const after = (enabled, type) => enabled
      ? Math.max(this.room.session?.clock || 0, ...this.room.timeline.filter(event => event.type === type).map(event => Number(event.offset) || 0))
      : null;
    return [
      { id: (nextGoal ? "next-goal-team" : "first-goal-team") + suffix, type: nextGoal ? "next-goal-team" : "first-goal-team", question: nextGoal ? "Which team scores next?" : "Which team scores first?", choices: [{ key: "home", label: home }, { key: "away", label: away }, { key: "none", label: nextGoal ? "No further goals" : "No goals" }], settled: false, result: null, afterOffset: after(nextGoal, "goal"), baselineEventIds },
      ...((lateJoin || !this.lineupChoices().length) ? [] : [{ id: "first-goalscorer", type: "first-goalscorer", question: "Who scores first?", choices: this.lineupChoices(), settled: false, result: null, afterOffset: null, baselineEventIds }]),
      { id: (nextGoalKick ? "next-goal-kick-time" : "first-goal-kick-time") + suffix, type: nextGoalKick ? "next-goal-kick-time" : "first-goal-kick-time", question: nextGoalKick ? "What’s the time of the next goal kick?" : "What’s the time of the first goal kick?", input: { min: 0, max: 120, step: 1, value: currentMinutes, suffix: "minutes", lateJoin: nextGoalKick }, choices: [], settled: false, result: null, afterOffset: after(nextGoalKick, "goal-kick"), baselineEventIds },
      { id: (nextFoul ? "next-foul-team" : "first-foul-team") + suffix, type: nextFoul ? "next-foul-team" : "first-foul-team", question: nextFoul ? "Which team commits the next foul?" : "Which team commits the first foul?", choices: [{ key: "home", label: home }, { key: "away", label: away }], settled: false, result: null, afterOffset: after(nextFoul, "foul"), baselineEventIds }
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
  async refreshLive(forceBackfill = false) {
    if (!this.room.fixture?.id || this.room.mode !== "live") return;
    const league = this.room.provider?.league || "eng.1", config = competitionConfig(this.room.provider?.sport, league), sport = config.sport, id = this.room.provider.eventId;
    try {
      const coreUrl = `${coreBase(sport, league)}/events/${encodeURIComponent(id)}/competitions/${encodeURIComponent(id)}`;
      const paginateCore = forceBackfill;
      const [summary, core] = await Promise.allSettled([
        readJson(`${siteBase(sport)}/${leaguePath(league)}/summary?event=${encodeURIComponent(id)}`),
        paginateCore ? readCorePlays(coreUrl) : readCorePlayPage(coreUrl)
      ]);
      if (summary.status !== "fulfilled") throw summary.reason;
      const data = summary.value;
      this.room.matchStats = normaliseMatchStats(data) || this.room.matchStats || null;
      const competition = data.header?.competitions?.[0] || data.competitions?.[0] || {};
      const nextFixture = fixture({ id, name: competition.shortName || competition.name, date: competition.date || this.room.fixture.date, competitions: [{ ...competition, competitors: competition.competitors || [] }], status: competition.status });
      this.room.fixture = { ...this.room.fixture, ...nextFixture, home: { ...this.room.fixture.home, ...nextFixture.home }, away: { ...this.room.fixture.away, ...nextFixture.away } };
      const rosterSource = data.rosters || data.lineups || data.boxscore?.rosters || [];
      const rosterRows = Array.isArray(rosterSource) ? rosterSource : Object.values(rosterSource || {});
      const lineups = rosterRows.flatMap(row => {
        const entries = row.roster || row.players || row.athletes || [];
        const team = row.team?.displayName || row.team?.shortDisplayName || row.team?.name || "";
        return (Array.isArray(entries) ? entries : Object.values(entries || {})).map(item => {
          const athlete = item.athlete || item.player || item;
          const label = athlete.displayName || athlete.fullName || athlete.shortName || athlete.name;
          return label ? { key: "player:" + String(label).toLowerCase().replace(/[^a-z0-9]/g, ""), label, team } : null;
        });
      }).filter(Boolean);
      if (lineups.length) this.room.lineups = lineups;
      const now = Date.now();
      const coreItems = core.status === "fulfilled" ? (core.value.items || []) : [];
      const source = coreItems.length ? "core-live" : "summary-live-fallback";
      // Core polling can return only the newest page while ESPN summary still
      // contains earlier scoring plays. Merge both so the scoreboard cannot
      // know the score without also retaining the scorer event.
      const enrichEvent = event => {
        if (event.type !== "goal") return event;
        const text = String(event.text || "");
        if (!event.athletes?.length) {
          const scorer = text.match(/\.\s*([^.(]+?)\s*\(([^)]+)\)/);
          if (scorer?.[1]) event.athletes = [scorer[1].trim()];
        }
        if (!event.team) {
          const scorerTeam = text.match(/\(([^)]+)\)/)?.[1] || "";
          const fixtureTeams = [this.room.fixture?.home?.name, this.room.fixture?.away?.name].filter(Boolean);
          const matchedTeam = fixtureTeams.find(team => {
            const left = normaliseTeamName(team), right = normaliseTeamName(scorerTeam);
            return left && right && (left.includes(right) || right.includes(left));
          });
          if (matchedTeam) event.team = matchedTeam;
        }
        return event;
      };
      const summaryItems = [...(data.plays || []), ...(data.scoringPlays || []), ...(data.keyEvents || [])];
      const incoming = [...coreItems.map((item, index) => normaliseEvent(item, index, source)), ...summaryItems.map((item, index) => normaliseEvent(item, index, "summary-live"))]
        .map(enrichEvent)
        .filter(event => event.offset != null && event.type !== "other")
        .filter((event, index, events) => events.findIndex(candidate => `${candidate.type}|${candidate.offset}|${candidate.text}` === `${event.type}|${event.offset}|${event.text}`) === index);
      const byId = new Map(this.room.timeline.map(event => [String(event.id), event]));
      const byShape = new Map(this.room.timeline.map(event => [`${event.type}|${event.offset}|${event.text}`, event]));
      for (const event of incoming) {
        const key = `${event.type}|${event.offset}|${event.text}`;
        const existing = byId.get(String(event.id)) || byShape.get(key);
        if (existing) {
          // ESPN may enrich the same play on a later poll with its team or
          // athlete. Update the canonical event instead of dropping it.
          Object.assign(existing, {
            type: event.type,
            offset: event.offset,
            minute: event.minute ?? existing.minute,
            text: event.text || existing.text,
            team: event.team || existing.team || null,
            committingTeam: event.type === "foul" ? (foulCommittingTeam(event, this.room.fixture) || existing.committingTeam || null) : (event.team || existing.committingTeam || null),
            athletes: event.athletes?.length ? event.athletes : (existing.athletes || []),
            valid: event.valid !== false,
            scoringPlay: event.scoringPlay || existing.scoringPlay || false
          });
          byId.set(String(event.id), existing);
          byShape.set(key, existing);
          continue;
        }
        const canonical = { id: event.id, type: event.type, offset: event.offset, minute: event.minute, text: event.text, team: event.team || null, committingTeam: foulCommittingTeam(event, this.room.fixture), athletes: event.athletes || [], valid: event.valid !== false, scoringPlay: event.scoringPlay || false };
        this.room.timeline.push(canonical);
        byId.set(String(event.id), canonical);
        byShape.set(key, canonical);
        this.room.events.unshift({ label: event.type === "goal" ? "GOAL" : "Match update", detail: event.text });
      }
      const reversalEvents = incoming.filter(event => event.type === "var" && /no goal|goal (?:disallowed|overturned|cancelled)|(?:disallowed|overturned|cancelled).*goal|var.*(?:no goal|disallowed|overturned|cancelled)/i.test(String(event.text || "")));
      const invalidGoalIds = new Set(incoming.filter(event => event.type === "goal" && event.valid === false).map(event => String(event.id)));
      for (const reversal of reversalEvents) {
        const candidate = this.room.timeline
          .filter(event => event.type === "goal" && event.valid !== false && Number(event.offset) <= Number(reversal.offset) && Number(reversal.offset) - Number(event.offset) <= 180)
          .sort((a, b) => Number(b.offset) - Number(a.offset))[0];
        if (candidate) invalidGoalIds.add(String(candidate.id));
      }
      if (invalidGoalIds.size) {
        // Keep the raw event history intact. VAR changes its validity, not its provenance.
        for (const event of this.room.timeline) {
          if (invalidGoalIds.has(String(event.id))) {
            event.valid = false;
            event.invalidated = true;
          }
        }
        const allRounds = [...(this.room.session?.rounds || []), this.room.session?.round].filter(Boolean);
        for (const round of allRounds) {
          if (!invalidGoalIds.has(String(round.result?.eventId))) continue;
          const correct = round.result?.correct;
          for (const player of this.room.players) {
            const answer = this.room.predictions[player.id]?.[round.id];
            if (correct && answer === correct) {
              player.points = Math.max(0, (player.points || 0) - 100);
              player.correct = Math.max(0, (player.correct || 0) - 1);
            }
          }
          round.result = null;
          round.status = "locked";
        }
        this.room.events.unshift({ label: "VAR overturn", detail: "A provisional goal was removed" });
      }
      this.room.timeline.sort((a, b) => a.offset - b.offset);
      const homeName = String(this.room.fixture.home?.name || "").toLowerCase();
      const awayName = String(this.room.fixture.away?.name || "").toLowerCase();
      const goals = this.room.timeline.filter(event => event.type === "goal" && event.valid !== false && !event.invalidated);
      const homeGoals = goals.filter(event => String(event.team || "").toLowerCase() === homeName).length;
      const awayGoals = goals.filter(event => String(event.team || "").toLowerCase() === awayName).length;
      if (homeGoals || awayGoals || this.room.timeline.some(event => event.type === "goal")) {
        this.room.fixture.home.score = homeGoals;
        this.room.fixture.away.score = awayGoals;
      }
      this.room.lastProviderEventIds = this.room.timeline.map(e => e.id);
      this.room.lastLivePollAt = Date.now();
      this.room.provider.error = null;
      this.room.provider.errorCount = 0;
      this.room.provider.playsSource = source;
      this.room.provider.playsProcessed = incoming.length;
      this.room.provider.pollIntervalSeconds = 15;
      this.room.provider.corePaginationIntervalSeconds = 60;
      if (paginateCore) this.room.lastCorePaginationAt = now;
      if (this.room.session.status === "running" || this.room.fixture?.state === "in") { const liveClock = this.liveClock(nextFixture, data); this.room.session.clock = liveClock.seconds; this.room.session.clockDisplay = liveClock.display; }
    } catch (error) {
      const errorCount = (Number(this.room.provider.errorCount) || 0) + 1;
      this.room.provider.error = error.message || "Live feed unavailable";
      this.room.provider.errorCount = errorCount;
      this.room.provider.lastErrorAt = Date.now();
      this.room.provider.pollIntervalSeconds = Math.min(120, 15 * (2 ** Math.min(errorCount, 3)));
    }
  }
  liveClock(fixtureData, summary) {
    const status = fixtureData.status || {};
    const providerStatus = summary?.header?.competitions?.[0]?.status || summary?.competitions?.[0]?.status || {};
    const detail = String(status.shortDetail || status.detail || "").trim();
    const rawClock = String(providerStatus.displayClock ?? providerStatus.clockDisplay ?? status.displayClock ?? "").trim();
    const numericClock = Number(providerStatus.clock);
    const stoppage = rawClock.match(/^(\d{1,3})\s*(?:\+|['’])\s*(\d{1,2})$/) || detail.match(/(?:^|\s)(\d{1,3})\s*(?:\+|['’])\s*(\d{1,2})(?:\s|$)/);
    if (stoppage) {
      const minutes = Number(stoppage[1]), extra = Number(stoppage[2]);
      return { seconds: Number.isFinite(numericClock) && numericClock > 0 ? numericClock : (minutes + extra) * 60, display: minutes + "+" + extra };
    }
    if (Number.isFinite(numericClock) && numericClock > 0) {
      return { seconds: numericClock, display: null };
    }
    const normalClock = rawClock.match(/^(\d{1,3})\s*:\s*(\d{1,2})$/) || detail.match(/(?:^|\s)(\d{1,3})\s*:\s*(\d{1,2})(?:\s|$)/);
    if (normalClock) {
      const minutes = Number(normalClock[1]), seconds = Number(normalClock[2]);
      return { seconds: minutes * 60 + seconds, display: minutes + ":" + String(seconds).padStart(2, "0") };
    }
    const minuteOnly = rawClock.match(/^(\d{1,3})\s*['’]?$/) || detail.match(/(?:^|\s)(\d{1,3})\s*['’](?:\s|$)/);
    if (minuteOnly) {
      const minutes = Number(minuteOnly[1]);
      return { seconds: minutes * 60, display: null };
    }
    const timelineSeconds = Math.max(0, ...this.room.timeline.map(event => Number(event.offset) || 0));
    return { seconds: Math.max(this.room.session.clock || 0, timelineSeconds), display: null };
  }
  nextLiveType() {
    const types = this.room.provider?.sport === "rugby-league"
      ? ["goal", "substitution"]
      : ["corner", "foul", "shot", "goal-kick", "substitution", "goal", "card"];
    return types[(Number(this.room.session.nextRoundIndex) || 0) % types.length];
  }
  liveQuestion(type) {
    return ({
      corner: "Which team gets the next corner?",
      foul: "Which team commits the next foul?",
      shot: "Which team has the next shot?",
      "goal-kick": "Which team gets the next goal kick?",
      substitution: "Which team makes the next substitution?",
      goal: "Which team scores next?",
      card: "Which team gets the next card?"
    })[type] || "Which team has the next match event?";
  }
  anchorLiveSchedule(now = Date.now()) {
    const kickoff = Date.parse(this.room.fixture?.date);
    if (!Number.isFinite(kickoff)) {
      if (!this.room.session.nextQuestionAt) this.room.session.nextQuestionAt = now + LIVE_CALL_INTERVAL_MS;
      return;
    }
    // ESPN can return a slightly different/normalised fixture date after the
    // first request. Never re-anchor an already-running room on reconnect,
    // otherwise a page refresh can make the same call slot appear due again.
    if (!Number.isFinite(Number(this.room.session.liveScheduleKickoff))) {
      this.room.session.liveScheduleKickoff = kickoff;
      if (!this.room.session.nextQuestionAt) this.room.session.nextQuestionAt = nextLiveCallAt(this.room.fixture, now);
    } else if (this.room.session.status === "lobby" && this.room.session.liveScheduleKickoff !== kickoff) {
      this.room.session.liveScheduleKickoff = kickoff;
      this.room.session.nextQuestionAt = nextLiveCallAt(this.room.fixture, now);
    }
  }
  async openLiveRound() {
    const scheduledCallAt = Number(this.room.session.nextQuestionAt) || nextLiveCallAt(this.room.fixture);
    const rounds = [...(this.room.session.rounds || []), this.room.session.round].filter(Boolean);
    const existing = rounds.find(round => Number(round.scheduledCallAt) === scheduledCallAt || (Number(round.openedAt) > 0 && Math.abs(Number(round.openedAt) - scheduledCallAt) <= 120000));
    if (existing) {
      this.room.session.nextQuestionAt = scheduledCallAt + LIVE_CALL_INTERVAL_MS;
      // Keep the single room-level ESPN poll alive while a call is open.
      // The next call cadence is independent of provider polling.
      await this.save(); this.broadcast(); this.schedule(this.providerPollDelayMs());
      return;
    }
    const type = this.nextLiveType(), f = this.room.fixture || {};
    if (this.room.session.round) {
      this.room.session.rounds ||= [];
      if (!this.room.session.rounds.some(existingRound => String(existingRound.id) === String(this.room.session.round.id))) {
        this.room.session.rounds.push(this.room.session.round);
      }
    }
    const presentedAtClock = Number(this.room.session.clock) || 0, presentedAtClockDisplay = this.room.session.clockDisplay || null;
    const choices = [{ key: "home", label: f.home?.name || "Home" }, { key: "away", label: f.away?.name || "Away" }];
    if (type === "goal") choices.push({ key: "none", label: "No further goals" });
    const round = { id: "round-" + (this.room.session.nextRoundIndex || 0), scheduledCallAt, targetEventId: null, targetType: type, question: this.liveQuestion(type), choices, status: "voting", warmupEndsAt: null, voteEndsAt: null, result: null, openedAt: Date.now(), presentedAtClock, presentedAtClockDisplay, presentedMatchTime: formatMatchTime(presentedAtClock, presentedAtClockDisplay), baselineEventIds: this.room.timeline.map(e => e.id) };
    this.room.callArchive ||= [];
    if (!this.room.callArchive.some(call => String(call.id) === String(round.id))) {
      this.room.callArchive.push({
        id: round.id,
        question: round.question,
        type: round.targetType,
        choices: round.choices.map(choice => ({ key: choice.key, label: choice.label })),
        presentedAtClock: round.presentedAtClock,
        presentedAtClockDisplay: round.presentedAtClockDisplay,
        presentedMatchTime: round.presentedMatchTime,
        openedAt: round.openedAt
      });
    }
    this.room.session.lastQuestionType = type; this.room.session.round = round; this.room.session.nextRoundIndex = (this.room.session.nextRoundIndex || 0) + 1; this.room.session.nextQuestionAt = scheduledCallAt + LIVE_CALL_INTERVAL_MS;
    this.room.events.unshift({ label: "Vote now", detail: round.question });
    // Continue polling ESPN every 15 seconds while this call is open.
    // Call creation remains anchored to nextQuestionAt and is handled by the
    // next alarm; this remains one alarm per active room, not per player.
    await this.save(); this.broadcast(); this.schedule(this.providerPollDelayMs());
  }
  targetForQuestion(q) { return this.room.timeline.find(e => (((q.type === "first-goal-team" || q.type === "next-goal-team" || q.type === "first-goalscorer") && e.type === "goal") || ((q.type === "first-goal-kick-time" || q.type === "next-goal-kick-time") && e.type === "goal-kick") || ((q.type === "first-foul-team" || q.type === "next-foul-team") && e.type === "foul")) && !(q.baselineEventIds || []).includes(String(e.id)) && (q.afterOffset == null || e.offset > q.afterOffset)); }
  keyForQuestion(q, target) {
    if (!target) return null;
    if (q.type === "first-goalscorer" || q.type === "first-goalscorer-" + String(q.id).split("-").pop()) {
      const normalisePlayer = value => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const scorerNames = (target.athletes || []).map(normalisePlayer).filter(Boolean);
      const match = (q.choices || []).find(choice => scorerNames.includes(normalisePlayer(choice.label)));
      return match?.key || null;
    }
    if (q.type === "first-goal-kick-time" || q.type === "next-goal-kick-time") return String(Math.floor((target.offset || 0) / 60));
    const f = this.room.fixture || {}, normalise = normaliseTeamName;
    const targetName = normalise(target.type === "foul" ? (target.committingTeam || foulCommittingTeam(target, f)) : (target.team || target.text));
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
      if (!target || (this.room.mode !== "live" && target.offset > clock)) continue;
      const correct = this.keyForQuestion(q, target); q.settled = true; q.result = { correct, event: target.text || "Event occurred", eventId: target.id }; changed = true;
      const players = set.playerId ? this.room.players.filter(p => p.id === set.playerId) : this.room.players;
      for (const p of players) { const answer = this.room.predictions[p.id]?.pre?.[q.id]; if (answer) p.calls = Math.max(p.calls || 0, Object.keys(this.room.predictions[p.id]?.pre || {}).length); if (correct && answer === correct) { p.points = (p.points || 0) + 100; p.correct = (p.correct || 0) + 1; } }
    }
    if (changed) this.rebuildLeaderboard(); return changed;
  }
  rebuildLeaderboard() { this.room.leaderboard = [...this.room.players].sort((a,b) => (b.points||0)-(a.points||0)).map((p,i) => ({ rank:i+1, name:p.name, points:p.points||0, rounds:p.calls ?? p.rounds ?? 0 })); }
  async startSession() {
    if (this.room.mode === "live") { this.room.session = { status: "running", startedAt: Date.now(), round: null, clock: this.room.session.clock || 0, nextRoundIndex: 0, nextQuestionAt: nextLiveCallAt(this.room.fixture), liveScheduleKickoff: Date.parse(this.room.fixture?.date), mode: "live", speed: 1, lastQuestionType: null }; await this.save(); this.broadcast(); this.schedule(1000); return; }
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
  async finishLiveSession() {
    const session = this.room.session;
    const settleGoalQuestion = (question, playerId = null) => {
      if (!question || question.settled || !["first-goal-team", "next-goal-team"].includes(question.type)) return;
      const target = this.targetForQuestion(question);
      const correct = target ? this.keyForQuestion(question, target) : "none";
      question.settled = true;
      question.result = { correct, event: target?.text || (question.type === "next-goal-team" ? "Full time — no further goals" : "Full time — no goals"), eventId: target?.id || null };
      const players = playerId ? this.room.players.filter(player => player.id === playerId) : this.room.players;
      for (const player of players) {
        const answer = this.room.predictions[player.id]?.pre?.[question.id];
        if (answer) player.calls = Math.max(player.calls || 0, Object.keys(this.room.predictions[player.id]?.pre || {}).length);
        if (answer && correct && answer === correct) { player.points = (player.points || 0) + 100; player.correct = (player.correct || 0) + 1; }
      }
    };
    for (const question of this.room.preMatch || []) settleGoalQuestion(question);
    for (const [playerId, questions] of Object.entries(this.room.playerPreMatch || {})) for (const question of questions) settleGoalQuestion(question, playerId);
    session.rounds ||= [];
    if (session.round && !session.rounds.some(round => round.id === session.round.id)) session.rounds.push(session.round);
    for (const round of session.rounds) {
      if (round.status === "voting" || round.status === "locked") {
        const target = this.eventForLiveRound(round);
        const correct = target ? this.keyForQuestion({ type: round.targetType }, target) : round.targetType === "goal" ? "none" : null;
        round.result = { correct, event: target?.text || (correct === "none" ? "Full time — no further goals" : "Full time"), eventId: target?.id || null };
        round.status = "settled";
        for (const player of this.room.players) {
          const answer = this.room.predictions[player.id]?.[round.id];
          if (answer) player.rounds = (player.rounds || 0) + 1;
          if (answer && correct && answer === correct) { player.points = (player.points || 0) + 100; player.correct = (player.correct || 0) + 1; }
        }
      }
    }
    session.round = null;
    session.status = "complete";
    session.finishedAt = Date.now();
    session.nextQuestionAt = null;
    this.rebuildLeaderboard();
    // Commit and broadcast the authoritative full-time state first. The fixture
    // remains joinable until that final state has been sent to subscribers.
    await this.save();
    await this.archiveCompletedFixture();
    await this.removeAdminRoom();
    this.broadcast();
    this.schedule(30000);
  }
  async advance() {
    const s = this.room.session, r = s.round;
    if (this.room.mode === "live" || (this.room.fixture?.id && s.mode !== "simulation")) {
      await this.refreshLive();
      this.anchorLiveSchedule();
      this.settlePreMatch(s.clock);
      if (String(this.room.fixture?.state || "").toLowerCase() === "post") { await this.finishLiveSession(); return; }
      const fixtureState = String(this.room.fixture?.state || "").toLowerCase(), fixtureStatus = String(this.room.fixture?.status || ""), hasLiveTimeline = this.room.timeline.some(event => event.offset != null); const fixtureIsLive = fixtureState === "in" || (fixtureState !== "post" && hasLiveTimeline), fixtureIsAtHalfTime = /half[\s-]?time|end of (the )?1st half|\bHT\b|\binterval\b/i.test(fixtureStatus);
      // Reconcile every resolved call in this poll. Calls are independent:
      // one open call must never block another call or the next scheduled slot.
      const openRounds = [...(s.rounds || []), s.round].filter(round => round?.status === "voting" || round?.status === "locked");
      const resolvedRounds = openRounds.filter(round => this.eventForLiveRound(round) || this.room.fixture.state === "post");
      for (const resolvedRound of resolvedRounds) await this.settleLiveRound(resolvedRound, true);
      if (resolvedRounds.length) {
        await this.save();
        this.broadcast();
      }
      if (s.status === "running" && fixtureIsLive && Date.now() >= (s.nextQuestionAt || 0)) {
        if (fixtureIsAtHalfTime) {
          while (s.nextQuestionAt && s.nextQuestionAt <= Date.now()) s.nextQuestionAt += LIVE_CALL_INTERVAL_MS;
          await this.save();
          this.broadcast();
          this.schedule(this.providerPollDelayMs());
          return;
        }
        await this.openLiveRound();
        return;
      }
      if (s.status === "complete") return;
      await this.save(); this.broadcast(); this.schedule(Math.min(this.providerPollDelayMs(), Math.max(250, (s.nextQuestionAt || Date.now() + this.providerPollDelayMs()) - Date.now()))); return;
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
  eventForLiveRound(round) {
    const baseline = new Set((round.baselineEventIds || []).map(String));
    const presentedAtClock = round.presentedAtClock == null ? NaN : Number(round.presentedAtClock);
    return this.room.timeline.find(event => {
      if (String(event.type) !== String(round.targetType)) return false;
      if (event.valid === false || event.invalidated) return false;
      // A room can receive a backfill containing an event that was already in
      // the baseline, especially after a reconnect. The call's presented
      // match time is the authoritative boundary; baseline IDs are only the
      // fallback for older persisted rounds without that clock.
      if (Number.isFinite(presentedAtClock)) return Number(event.offset) > presentedAtClock;
      return !baseline.has(String(event.id));
    }) || null;
  }
  async settleLiveRound(round, deferIO = false) {
    const target = this.eventForLiveRound(round);
    const correct = target ? this.keyForQuestion({ type: round.targetType }, target) : null;
    round.result = { correct, event: target?.text || `No ${round.targetType} recorded during the call`, eventId: target?.id || null }; round.status = "settled";
    for (const p of this.room.players) { const answer = this.room.predictions[p.id]?.[round.id]; if (correct && answer === correct) { p.points = (p.points || 0) + 100; p.correct = (p.correct || 0) + 1; } if (answer) p.rounds = (p.rounds || 0) + 1; }
    this.rebuildLeaderboard(); this.room.events.unshift({ label: "Prediction settled", detail: round.result.event });
    if (!deferIO) {
      await this.save();
      this.broadcast();
      this.schedule(Math.min(this.providerPollDelayMs(), Math.max(250, (this.room.session.nextQuestionAt || Date.now() + this.providerPollDelayMs()) - Date.now())));
    }
  }
  async webSocketMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch { return; } if (!this.room) await this.load(); this.room.lastActivity = Date.now();
    if (m.type === "sync") { try { ws.send(JSON.stringify({ type: "state", state: this.public() })); } catch {} return; }
    if (m.type === "join") { const suppliedId = String(m.playerId || ""), suppliedToken = String(m.playerToken || ""); let p = suppliedToken ? this.room.players.find(x => x.token && x.token === suppliedToken) : null; if (!p && suppliedId) { const legacy = this.room.players.find(x => x.id === suppliedId && !x.token); if (legacy) p = legacy; } const isNewPlayer = !p; if (!p) { p = { id: crypto.randomUUID(), token: crypto.randomUUID(), name: String(m.name || "Supporter").slice(0,20), points: 0, rounds: 0, calls: 0, correct: 0, callRecords: [] }; this.room.players.push(p); } else { p.token ||= crypto.randomUUID(); if (m.name) p.name = String(m.name).slice(0,20); } if (isNewPlayer && (this.room.mode === "live" || (this.room.fixture?.id && this.room.mode !== "simulation"))) { await this.refreshLive(true); this.settlePreMatch(this.room.session.clock || 0); } this.room.playerPreMatch ||= {};
    // Late-join calls are created once for a genuinely new player. A
    // reconnect/re-entry must rehydrate the existing player state and must
    // never manufacture another private set of calls.
    if (isNewPlayer && this.room.fixture?.state === "in") {
      this.room.playerPreMatch[p.id] = this.buildPreMatch(true, p.id);
    } if (this.room.mode === "live" && this.room.session.status === "lobby") { this.room.session = { status: "running", startedAt: Date.now(), round: null, clock: 0, nextRoundIndex: 0, nextQuestionAt: nextLiveCallAt(this.room.fixture), liveScheduleKickoff: Date.parse(this.room.fixture?.date), mode: "live", speed: 1, lastQuestionType: null }; } this.rebuildLeaderboard(); ws.send(JSON.stringify({ type:"identity", playerId:p.id, playerToken:p.token })); }
    if (m.type === "prematch") { const p = this.room.players.find(x => x.id === m.playerId), q = (this.room.playerPreMatch?.[m.playerId] || []).find(x => x.id === m.questionId) || (this.room.preMatch || []).find(x => x.id === m.questionId); if (p && q && !q.settled && ((q.input && Number.isInteger(Number(m.answer)) && Number(m.answer) >= q.input.min && Number(m.answer) <= q.input.max) || q.choices.some(c => c.key === m.answer))) { this.room.predictions[p.id] ||= {}; this.room.predictions[p.id].pre ||= {}; if (!this.room.predictions[p.id].pre[q.id]) { p.calls = (p.calls || 0) + 1; p.callRecords ||= []; p.callRecords.push({ id: q.id, question: q.question, type: q.type, choices: q.choices || [], answer: String(m.answer), matchTime: "BEFORE KICK-OFF", submittedAt: Date.now() }); } this.room.predictions[p.id].pre[q.id] = String(m.answer); } }
    if (m.type === "start") await this.startSession();
    if (m.type === "predict") { const p = this.room.players.find(x => x.id === m.playerId), r = this.room.session.round, voteOpen = !r?.voteEndsAt || Date.now() < r.voteEndsAt; if (p && r?.status === "voting" && voteOpen && r.id === m.roundId) { this.room.predictions[p.id] ||= {}; if (!this.room.predictions[p.id][r.id]) { p.calls = (p.calls || 0) + 1; p.callRecords ||= []; p.callRecords.push({ id: r.id, question: r.question, type: r.targetType, choices: r.choices || [], answer: m.answer, matchTime: r.presentedMatchTime || "IN PLAY", submittedAt: Date.now() }); } this.room.predictions[p.id][r.id] = m.answer; if (this.room.session.mode === "simulation") { r.status = "locked"; this.room.session.holding = false; this.room.session.clockBase = this.room.session.clock; this.room.session.startedAt = Date.now(); } } }
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
  async alarm() {
    this.sockets = new Set(this.state.getWebSockets ? this.state.getWebSockets() : this.sockets);
    if (this.room?.session?.status === "complete") {
      for (const socket of this.sockets) { try { socket.close(1000, "Room expired"); } catch {} }
      this.sockets.clear();
      await this.removeAdminRoom();
      await this.state.storage.delete("room");
      this.room = null;
      await this.state.storage.deleteAlarm();
      return;
    }
    if (this.sockets.size === 0) {
      // Keep an in-progress live room authoritative across browser refreshes.
      // The previous socket can briefly disappear during a reload; deleting the
      // room here would recreate the session and reset its persisted call clock.
      const liveRoom = this.room?.mode === "live" && this.room?.session?.status !== "complete";
      if (liveRoom) {
        await this.state.storage.put("room", this.room);
        this.schedule(30000);
      } else {
        if (this.room) await this.removeAdminRoom();
        if (this.room) { await this.state.storage.delete("room"); this.room = null; }
        await this.state.storage.deleteAlarm();
      }
    } else {
      await this.load();
      await this.advance();
    }
  }
}
