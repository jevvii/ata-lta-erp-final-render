# Incident Response Runbook

**Last updated**: 2026-07-17

## Severity Levels

| Level | Description | Response Time |
|-------|------------|---------------|
| P1 - Critical | Service is down, data loss risk | Immediate |
| P2 - High | Major feature broken, workaround exists | 1 hour |
| P3 - Medium | Minor feature broken, no data impact | 4 hours |
| P4 - Low | Cosmetic issue, enhancement | Next business day |

## On-Call Checklist

### 1. Acknowledge

- Acknowledge the alert within the response time.
- Post in the team channel: "Investigating [issue description]".

### 2. Assess

- Check `/health` endpoint.
- Check Render dashboard for service status.
- Check Render logs for errors.
- Check UptimeRobot/monitoring for outage duration.

### 3. Mitigate

- If the backend is down: check Render logs, try manual redeploy.
- If the database is unreachable: check Supabase status page.
- If S3/CloudFront is failing: check AWS status page.
- If the SPA is broken: check if `env.js` was generated correctly.

### 4. Resolve

- Apply the fix (code change, config update, or rollback).
- Verify with health check and smoke tests.

### 5. Post-Mortem

- Document the incident: timeline, root cause, resolution.
- Identify preventive measures.
- Update runbooks if needed.
- Create follow-up issues for improvements.

## Escalation Path

1. **On-call engineer**: First responder.
2. **Project lead**: If the issue requires shared infrastructure changes.
3. **Product owner**: If the issue affects UAT sign-off or production release.

## Contact Information

- Render status: https://status.render.com
- Supabase status: https://status.supabase.com
- AWS status: https://health.aws.amazon.com
