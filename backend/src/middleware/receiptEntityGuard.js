/**
 * Receipt Entity Guard Middleware (C2 / RECEIPT-ENTITY-20261021)
 *
 * Enforces explicit, unambiguous entity context for receipt upload reservation
 * and completion endpoints before any resolver fallback, signed URL generation,
 * binary verification, or database writes occur.
 *
 * Rejects:
 * 1. Unresolved 'ALL' context (literal 'ALL' header or omitted header for dual-entity user)
 *    with HTTP 400 RECEIPT_ENTITY_REQUIRED.
 * 2. Malformed / non-canonical raw headers (e.g. whitespace-padded ' LTA ', invalid codes 'INVALID')
 *    with HTTP 400 RECEIPT_ENTITY_REQUIRED, preventing upstream entityScope normalization
 *    from silently defaulting to the user's first entity.
 * 3. Any raw/scoped entity disagreement defensively.
 *
 * Permits:
 * 1. Explicit authorized canonical 'ATA' or 'LTA' header.
 * 2. Single-entity user whose omitted header was unambiguously defaulted to their only entity by entityScope.
 */

const AppError = require('../lib/AppError');

const VALID_RECEIPT_ENTITIES = ['ATA', 'LTA'];
const CANONICAL_RECEIPT_HEADER_RE = /^(ATA|LTA)$/i;

const receiptEntityGuard = (req, res, next) => {
  try {
    const rawHeader = req.headers['x-active-entity'];

    if (rawHeader !== undefined && rawHeader !== null && rawHeader !== '') {
      // Must be a string strictly matching ATA or LTA without padding or extraneous characters
      if (typeof rawHeader !== 'string' || !CANONICAL_RECEIPT_HEADER_RE.test(rawHeader)) {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: 'Select a specific ATA or LTA entity for this receipt upload.',
          code: 'RECEIPT_ENTITY_REQUIRED',
        });
      }

      const normalizedCode = rawHeader.toUpperCase();

      // Defensive check: ensure raw header agrees with upstream entityScope
      if (req.activeEntity !== normalizedCode) {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: 'Select a specific ATA or LTA entity for this receipt upload.',
          code: 'RECEIPT_ENTITY_REQUIRED',
        });
      }
    } else {
      // Omitted or empty header:
      // If scoped as 'ALL' (dual-entity user) or any non-concrete entity, reject
      if (!VALID_RECEIPT_ENTITIES.includes(req.activeEntity)) {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: 'Select a specific ATA or LTA entity for this receipt upload.',
          code: 'RECEIPT_ENTITY_REQUIRED',
        });
      }
    }

    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { receiptEntityGuard };
