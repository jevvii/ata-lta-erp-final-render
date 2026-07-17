# Admin / Users Module

Owner: Agent A / Team A  
Phase: 8

## Endpoints

- `GET /v1/admin/users`
- `POST /v1/admin/users`
- `GET /v1/admin/users/:id`
- `PUT /v1/admin/users/:id`
- `DELETE /v1/admin/users/:id`
- `GET /v1/admin/pending-approvals`
- `POST /v1/admin/pending-approvals/:id/approve`
- `POST /v1/admin/pending-approvals/:id/reject`

## Permissions

- `users:view` / `users:manage` for user management
- `approve_change:*` or `bypass_review:*` for pending approvals

## Notes

- User creation also creates a Supabase Auth user and sends an invite email.
- This phase finalizes the auth cutover from the prototype's localStorage login.
