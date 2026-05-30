# System Heartbeat Metrics Implementation

## Overview

This document describes the implementation of system heartbeat metrics for the mobile-money project as per GitHub issue #1022.

## What Was Implemented

### 1. **Heartbeat Metric Registration** (`src/utils/metrics.ts`)

Added a new Prometheus Gauge metric to track system availability:

```typescript
export const systemHeartbeat = new Gauge({
  name: "system_heartbeat",
  help: "System heartbeat metric indicating baseline availability state (1=available, 0=unavailable)",
  labelNames: ["service"],
  registers: [register],
});
```

**Metric Details:**
- **Type:** Gauge (can go up and down)
- **Name:** `system_heartbeat`
- **Labels:** `service` (identifies which service is reporting)
- **Values:** 
  - `1` = service is available
  - `0` = service is unavailable
- **Registry:** Registered with the standard Prometheus Client registry

### 2. **Heartbeat Service** (`src/services/heartbeatService.ts`)

Created a dedicated service to manage the heartbeat metric lifecycle:

**Key Functions:**

- `startHeartbeatService()` - Starts the heartbeat service
  - Sets initial heartbeat value to 1 immediately
  - Schedules periodic updates (default: every 30 seconds)
  - Configurable via `HEARTBEAT_INTERVAL_MS` environment variable

- `stopHeartbeatService()` - Stops the heartbeat service
  - Clears the update interval
  - Sets heartbeat value to 0 (unavailable)

- `getHeartbeatStatus()` - Returns current heartbeat status
  - Useful for testing and debugging
  - Returns 0 if metric cannot be retrieved

**Features:**
- Graceful error handling with logging
- Configurable update interval
- Consistent reporting of baseline availability state

### 3. **Application Integration** (`src/index.ts`)

Integrated the heartbeat service into the main application:

**Initialization:**
- Heartbeat service starts in `initializeRuntime()` after Stellar exporter
- Runs alongside other background services

**Graceful Shutdown:**
- Heartbeat service stops during graceful shutdown
- Sets metric to 0 before process termination
- Ensures clean state for monitoring systems

### 4. **Comprehensive Tests**

#### Unit Tests (`tests/utils/heartbeat.test.ts`)
Tests the heartbeat service in isolation:
- Metric registration and properties
- Service lifecycle (start/stop)
- Periodic updates
- Metric values (1 when available, 0 when unavailable)
- Error handling
- Prometheus format compliance

#### Integration Tests (`tests/metrics.heartbeat.test.ts`)
Tests the heartbeat metric via the `/metrics` endpoint:
- Metric exposure in Prometheus text format
- Correct service label
- Proper HELP and TYPE lines
- Multiple concurrent requests
- State transitions (available → unavailable)

## How It Works

### Metric Flow

```
Application Start
    ↓
startHeartbeatService() called
    ↓
systemHeartbeat.set({ service: "mobile-money" }, 1)
    ↓
Periodic updates every 30 seconds (configurable)
    ↓
Prometheus scrapes /metrics endpoint
    ↓
Metric exposed as: system_heartbeat{service="mobile-money"} 1
    ↓
Application Shutdown
    ↓
stopHeartbeatService() called
    ↓
systemHeartbeat.set({ service: "mobile-money" }, 0)
    ↓
Metric exposed as: system_heartbeat{service="mobile-money"} 0
```

### Prometheus Endpoint

The metric is automatically exposed via the existing `/metrics` endpoint:

```
GET /metrics

# HELP system_heartbeat System heartbeat metric indicating baseline availability state (1=available, 0=unavailable)
# TYPE system_heartbeat gauge
system_heartbeat{service="mobile-money"} 1
```

## Configuration

### Environment Variables

- `HEARTBEAT_INTERVAL_MS` - Update interval in milliseconds (default: 30000)

Example:
```bash
HEARTBEAT_INTERVAL_MS=60000  # Update every 60 seconds
```

## Usage in Monitoring

### Prometheus Queries

**Check if service is available:**
```promql
system_heartbeat{service="mobile-money"} == 1
```

