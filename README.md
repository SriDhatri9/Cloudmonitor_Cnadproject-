# CloudMonitor — CNAD Project

A beginner-friendly application monitoring dashboard built with HTML, CSS, JavaScript, Node.js/Express, Docker and Kubernetes. The dashboard includes CPU/memory cards, pod status, service availability, alerts, periodic refresh and health endpoints.

## Important scope note

By default, the dashboard uses **clearly labelled sample/demo metrics** so it works before a cluster-monitoring stack has been configured. The Kubernetes manifests deploy CloudMonitor itself; they do not magically expose all cluster metrics. An optional Prometheus connection currently checks the Prometheus `up` query (target health). Accurate CPU/memory and actual Kubernetes pod/service inventories require suitable exporters and additional PromQL or Kubernetes API integration.

## Requirements

- Windows 10/11
- Node.js 18+ (20 LTS recommended) for local run
- VS Code
- Docker Desktop for containerization
- Minikube and kubectl for local Kubernetes deployment

## Stage 1 — Run locally

1. Install Node.js 20 LTS from https://nodejs.org/
2. Open this folder in VS Code.
3. Open Terminal → New Terminal.
4. Run:

   ```powershell
   npm install
   npm start
   ```

5. Open http://localhost:3000
6. Check API endpoints: http://localhost:3000/api/health and http://localhost:3000/api/metrics
7. Optional smoke test in another terminal:

   ```powershell
   .\tests\smoke-test.ps1
   ```

Stop the server with `Ctrl+C`.

## Stage 2 — Build and run with Docker

1. Install and start Docker Desktop. Wait until it says Docker is running.
2. In the project root:

   ```powershell
   docker build -t cloudmonitor:1.0 .
   docker run --rm -p 3000:3000 --name cloudmonitor cloudmonitor:1.0
   ```

3. Open http://localhost:3000. Stop with `Ctrl+C`.
4. If port 3000 is already in use, run `docker run --rm -p 3001:3000 --name cloudmonitor cloudmonitor:1.0` and open http://localhost:3001.

## Stage 3 — Deploy to Kubernetes with Minikube

Install Docker Desktop, `kubectl`, and Minikube using their official Windows installation guides. Start Docker Desktop first.

```powershell
minikube start --driver=docker
kubectl get nodes
minikube image build -t cloudmonitor:1.0 .
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl rollout status deployment/cloudmonitor
kubectl get pods
kubectl get services
```

Open the app with:

```powershell
minikube service cloudmonitor
```

That command opens the NodePort service in a browser. Alternatively, run `kubectl port-forward service/cloudmonitor 3000:3000` and visit http://localhost:3000.

### Verify Kubernetes health

```powershell
kubectl get pods -l app=cloudmonitor
kubectl describe deployment cloudmonitor
kubectl logs deployment/cloudmonitor
kubectl get service cloudmonitor
```

Expected: two CloudMonitor pods should eventually show `Running` and `READY 1/1`. The readiness/liveness probes call `/api/health`.

### Clean up

```powershell
kubectl delete -f k8s/service.yaml
kubectl delete -f k8s/deployment.yaml
minikube stop
```

## Stage 4 — Optional Prometheus target-health connection

If Prometheus is reachable from the backend, set the environment variable `PROMETHEUS_URL` to its base URL before starting Node.js. For example, in PowerShell:

```powershell
$env:PROMETHEUS_URL = "http://localhost:9090"
npm start
```

Then `/api/metrics` queries Prometheus's `up` metric. This first integration is **target health only**. If running in Kubernetes, `localhost` inside a container means that container itself, not your Windows host. Configure a reachable Prometheus service URL and ensure network access. CPU/memory metrics need exporters and tailored queries.

## Project structure

```text
CloudMonitor/
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── k8s/
│   ├── deployment.yaml
│   └── service.yaml
├── tests/
│   └── smoke-test.ps1
├── server.js
├── package.json
├── Dockerfile
├── .dockerignore
└── README.md
```

## Test checklist

- [ ] Dashboard loads at `http://localhost:3000`
- [ ] CPU and memory cards show values in demo mode
- [ ] Refresh button updates the dashboard
- [ ] `/api/health` returns `status: healthy`
- [ ] `/api/metrics` returns a summary and source label
- [ ] Smoke test passes
- [ ] Docker image builds and the container serves the dashboard
- [ ] Kubernetes deployment reaches 2/2 Ready pods
- [ ] Kubernetes Service opens the dashboard
- [ ] Readiness/liveness probes are configured

## Viva preparation

**What is CloudMonitor?**  
A dashboard that centralizes application-health and monitoring information to help developers notice unhealthy workloads and operational issues.

**What is Docker?**  
Docker packages an application and its dependencies into an image that can run as a container.

**What is Kubernetes?**  
Kubernetes orchestrates containers, maintains the desired number of replicas, and supports service discovery and health probes.

**What is a Deployment?**  
A Kubernetes resource that manages replicated Pods and updates them toward a desired state.

**What is a Pod?**  
The smallest deployable unit in Kubernetes; it contains one or more closely related containers.

**What is a Service?**  
A stable network endpoint for reaching a set of Pods selected by labels.

**What is a readiness probe?**  
A check used to decide whether a Pod is ready to receive traffic.

**What is a liveness probe?**  
A check used to detect a container that should be restarted.

**What is Prometheus?**  
A monitoring system that scrapes and stores time-series metrics and supports querying them with PromQL.

**Are the displayed metrics real?**  
Not in the default configuration. They are labelled demo/sample metrics. The optional Prometheus connection checks target health; real CPU/memory and Kubernetes inventory require exporters and further integration. Never claim demo values are live cluster measurements.

**Why use two replicas?**  
To demonstrate replicated deployment and improve availability if one Pod fails, subject to the limits of a local single-node Minikube cluster.

**What is a NodePort?**  
A Kubernetes Service type that exposes a service on a port on the cluster nodes; `minikube service` helps open it locally.
