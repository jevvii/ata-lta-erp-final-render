exports.up = (pgm) => {
  pgm.addColumns('work_requests', {
    archived: { type: 'boolean', default: false, notNull: true },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('work_requests', ['archived']);
};
