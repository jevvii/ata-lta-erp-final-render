/**
 * Configuration module controller.
 * Exposes runtime public configuration (Supabase connection parameters & entities)
 * for unauthenticated frontend bootstrapping.
 */

const env = require('../../config/env');
const { supabaseAdmin } = require('../../services/supabaseClient');
const logger = require('../../lib/logger');

const FALLBACK_ENTITIES = [
  { id: 'e83dc90b-d9b5-4854-8adf-7fe21c2e6822', code: 'ATA', name: 'ATA Business Consultancy Services' },
  { id: '16749820-0129-44a8-9435-a6013d07a370', code: 'LTA', name: 'LTA Business Management Corp' },
];

const getPublicConfig = async (req, res, next) => {
  try {
    let entities = FALLBACK_ENTITIES;
    try {
      const { data, error } = await supabaseAdmin
        .from('entities')
        .select('id, code, name')
        .order('code', { ascending: true });

      if (!error && Array.isArray(data) && data.length > 0) {
        entities = data.map((e) => ({
          id: e.id,
          code: e.code,
          name: e.name,
        }));
      }
    } catch (dbErr) {
      logger.warn('Failed to query entities from Supabase, using fallback', {
        error: dbErr?.message,
      });
    }

    const supabaseUrl = env.supabase.url || 'https://tqtwkmozvhttvbdatrbc.supabase.co';
    const supabaseAnonKey = env.supabase.anonKey || env.supabase.serviceKey || '';

    res.status(200).json({
      data: {
        supabaseUrl,
        supabaseAnonKey,
        entities,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  configController: { getPublicConfig },
  getPublicConfig,
};
