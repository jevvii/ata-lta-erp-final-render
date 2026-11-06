/** Reset data and restore immutable-history protection in one transaction. */
const truncateOperationalTables = async (client, tables) => {
  if (tables.length === 0) return;
  const qualified = tables.map((table) => `public."${table.replace(/"/g, '""')}"`).join(', ');
  await client.query('BEGIN');
  try {
    await client.query(`LOCK TABLE ${qualified} IN ACCESS EXCLUSIVE MODE`);
    let restoreHistoryTrigger = false;
    if (tables.includes('task_creation_review_events')) {
      const { rows } = await client.query(`
        SELECT tgenabled FROM pg_trigger
        WHERE tgrelid = 'public.task_creation_review_events'::regclass
          AND tgname = 'trg_task_creation_review_events_truncate'
      `);
      if (rows.length !== 1 || rows[0].tgenabled !== 'O') {
        throw new Error('Unexpected task review history truncate protection; reset aborted');
      }
      await client.query('ALTER TABLE public.task_creation_review_events DISABLE TRIGGER trg_task_creation_review_events_truncate');
      restoreHistoryTrigger = true;
    }
    // Reject references outside the supplied reset scope rather than clearing them.
    await client.query(`TRUNCATE TABLE ${qualified} RESTART IDENTITY RESTRICT`);
    if (restoreHistoryTrigger) {
      await client.query('ALTER TABLE public.task_creation_review_events ENABLE TRIGGER trg_task_creation_review_events_truncate');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
};

module.exports = { truncateOperationalTables };
