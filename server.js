
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const PROMETHEUS_URL = (process.env.PROMETHEUS_URL || "").replace(/\/+$/, "");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "healthy",
    service: "cloudmonitor-api",
    timestamp: new Date().toISOString()
  });
});

async function queryPrometheus(query) {
  const url = new URL(`${PROMETHEUS_URL}/api/v1/query`);
  url.searchParams.set("query", query);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`Prometheus returned HTTP ${response.status}`);
  }

  const payload = await response.json();

  if (payload.status !== "success") {
    throw new Error("Prometheus query failed");
  }

  return payload.data?.result || [];
}

function numberValue(result) {
  const value = Number(result?.value?.[1]);
  return Number.isFinite(value) ? value : 0;
}

function formatCpu(cores) {
  if (!Number.isFinite(cores)) return "N/A";
  return cores >= 1
    ? `${cores.toFixed(2)} cores`
    : `${(cores * 1000).toFixed(1)}m`;
}

function formatMemory(bytes) {
  if (!Number.isFinite(bytes)) return "N/A";
  return `${(bytes / (1024 * 1024)).toFixed(1)}Mi`;
}

function metricMap(results) {
  const map = new Map();

  for (const item of results) {
    const namespace = item.metric.namespace || "default";
    const pod = item.metric.pod || "";
    if (!pod) continue;

    map.set(`${namespace}/${pod}`, numberValue(item));
  }

  return map;
}

app.get("/api/metrics", async (_req, res) => {
  if (!PROMETHEUS_URL) {
    return res.status(503).json({
      source: "demo",
      error: "Prometheus is not configured",
      hint: "Set PROMETHEUS_URL in the CloudMonitor deployment."
    });
  }

  try {
    const [
      podInfo,
      cpuResults,
      memoryResults,
      restartResults,
      runningResults,
      targetResults,
      cpuCapacityResults,
      memoryCapacityResults,
      memoryUsedResults
    ] = await Promise.all([
      queryPrometheus("kube_pod_info"),

      queryPrometheus(
        'sum by (namespace, pod) (rate(container_cpu_usage_seconds_total{pod!=""}[5m]))'
      ),

      queryPrometheus(
        'sum by (namespace, pod) (container_memory_working_set_bytes{pod!=""})'
      ),

      queryPrometheus(
        "sum by (namespace, pod) (kube_pod_container_status_restarts_total)"
      ),

      queryPrometheus(
        'max by (namespace, pod) (kube_pod_status_phase{phase="Running"} == 1)'
      ),

      queryPrometheus("up"),

      queryPrometheus(
        'sum(kube_node_status_capacity{resource="cpu",unit="core"})'
      ),

      queryPrometheus(
        'sum(kube_node_status_capacity{resource="memory",unit="byte"})'
      ),

      queryPrometheus(
        'sum(container_memory_working_set_bytes{pod!=""})'
      )
    ]);

    const cpuByPod = metricMap(cpuResults);
    const memoryByPod = metricMap(memoryResults);
    const restartsByPod = metricMap(restartResults);
    const runningByPod = metricMap(runningResults);

    const pods = podInfo.map(item => {
      const namespace = item.metric.namespace || "default";
      const podName = item.metric.pod || "unknown";
      const key = `${namespace}/${podName}`;

      const cpu = cpuByPod.get(key);
      const memory = memoryByPod.get(key);

      return {
        name: podName,
        namespace,
        status: runningByPod.has(key) ? "Running" : "Not Running",
        restarts: restartsByPod.get(key) || 0,
        cpu: cpu === undefined ? "N/A" : formatCpu(cpu),
        memory: memory === undefined ? "N/A" : formatMemory(memory),
        cpuCores: cpu ?? null,
        memoryBytes: memory ?? null
      };
    });

    const runningPods = pods.filter(p => p.status === "Running").length;

    const healthyTargets = targetResults.filter(
      item => numberValue(item) === 1
    ).length;

    const totalCpuUsage = cpuResults.reduce(
      (sum, item) => sum + numberValue(item),
      0
    );

    const cpuCapacity = numberValue(cpuCapacityResults[0]);
    const totalMemoryUsed = numberValue(memoryUsedResults[0]);
    const memoryCapacity = numberValue(memoryCapacityResults[0]);

    const cpuPercent =
      cpuCapacity > 0 ? (totalCpuUsage / cpuCapacity) * 100 : null;

    const memoryPercent =
      memoryCapacity > 0 ? (totalMemoryUsed / memoryCapacity) * 100 : null;

    const alerts = [];

    const downTargets = targetResults.filter(
      item => numberValue(item) === 0
    );

    if (downTargets.length > 0) {
      alerts.push({
        severity: "critical",
        message: `${downTargets.length} Prometheus target(s) are down.`
      });
    }

    const restartedPods = pods.filter(p => p.restarts > 0);

    if (restartedPods.length > 0) {
      alerts.push({
        severity: "warning",
        message: `${restartedPods.length} pod(s) have recorded container restarts.`
      });
    }

    if (cpuPercent !== null && cpuPercent >= 80) {
      alerts.push({
        severity: "warning",
        message: `Cluster CPU usage is high: ${cpuPercent.toFixed(1)}%.`
      });
    }

    if (memoryPercent !== null && memoryPercent >= 80) {
      alerts.push({
        severity: "warning",
        message: `Cluster memory usage is high: ${memoryPercent.toFixed(1)}%.`
      });
    }

    if (alerts.length === 0) {
      alerts.push({
        severity: "info",
        message: "Prometheus queries completed successfully."
      });
    }

    return res.json({
      source: "prometheus",
      updatedAt: new Date().toISOString(),

      summary: {
        cpuPercent:
          cpuPercent === null ? null : Number(cpuPercent.toFixed(1)),
        memoryPercent:
          memoryPercent === null ? null : Number(memoryPercent.toFixed(1)),
        runningPods,
        totalPods: pods.length,
        healthyServices: healthyTargets,
        totalServices: targetResults.length
      },

      pods,
      services: [],
      alerts
    });
  } catch (error) {
    console.error("Prometheus integration error:", error.message);

    return res.status(502).json({
      source: "prometheus",
      error: "Could not retrieve live metrics from Prometheus",
      details: error.message
    });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`CloudMonitor running on port ${PORT}`);
});
