/**
 * Configuration module controller.
 * Exposes runtime public configuration (Supabase connection parameters & entities)
 * for unauthenticated frontend bootstrapping.
 */

const env = require('../../config/env');
const { supabaseAdmin } = require('../../services/supabaseClient');
const logger = require('../../lib/logger');

const FALLBACK_ENTITIES = [
  { id: 'e83dc90b-d9b5-4854-8adf-7fe21c2e6822', code: 'ATA', name: 'ATA Accounting Firm' },
  { id: '16749820-0129-44a8-9435-a6013d07a370', code: 'LTA', name: 'LTA Accounting Firm' },
];

const getPublicConfig = async (req, res, next) => {
  try {
    if (!env.supabase.anonKey) {
      return res.status(503).json({
        code: 'PUBLIC_CONFIG_UNAVAILABLE',
        message: 'Public Supabase configuration is unavailable.',
      });
    }
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
    const supabaseAnonKey = env.supabase.anonKey;

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
