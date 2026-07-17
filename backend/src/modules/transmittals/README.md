# Transmittals Module

**Owner:** Agent B / Team B  
**Phase:** 6

## Endpoints

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/v1/transmittals` | `transmittal:view` | List transmittals |
| `POST` | `/v1/transmittals` | `transmittal:create` | Create with items |
| `GET` | `/v1/transmittals/:id` | `transmittal:view` | Get with items |
| `PUT` | `/v1/transmittals/:id` | `transmittal:edit` | Update (Draft only) |
| `POST` | `/v1/transmittals/:id/send` | `transmittal:mark` | Mark as sent |
| `POST` | `/v1/transmittals/:id/acknowledge` | `transmittal:mark` | Mark as acknowledged |

## Workflow

```
Draft → Sent → Acknowledged
```

- **Draft**: Can be edited, items can be added/removed
- **Sent**: Immutable. Timestamp and sender recorded.
- **Acknowledged**: Final state. Acknowledgment timestamp recorded.

## Tracking Number

Unique per entity. Format determined by the user (e.g., `TR-ATA-2026-0001`).
