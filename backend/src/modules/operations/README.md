# Operations / Work Requests Module

Owner: Agent A / Team A  
Phase: 4

## Endpoints

- `GET /v1/work-requests`
- `POST /v1/work-requests`
- `GET /v1/work-requests/:id`
- `PUT /v1/work-requests/:id`
- `DELETE /v1/work-requests/:id`
- `GET /v1/work-requests/:wrId/tasks`
- `POST /v1/work-requests/:wrId/tasks`
- `PUT /v1/work-requests/:wrId/tasks/:taskId`
- `DELETE /v1/work-requests/:wrId/tasks/:taskId`

## Permissions

- `workflow:view` for read access
- `workflow:edit` for WR lifecycle changes
- `workflow:task_add` for creating tasks
- `workflow:task_approve` for approving tasks

## Notes

- Visibility rules must match the prototype:
  - Admin sees all WRs.
  - Managerial users see WRs they own/submitted/requested.
  - Staff see WRs assigned to them via tasks or checklist items.
