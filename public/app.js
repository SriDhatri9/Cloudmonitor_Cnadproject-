
const API_URL = "/api/metrics";

const pageContent = document.getElementById("pageContent");
const navLinks = document.querySelectorAll(".nav-link");
const sourceBadge = document.getElementById("sourceBadge");
const refreshBtn = document.getElementById("refreshBtn");

let currentPage = "overview";
let metricsData = null;
let apiError = "";
let lastRefresh = null;
let isRefreshing = false;

const pages = {
  overview: ["Cluster Overview", "Monitor your Kubernetes environment.", "COMMAND CENTER"],
  pods: ["Pod Inventory", "Inspect workloads, namespaces, status and restarts.", "WORKLOAD MANAGEMENT"],
  metrics: ["Resource Metrics", "Review current CPU and memory utilization.", "PERFORMANCE MONITORING"],
  services: ["Services & Targets", "Review service counts and monitoring information.", "NETWORK & DISCOVERY"],
  alerts: ["Alert Center", "Review warnings and issues reported by the monitoring API.", "INCIDENT MANAGEMENT"]
};

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pick(obj, keys, fallback = 0) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }
  return fallback;
}

function summary() {
  return metricsData?.summary || {};
}

function pods() {
  return Array.isArray(metricsData?.pods) ? metricsData.pods : [];
}

function alerts() {
  return Array.isArray(metricsData?.alerts) ? metricsData.alerts : [];
}

function services() {
  return Array.isArray(metricsData?.services) ? metricsData.services : [];
}

function totalPods() {
  return num(pick(summary(), ["totalPods", "podCount"], pods().length));
}

function runningPods() {
  return num(pick(summary(), ["runningPods", "healthyPods"],
    pods().filter(p => String(p.status || "").toLowerCase() === "running").length));
}

function cpu() {
  return num(pick(summary(), ["cpuPercent", "cpuUsage", "cpuUsagePercent", "cpuPercentUsage"], 0));
}

function memory() {
  return num(pick(summary(), ["memoryPercent", "memoryUsage", "memoryUsagePercent"], 0));
}

function restarts() {
  return num(pick(summary(), ["totalRestarts", "restarts", "restartCount"],
    pods().reduce((sum, p) => sum + num(p.restarts), 0)));
}

function getTargets() {
  const s = summary();
  return {
    total: num(pick(s, ["totalTargets", "targetsTotal", "totalMonitoringTargets", "totalServices"], 0)),
    up: num(pick(s, ["upTargets", "healthyTargets", "targetsUp", "healthyServices"], 0))
  };
}

function percent(value) {
  return `${num(value).toFixed(1)}%`;
}

function progress(value, extraClass = "") {
  const n = Math.max(0, Math.min(100, num(value)));
  const color = extraClass || (n >= 90 ? "red" : n >= 75 ? "amber" : "");
  return `<div class="progress-track"><div class="progress-fill ${color}" style="width:${n}%"></div></div>`;
}

function pill(status) {
  const s = String(status || "Unknown");
  const v = s.toLowerCase();
  let cls = "neutral";
  if (["running", "healthy", "up", "ready", "active", "available"].includes(v)) cls = "";
  if (["pending", "warning", "terminating"].includes(v)) cls = "warning";
  if (["failed", "error", "down", "critical", "crashloopbackoff"].includes(v)) cls = "danger";
  return `<span class="status-pill ${cls}">${escapeHTML(s)}</span>`;
}

function heading(key) {
  const [title, subtitle, eyebrow] = pages[key];
  return `<div class="page-heading"><div>
    <div class="eyebrow">${escapeHTML(eyebrow)}</div>
    <h1>${escapeHTML(title)}</h1>
    <p>${escapeHTML(subtitle)}</p>
  </div></div>`;
}

function card(label, value, icon, description) {
  return `<article class="metric-card">
    <div class="metric-top"><span>${escapeHTML(label)}</span><span class="metric-symbol">${icon}</span></div>
    <div class="metric-value">${escapeHTML(value)}</div>
    <div class="metric-description">${escapeHTML(description)}</div>
  </article>`;
}

