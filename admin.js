const button = document.querySelector("#refresh-button");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const summary = document.querySelector("#summary");
const coverage = document.querySelector("#coverage");
const esc = value => String(value ?? "").replace(/[&<>\"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#039;" }[c]));

button.onclick = async () => {
  button.disabled = true;
  status.textContent = "Refreshing ESPN fixtures and validating leagues…";
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
