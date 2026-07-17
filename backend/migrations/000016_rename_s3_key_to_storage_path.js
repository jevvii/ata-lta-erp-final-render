/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.renameColumn('documents', 's3_key', 'storage_path');
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.renameColumn('documents', 'storage_path', 's3_key');
};