function panel(title, subtitle, content, action = "") {
  return `<section class="panel">
    <div class="panel-header"><div><h2>${escapeHTML(title)}</h2>
      ${subtitle ? `<p>${escapeHTML(subtitle)}</p>` : ""}
    </div>${action}</div>
    ${content}
  </section>`;
}

function empty(title, message) {
  return `<div class="empty-state"><strong>${escapeHTML(title)}</strong>${escapeHTML(message)}</div>`;
}

function podTable(list, limit = Infinity) {
  if (!list.length) return empty("No pod records available", "No pod records were returned by the API.");

  return `<div class="table-wrap"><table>
    <thead><tr><th>Pod name</th><th>Namespace</th><th>Status</th><th>CPU</th><th>Memory</th><th>Restarts</th></tr></thead>
    <tbody>${list.slice(0, limit).map(p => `<tr>
      <td class="pod-name mono">${escapeHTML(p.name || "Unnamed pod")}</td>
      <td>${escapeHTML(p.namespace || "default")}</td>
      <td>${pill(p.status)}</td>
      <td>${escapeHTML(p.cpu ?? "—")}</td>
      <td>${escapeHTML(p.memory ?? "—")}</td>
      <td>${num(p.restarts)}</td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function renderAlertList(list) {
  if (!list.length) {
    return empty("No alert records returned",
      "The API returned no alerts. This does not by itself prove that every workload is healthy.");
  }

  return `<div class="alert-list">${list.map(a => {
    const severity = String(a.severity || "warning");
    return `<article class="alert-item">
      <div class="alert-marker ${/critical|error/i.test(severity) ? "critical" : ""}">!</div>
      <div><h3>${escapeHTML(a.name || a.title || "Monitoring alert")}</h3>
        <p>${escapeHTML(a.message || a.description || a.details || "No details provided.")}</p>
        <div class="alert-time">${escapeHTML(a.timestamp || a.time || "Timestamp not provided")}</div>
        <div style="margin-top:10px">${pill(severity)}</div>
      </div>
    </article>`;
  }).join("")}</div>`;
}

function renderOverview() {
  const target = getTargets();
  const total = totalPods();
  const running = runningPods();
  const health = total ? running / total * 100 : 0;

  pageContent.innerHTML = heading("overview") + `
    <div class="metrics-grid">
      ${card("CPU utilization", percent(cpu()), "⌁", "Current Prometheus reading")}
      ${card("Memory utilization", percent(memory()), "▤", "Current Prometheus reading")}
      ${card("Total pods", String(total), "◫", `${running} running pods reported`)}
      ${card("Container restarts", String(restarts()), "↻", "Sum of returned pod restarts")}
    </div>
    <div class="content-grid">
      ${panel("Resource utilization", "Latest reported readings", `
        <div class="progress-row"><div class="progress-label"><span>CPU</span><strong>${percent(cpu())}</strong></div>${progress(cpu())}</div>
        <div class="progress-row"><div class="progress-label"><span>Memory</span><strong>${percent(memory())}</strong></div>${progress(memory())}</div>
        <div class="progress-row"><div class="progress-label"><span>Running pods</span><strong>${health.toFixed(0)}%</strong></div>${progress(health, "green")}</div>
      `)}
      ${panel("Cluster summary", "Reported resource health", `
        <div class="progress-row"><div class="progress-label"><span>Pod availability</span><strong>${running} / ${total}</strong></div>${progress(health, "green")}</div>
        <div class="progress-row"><div class="progress-label"><span>Healthy services</span><strong>${num(summary().healthyServices)} / ${num(summary().totalServices)}</strong></div>${progress(summary().totalServices ? summary().healthyServices / summary().totalServices * 100 : 0, "green")}</div>
        <div class="progress-row"><div class="progress-label"><span>Alerts reported</span><strong>${alerts().length}</strong></div></div>
      `)}
    </div>
    ${panel("Pod inventory", "Latest pods returned by the API", podTable(pods(), 5), '<button class="text-link" data-goto="pods">View all pods →</button>')}
    ${panel("Recent alerts", "Monitoring messages returned by the API", renderAlertList(alerts().slice(0, 3)), '<button class="text-link" data-goto="alerts">View all alerts →</button>')}
  `;
}

function renderPods() {
  pageContent.innerHTML = heading("pods") + `
    <div class="metrics-grid">
      ${card("Total pods", String(totalPods()), "◫", "Pods reported by API")}
      ${card("Running pods", String(runningPods()), "✓", "Pods with Running status")}
      ${card("Restarts", String(restarts()), "↻", "Reported container restarts")}
      ${card("Namespaces", String(new Set(pods().map(p => p.namespace || "default")).size), "▦", "Namespaces in pod inventory")}
    </div>
    ${panel("All Kubernetes pods", "Search by pod name, namespace or status", `
      <input id="podSearch" class="search-input" placeholder="Search pods…" aria-label="Search pods">
      <div id="podTable" style="margin-top:16px">${podTable(pods())}</div>
    `)}
  `;

  document.getElementById("podSearch").addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    const filtered = pods().filter(p =>
      `${p.name || ""} ${p.namespace || ""} ${p.status || ""}`.toLowerCase().includes(q));
    document.getElementById("podTable").innerHTML = podTable(filtered);
  });
}

