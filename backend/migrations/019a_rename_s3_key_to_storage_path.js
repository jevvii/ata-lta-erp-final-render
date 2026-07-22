/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'documents' AND column_name = 's3_key'
      ) THEN
        ALTER TABLE documents RENAME COLUMN s3_key TO storage_path;
      END IF;
    END $$;
  `);
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'documents' AND column_name = 'storage_path'
      ) THEN
        ALTER TABLE documents RENAME COLUMN storage_path TO s3_key;
      END IF;
    END $$;
  `);
};
