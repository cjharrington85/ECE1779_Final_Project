
# DigitalOcean Monitoring and Alerts

## Overview

DigitalOcean's built-in Monitoring service was configured and verified for both Droplets used in the ECE1779 Collaborative Task Management Platform.

**Configured by:** Ishmam Ahmed

## 1. Monitored Infrastructure

| Droplet | Role | Monitoring Agent |
|---|---|---|
| ece1779-swarm-manager | Docker Swarm Manager | Active |
| ece1779-swarm-worker | Docker Swarm Worker | Active |

Both Droplets run Ubuntu 24.04 LTS with 1 vCPU and 2 GB RAM.

## 2. Monitoring Agent Verification

The DigitalOcean Monitoring agent was verified on both Droplets using:

```bash
systemctl is-active do-agent
```

Both returned:

```text
active
```

No additional monitoring agent installation was required.

## 3. Infrastructure Metrics

The DigitalOcean Insights dashboard was checked for both Droplets.

The following metrics were available:

- CPU utilization
- System load averages (1, 5, and 15 minutes)
- Memory utilization
- Disk I/O
- Disk utilization
- Network bandwidth

Live monitoring data was confirmed on both servers.

## 4. Resource Alerts

Three resource alert policies were created in DigitalOcean.

| Alert | Condition | Duration |
|---|---|---|
| High CPU Utilization | CPU above 80% | 5 minutes |
| High Memory Utilization | Memory above 85% | 5 minutes |
| High Disk Utilization | Disk above 85% | 5 minutes |

All three alerts monitor both the Swarm Manager and Worker Droplets.

Email notifications were selected for alert delivery.

### Alert Configuration Rationale

The CPU threshold detects sustained high processor utilization on the 1-vCPU Droplets.

The memory threshold helps identify potential memory pressure on the 2 GB servers.

The disk threshold provides warning when filesystem utilization becomes high.

A five-minute duration reduces alerts caused by brief resource utilization spikes.

## 5. Verification Results

The following checks were completed:

- DigitalOcean Monitoring agent active on both Droplets.
- Insights dashboard displaying metrics for both Droplets.
- CPU utilization alert created.
- Memory utilization alert created.
- Disk utilization alert created.
- All three alert policies confirmed to include both Droplets.

The alert configurations were verified in the DigitalOcean dashboard.

## 6. Monitoring Scope

DigitalOcean's native monitoring provides the alerts above. Prometheus node_exporter metrics are additionally
shipped to a Grafana Cloud dashboard (section 8).

## 7. Related GitHub Issue

Issue #12: Configure DigitalOcean Monitoring and Alerts

This document records the monitoring configuration and verification performed for that issue.

## 8. Grafana Cloud Dashboard (node_exporter)

**Flow:** `prometheus-node-exporter` (each Droplet, port 9100 on the private IP) -> Grafana Alloy
(Swarm service on the manager, [docker-stack-monitoring.yml](../docker-stack-monitoring.yml),
[monitoring/config.alloy](../monitoring/config.alloy)) -> `remote_write` -> Grafana Cloud (free tier).
Metrics are pushed because the Droplets are not reachable from the internet. The existing firewall already
allows TCP between the two private IPs, so no firewall change is needed.

Setup:

1. Create a Grafana Cloud stack; note the Prometheus remote_write URL and instance ID, and create an access
   policy token with the `metrics:write` scope.
2. On **both** Droplets: `sudo apt install -y prometheus-node-exporter`, set
   `ARGS="--web.listen-address=10.118.0.X:9100"` in `/etc/default/prometheus-node-exporter` (X = 2 manager,
   3 worker), then `sudo systemctl restart prometheus-node-exporter`.
3. On the manager: `echo -n '<token>' > secrets/grafana_cloud_token.txt` (gitignored; the remote_write URL and instance ID are already in
   `monitoring/config.alloy`), then `docker stack deploy -c docker-stack-monitoring.yml monitoring`.
4. In Grafana Cloud, import dashboard ID 1860 (Node Exporter Full).

Verify: `up{job="node"}` returns 2 series equal to 1 in Grafana Explore.

### Grafana alerts

Rules are defined in [monitoring/alert-rules.yml](../monitoring/alert-rules.yml): CPU above 80%, memory above
85%, disk above 85% (each for 5 minutes, matching the DigitalOcean alerts) and node_exporter down for 2 minutes.
To load them: Grafana Cloud -> Alerting -> Alert rules -> New -> Import to Grafana-managed rules, upload the
YAML and select the hosted Prometheus data source. Then set a default email contact point under
Alerting -> Contact points and route notifications to it (Notification policies).
