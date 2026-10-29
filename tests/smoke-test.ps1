# Run this after starting the app at http://localhost:3000
$ErrorActionPreference = "Stop"
Write-Host "Checking health endpoint..."
$health = Invoke-RestMethod "http://localhost:3000/api/health"
if ($health.status -ne "healthy") { throw "Health check failed" }
Write-Host "PASS: /api/health"
Write-Host "Checking metrics endpoint..."
$metrics = Invoke-RestMethod "http://localhost:3000/api/metrics"
if (-not $metrics.source) { throw "Metrics source missing" }
if (-not $metrics.summary) { throw "Metrics summary missing" }
Write-Host "PASS: /api/metrics (source: $($metrics.source))"
Write-Host "All smoke tests passed."
