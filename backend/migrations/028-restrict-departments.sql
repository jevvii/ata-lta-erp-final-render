-- Restrict user departments to the allowed allowlist.
-- 1. Remove invalid department assignments from users.
-- 2. Delete the now-invalid department records so they cannot be re-assigned.

BEGIN;

DELETE FROM user_departments
WHERE department_id IN (
  SELECT id FROM departments
  WHERE name IN ('HR', 'Legal', 'Tax', 'Audit', 'Business Development')
);

DELETE FROM departments
WHERE name IN ('HR', 'Legal', 'Tax', 'Audit', 'Business Development');

COMMIT;