function renderMetrics() {
  pageContent.innerHTML = heading("metrics") + `
    <div class="metrics-grid">
      ${card("CPU utilization", percent(cpu()), "⌁", "Latest reading from API")}
      ${card("Memory utilization", percent(memory()), "▤", "Latest reading from API")}
      ${card("Running pods", String(runningPods()), "◫", "Reported running pods")}
      ${card("Restarts", String(restarts()), "↻", "Reported container restarts")}
    </div>
    ${panel("Resource utilization", "Latest readings, refreshed every 15 seconds", `
      <div class="progress-row"><div class="progress-label"><span>CPU</span><strong>${percent(cpu())}</strong></div>${progress(cpu())}</div>
      <div class="progress-row"><div class="progress-label"><span>Memory</span><strong>${percent(memory())}</strong></div>${progress(memory())}</div>
    `)}
    ${panel("Metric details", "Values exposed by the current API", `
      <div class="table-wrap"><table>
        <thead><tr><th>Metric</th><th>Value</th><th>Source</th></tr></thead>
        <tbody>
          <tr><td>CPU utilization</td><td>${percent(cpu())}</td><td>${escapeHTML(metricsData.source || "Unknown")}</td></tr>
          <tr><td>Memory utilization</td><td>${percent(memory())}</td><td>${escapeHTML(metricsData.source || "Unknown")}</td></tr>
          <tr><td>Running pods</td><td>${runningPods()} / ${totalPods()}</td><td>API summary</td></tr>
        </tbody>
      </table></div>
      <p class="muted">These are current reported values, not historical time-series graphs.</p>
    `)}
  `;
}

function renderServices() {
  const s = summary();
  const list = services();
  const total = num(s.totalServices);
  const healthy = num(s.healthyServices);

  const serviceContent = list.length
    ? `<div class="service-grid">${list.map((service, i) => `
        <article class="service-card">
          <div class="service-icon">◎</div>
          ${pill(service.status || "Unknown")}
          <h3>${escapeHTML(service.name || service.serviceName || `Service ${i + 1}`)}</h3>
          <p>${escapeHTML(service.endpoint || service.address || "Endpoint not supplied")}</p>
        </article>`).join("")}</div>`
    : empty("Individual service records are unavailable",
        "The API returns service totals, but its services array is empty. The summary counts below are real API values.");

  pageContent.innerHTML = heading("services") + `
    <div class="metrics-grid">
      ${card("Total services", String(total), "◎", "Service count from API summary")}
      ${card("Healthy services", String(healthy), "✓", "Services reported healthy")}
      ${card("Unhealthy services", String(Math.max(0, total - healthy)), "!", "Calculated from summary counts")}
      ${card("Data source", metricsData.source === "prometheus" ? "Prometheus" : String(metricsData.source || "Unknown"), "↗", "Source reported by backend")}
    </div>
    ${panel("Service inventory", "Records returned by the backend", serviceContent)}
    ${panel("Service health", "Summary reported by the monitoring API", `
      <div class="progress-row"><div class="progress-label"><span>Healthy services</span><strong>${healthy} / ${total}</strong></div>${progress(total ? healthy / total * 100 : 0, "green")}</div>
    `)}
  `;
}

