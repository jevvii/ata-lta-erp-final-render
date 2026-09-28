/**
 * Create standard_task_templates table.
 */

/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS standard_task_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title VARCHAR(255) NOT NULL,
      required_link_type VARCHAR(50),
      default_checklist JSONB DEFAULT '[]'::jsonb,
      co_assignees JSONB DEFAULT '[]'::jsonb,
      sort_order INT DEFAULT 0,
      is_system_default BOOLEAN DEFAULT FALSE,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_standard_task_templates_sort_order ON standard_task_templates(sort_order);
    CREATE INDEX IF NOT EXISTS idx_standard_task_templates_deleted_at ON standard_task_templates(deleted_at);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS standard_task_templates;
  `);
};
