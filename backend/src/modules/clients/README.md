# Clients Module

Owner: Agent A / Team A  
Phase: 2

## Endpoints

- `GET /v1/clients`
- `POST /v1/clients`
- `GET /v1/clients/:id`
- `PUT /v1/clients/:id`
- `DELETE /v1/clients/:id`

## Permissions

- `clients:view` for read access
- `clients:edit` for create/update/delete (or Admin)

## Notes

- Entity-scoped: clients belong to `ATA` or `LTA`.
- All users with `clients:view` can read client master records, counts, contacts,
  affiliates, and archives in their authorized entities, even without a work request
  assignment. Work requests and their linked records retain project membership checks.
- Client mutations remain Admin-only via `clients:edit`.
- Soft deletes via `deleted_at`.
