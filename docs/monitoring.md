
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

The project uses DigitalOcean's native monitoring capabilities.

## 7. Related GitHub Issue

Issue #12: Configure DigitalOcean Monitoring and Alerts

This document records the monitoring configuration and verification performed for that issue.
