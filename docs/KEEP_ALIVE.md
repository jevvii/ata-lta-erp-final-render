# Render Free-Tier Keep-Alive

## Purpose

`scripts/keep-alive.js` pings the backend health endpoint every 10–14 minutes to keep the Render free-tier web service awake. This eliminates the cold-start delay users experience when the service has been idle.

## Scope

This is a **UAT / demo convenience only**. It is not a production architecture. Production deployments should use a paid Render plan or a hosting model that does not sleep.

## Usage

```bash
# Ping the UAT health endpoint
KEEP_ALIVE_URL=https://ata-lta-erp-api-uat.onrender.com/health npm run keep-alive

# Or use the ERP_API_BASE_URL fallback; /health is appended automatically
ERP_API_BASE_URL=https://ata-lta-erp-api-uat.onrender.com npm run keep-alive
```

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `KEEP_ALIVE_URL` | Yes (if no fallback) | Full URL to ping, e.g. `https://api.example.com/health`. |
| `ERP_API_BASE_URL` | No | Used as fallback; `/health` is appended and any `/v1` suffix is stripped. |

## How it works

- The script reads `KEEP_ALIVE_URL` or derives one from `ERP_API_BASE_URL`.
- It sends an HTTP(S) GET request and logs the status code and response time.
- The next ping is scheduled at a random interval between 10 and 14 minutes to avoid synchronized fleet traffic.

## Caveats

- This keeps only the web service warm. The Supabase free-tier database may still cold-start on first request.
- It consumes a small amount of request quota on the static host / backend.
- Do not rely on this for production workloads.
