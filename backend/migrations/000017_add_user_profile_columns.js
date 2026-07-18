/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.addColumns('users', {
    avatar_url: { type: 'text' },
    preferences: { type: 'jsonb', notNull: true, default: '{}' },
    password_updated_at: { type: 'timestamptz' },
  });
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.dropColumns('users', ['avatar_url', 'preferences', 'password_updated_at']);
};
