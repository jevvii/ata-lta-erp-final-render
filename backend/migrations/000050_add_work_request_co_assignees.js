/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.addColumns('work_requests', {
    co_assignees: {
      type: 'jsonb',
      default: '[]',
    },
  });
  pgm.sql("UPDATE work_requests SET co_assignees = '[]'::jsonb WHERE co_assignees IS NULL");
};

exports.down = (pgm) => {
  pgm.dropColumns('work_requests', ['co_assignees']);
};
