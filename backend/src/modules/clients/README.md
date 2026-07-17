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
- Soft deletes via `deleted_at`.