**Alert on service unavailability:**
```promql
system_heartbeat{service="mobile-money"} == 0
```

**Track availability over time:**
```promql
rate(system_heartbeat{service="mobile-money"}[5m])
```

### Grafana Dashboard

Add a gauge or stat panel with the query:
```promql
system_heartbeat{service="mobile-money"}
```

This will show:
- Green indicator when value is 1 (available)
- Red indicator when value is 0 (unavailable)

## Design Decisions

### Why a Gauge?
- Gauges can go up and down, making them ideal for availability states
- Simpler than counters for this use case
- Aligns with Prometheus best practices for state metrics

### Why a Service Label?
- Allows multiple services to report heartbeats on the same metric
- Enables filtering in Prometheus queries
- Follows the project's existing labeling patterns

### Why 30-Second Default Interval?
- Balances between responsiveness and overhead
- Aligns with typical Prometheus scrape intervals
- Configurable for different deployment needs

### Why Stop on Shutdown?
- Provides clear signal to monitoring systems
- Prevents stale metrics from indicating false availability
- Enables proper alerting on service termination

## Testing

### Running Tests

```bash
# Unit tests
npm test -- tests/utils/heartbeat.test.ts

# Integration tests
npm test -- tests/metrics.heartbeat.test.ts

# All tests
npm test
```

### Test Coverage

- ✅ Metric registration and properties
- ✅ Service lifecycle management
- ✅ Periodic updates
- ✅ Availability state transitions
- ✅ Error handling
- ✅ Prometheus format compliance
- ✅ Endpoint exposure
- ✅ Multiple concurrent requests

## Monitoring & Alerting

### Recommended Alerts

**Alert: Service Heartbeat Missing**
```yaml
alert: ServiceHeartbeatMissing
expr: absent(system_heartbeat{service="mobile-money"})
for: 2m
annotations:
  summary: "Mobile Money service heartbeat is missing"
```

**Alert: Service Unavailable**
```yaml
alert: ServiceUnavailable
expr: system_heartbeat{service="mobile-money"} == 0
for: 1m
annotations:
  summary: "Mobile Money service is unavailable"
```

## Files Modified/Created

### New Files
- `src/services/heartbeatService.ts` - Heartbeat service implementation
- `tests/utils/heartbeat.test.ts` - Unit tests
- `tests/metrics.heartbeat.test.ts` - Integration tests
- `HEARTBEAT_METRIC_IMPLEMENTATION.md` - This documentation

### Modified Files
- `src/utils/metrics.ts` - Added systemHeartbeat metric
- `src/index.ts` - Integrated heartbeat service

## Future Enhancements

Potential improvements for future iterations:

1. **Multi-Service Heartbeats** - Report heartbeats for individual components (database, Redis, etc.)
2. **Heartbeat Latency** - Track time since last heartbeat update
3. **Conditional Availability** - Report availability based on dependency health
4. **Custom Heartbeat Logic** - Allow services to define custom availability checks
5. **Metrics Aggregation** - Combine multiple heartbeats into overall system health

## Troubleshooting

### Heartbeat Metric Not Appearing

1. Check if heartbeat service started: Look for `[Heartbeat Service] Starting` in logs
2. Verify `/metrics` endpoint is accessible
3. Check `HEARTBEAT_INTERVAL_MS` environment variable is valid
4. Ensure Prometheus registry is properly initialized

### Heartbeat Stuck at 0

1. Check if service is shutting down
2. Verify heartbeat service wasn't stopped unexpectedly
3. Check for errors in application logs
4. Restart the service

### High CPU Usage from Heartbeat

1. Increase `HEARTBEAT_INTERVAL_MS` to reduce update frequency
2. Verify no other services are interfering with the metric
3. Check Prometheus scrape interval configuration

## References

- [Prometheus Gauge Metric Type](https://prometheus.io/docs/concepts/metric_types/#gauge)
- [prom-client Documentation](https://github.com/siimon/prom-client)
- [Prometheus Best Practices](https://prometheus.io/docs/practices/instrumentation/)
- GitHub Issue: #1022 - Add System Heartbeat Metrics inside Prometheus