function renderAlerts() {
  const list = alerts();
  const critical = list.filter(a => /critical|error|fatal/i.test(a.severity || "")).length;
  const warnings = list.filter(a => /warning|warn/i.test(a.severity || "")).length;

  pageContent.innerHTML = heading("alerts") + `
    <div class="metrics-grid">
      ${card("Total alerts", String(list.length), "♧", "Alert records from API")}
      ${card("Critical / errors", String(critical), "!", "Based on reported severity")}
      ${card("Warnings", String(warnings), "△", "Based on reported severity")}
      ${card("Monitoring source", String(metricsData.source || "Unknown"), "↗", "API-reported data source")}
    </div>
    ${panel("All alerts", "Warnings and events reported by the monitoring API", renderAlertList(list))}
  `;
}

function renderPage() {
  const info = pages[currentPage];
  document.getElementById("crumb").textContent = info[0].toUpperCase();

  navLinks.forEach(link => {
    const active = link.dataset.page === currentPage;
    link.classList.toggle("active", active);
    link.setAttribute("aria-current", active ? "page" : "false");
  });

  if (!metricsData) {
    pageContent.innerHTML = heading(currentPage) +
      empty("Waiting for monitoring data", apiError || "Connecting to API…");
    return;
  }

  switch (currentPage) {
    case "pods": renderPods(); break;
    case "metrics": renderMetrics(); break;
    case "services": renderServices(); break;
    case "alerts": renderAlerts(); break;
    default: renderOverview();
  }
}

function updateStatus() {
  const isPrometheus = metricsData?.source === "prometheus";

  sourceBadge.textContent = apiError ? "API OFFLINE" :
    isPrometheus ? "● PROMETHEUS" :
    metricsData?.source ? `● ${String(metricsData.source).toUpperCase()}` : "CONNECTING";

  sourceBadge.classList.toggle("demo", !!metricsData && !isPrometheus && !apiError);
  sourceBadge.classList.toggle("offline", !!apiError);

  const apiState = document.getElementById("apiState");
  apiState.textContent = apiError ? "● API unavailable" :
    isPrometheus ? "● Live source connected" : "● API connected";
  apiState.classList.toggle("error", !!apiError);

  document.getElementById("lastUpdated").textContent = lastRefresh
    ? `Last updated ${lastRefresh.toLocaleTimeString()}` : "Waiting for metrics";

  document.getElementById("podNavCount").textContent = metricsData ? String(totalPods()) : "—";
  document.getElementById("alertNavCount").textContent = metricsData ? String(alerts().length) : "—";
}

async function refreshMetrics() {
  if (isRefreshing) return;

  isRefreshing = true;
  refreshBtn.disabled = true;
  refreshBtn.textContent = "↻ Refreshing";

  try {
    const response = await fetch(API_URL, { cache: "no-store" });
    const data = await response.json();

    if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);

    metricsData = data;
    apiError = "";
    lastRefresh = new Date();
  } catch (error) {
    apiError = error.message || "Unable to connect to API";
  } finally {
    isRefreshing = false;
    refreshBtn.disabled = false;
    refreshBtn.textContent = "↻ Refresh";
    updateStatus();
    renderPage();
  }
}

function navigate(page) {
  if (!pages[page]) return;
  currentPage = page;
  renderPage();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.getElementById("mainNav").addEventListener("click", event => {
  const link = event.target.closest("[data-page]");
  if (link) navigate(link.dataset.page);
});

pageContent.addEventListener("click", event => {
  const link = event.target.closest("[data-goto]");
  if (link) navigate(link.dataset.goto);
});

refreshBtn.addEventListener("click", refreshMetrics);

refreshMetrics();
setInterval(refreshMetrics, 15000);
