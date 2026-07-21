/**
 * Document service.
 * Business logic for document management — Supabase Storage-backed
 * metadata in PostgreSQL and pre-signed URL upload/download flow.
 *
 * Phase 3 — Agent B
 */

const { randomUUID } = require('crypto');
const { supabaseAdmin } = require('../../services/supabaseClient');
const {
  getSignedUploadUrl,
  getSignedDownloadUrl,
  deleteObject,
} = require('../../services/storageService');
const auditService = require('../../services/auditService');
const AppError = require('../../lib/AppError');
const logger = require('../../lib/logger');

/**
 * Sanitize a file name for safe storage.
 * @param {string} fileName - Original file name
 * @returns {string} Sanitized file name
 */
const sanitizeFileName = (fileName) => {
  return fileName
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9.\-_]/g, '')
    .replace(/-+/g, '-')
    .substring(0, 200);
};

/**
 * Generate a storage path for a document.
 * @param {object} params
 * @param {string} params.entityCode - Entity code (ATA or LTA) for the path
 * @param {string} [params.clientId] - Client UUID
 * @param {string} [params.workRequestId] - Work request UUID
 * @param {string} params.documentId - Document UUID
 * @param {string} params.fileName - Sanitized file name
 * @returns {string} Storage path
 */
const generateStoragePath = ({ entityCode, clientId, workRequestId, documentId, fileName }) => {
  const safeName = sanitizeFileName(fileName);
  const code = entityCode || 'UNKNOWN';

  if (clientId) {
    return `entities/${code}/clients/${clientId}/documents/${documentId}/${safeName}`;
  }

  if (workRequestId) {
    return `entities/${code}/work-requests/${workRequestId}/documents/${documentId}/${safeName}`;
  }

  return `entities/${code}/general/documents/${documentId}/${safeName}`;
};

/**
 * List documents for the active entity.
 * @param {object} params
 * @param {string} params.entityId - Entity code
 * @param {object} [params.filters] - Optional filters
 * @returns {Promise<{ data: object[], count: number }>}
 */
const listDocuments = async ({ entityId, filters = {} }) => {
  const {
    category,
    status,
    lifecycle,
    clientId,
    workRequestId,
    linkedTaskId,
    search,
    archived,
    page = 1,
    limit = 50,
  } = filters;
  const isArchived = archived === true || archived === 'true';

  let query = supabaseAdmin
    .from('documents')
    .select('*', { count: 'exact' })
    .is('deleted_at', null);

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  if (isArchived) {
    query = query.eq('archived', true);
  } else {
    query = query.eq('archived', false);
  }

  if (category) query = query.eq('category', category);
  if (status) query = query.eq('status', status);
  if (lifecycle) query = query.eq('document_lifecycle', lifecycle);
  if (clientId) query = query.eq('client_id', clientId);
  if (workRequestId) query = query.eq('work_request_id', workRequestId);
  if (linkedTaskId) query = query.eq('linked_task_id', linkedTaskId);
  if (search) {
    query = query.or(
      `original_name.ilike.%${search}%,description.ilike.%${search}%,document_type.ilike.%${search}%`
    );
  }

  const offset = (page - 1) * limit;
  query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to fetch documents',
    });
  }

  return { data: data || [], count: count || 0 };
};

/**
 * Create document metadata and return a pre-signed upload URL.
 * @param {object} params
 * @param {string} params.entityId - Entity code
 * @param {string} params.userId - Uploader UUID
 * @param {object} params.data - Validated document data
 * @returns {Promise<{ document: object, uploadUrl: string }>}
 */
const createDocument = async ({ entityId, entityCode, userId, data }) => {
  // Validate linkedTaskId if provided
  if (data.linkedTaskId) {
    const { data: task, error: taskError } = await supabaseAdmin
      .from('tasks')
      .select('id, work_request_id')
      .eq('id', data.linkedTaskId)
      .single();

    if (taskError || !task) {
      throw new AppError({
        statusCode: 400,
        title: 'Validation Error',
        detail: `Linked task ${data.linkedTaskId} does not exist`,
      });
    }

    if (data.workRequestId && task.work_request_id !== data.workRequestId) {
      throw new AppError({
        statusCode: 400,
        title: 'Validation Error',
        detail: `Linked task ${data.linkedTaskId} does not belong to work request ${data.workRequestId}`,
      });
    }
  }

  const documentId = randomUUID();

  const storagePath = data.externalUrl
    ? null
    : generateStoragePath({
        entityCode: entityCode || entityId,
        clientId: data.clientId || null,
        workRequestId: data.workRequestId || null,
        documentId,
        fileName: data.fileName,
      });

  const row = {
    id: documentId,
    file_name: sanitizeFileName(data.fileName),
    original_name: data.originalName || data.fileName,
    work_request_id: data.workRequestId || null,
    linked_task_id: data.linkedTaskId || null,
    client_id: data.clientId || null,
    document_type: data.documentType || null,
    category: data.category || null,
    uploader_id: userId,
    description: data.description || null,
    entity_id: entityId,
    status: data.externalUrl ? 'active' : 'pending_upload',
    document_lifecycle: 'collected',
    archived: false,
    file_size: data.fileSize || null,
    content_type: data.contentType || null,
    storage_path: storagePath,
    external_url: data.externalUrl || null,
    comments: data.comments || [],
    versions: data.versions || [],
    created_by: userId,
    updated_by: userId,
  };

  const { data: document, error } = await supabaseAdmin
    .from('documents')
    .insert(row)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to create document metadata',
    });
  }

  const uploadUrl = data.externalUrl
    ? null
    : await getSignedUploadUrl({
        path: storagePath,
        contentType: data.contentType,
        expiresInSeconds: 300,
      });

  await auditService.log({
    action: 'document.create',
    table: 'documents',
    recordId: documentId,
    entity: entityId,
    userId,
    details: { fileName: data.fileName, category: data.category },
  });

  return { document, uploadUrl };
};

/**
 * Get a single document by ID.
 * @param {object} params
 * @param {string} params.entityId - Entity code
 * @param {string} params.id - Document UUID
 * @returns {Promise<object>}
 */
const getDocumentById = async ({ entityId, id }) => {
  const { data, error } = await supabaseAdmin
    .from('documents')
    .select('*')
    .eq('id', id)
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .single();

  if (error || !data) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: `Document ${id} not found`,
    });
  }

  return data;
};

/**
 * Update document metadata.
 * @param {object} params
 * @param {string} params.entityId - Entity code
 * @param {string} params.id - Document UUID
 * @param {string} params.userId - User performing update
 * @param {object} params.data - Fields to update
 * @returns {Promise<object>}
 */
const updateDocument = async ({ entityId, id, userId, data }) => {
  // Verify document exists and belongs to entity
  await getDocumentById({ entityId, id });

  const updates = {
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  if (data.documentType !== undefined) updates.document_type = data.documentType;
  if (data.category !== undefined) updates.category = data.category;
  if (data.description !== undefined) updates.description = data.description;
  if (data.linkedTaskId !== undefined) updates.linked_task_id = data.linkedTaskId;
  if (data.externalUrl !== undefined) updates.external_url = data.externalUrl;
  if (data.scannedBy !== undefined) updates.scanned_by = data.scannedBy;
  if (data.envelopeId !== undefined) updates.envelope_id = data.envelopeId;
  if (data.storedLocation !== undefined) updates.stored_location = data.storedLocation;
  if (data.handoverLog !== undefined) updates.handover_log = data.handoverLog;
  if (data.archived !== undefined) updates.archived = data.archived;
  if (data.comments !== undefined) updates.comments = data.comments;
  if (data.versions !== undefined) updates.versions = data.versions;

  const { data: updated, error } = await supabaseAdmin
    .from('documents')
    .update(updates)
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to update document',
    });
  }

  return updated;
};

/**
 * Soft-delete a document and remove its storage object.
 * @param {object} params
 * @param {string} params.entityId - Entity code
 * @param {string} params.id - Document UUID
 * @param {string} params.userId - User performing deletion
 * @returns {Promise<void>}
 */
const deleteDocument = async ({ entityId, id, userId }) => {
  const doc = await getDocumentById({ entityId, id });

  const { error } = await supabaseAdmin
    .from('documents')
    .update({
      deleted_at: new Date().toISOString(),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('entity_id', entityId);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to delete document',
    });
  }

  await auditService.log({
    action: 'document.delete',
    table: 'documents',
    recordId: id,
    entity: entityId,
    userId,
    details: { fileName: doc.original_name },
  });
};

const archiveDocument = async ({ entityId, id, userId }) => {
  const existing = await getDocumentById({ entityId, id });
  const { data: updated, error } = await supabaseAdmin
    .from('documents')
    .update({ archived: true, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Failed to archive document' });
  }

  await auditService.log({
    action: 'document.archive',
    table: 'documents',
    recordId: id,
    entity: entityId,
    userId,
    details: { fileName: existing.original_name },
  });

  return updated;
};

const unarchiveDocument = async ({ entityId, id, userId }) => {
  const existing = await getDocumentById({ entityId, id });
  const { data: updated, error } = await supabaseAdmin
    .from('documents')
    .update({ archived: false, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Failed to unarchive document' });
  }

  await auditService.log({
    action: 'document.unarchive',
    table: 'documents',
    recordId: id,
    entity: entityId,
    userId,
    details: { fileName: existing.original_name },
  });

  return updated;
};

const countDocuments = async ({ entityId }) => {
  const baseQuery = () => {
    let q = supabaseAdmin
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .is('deleted_at', null);
    if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
    return q;
  };

  const [{ count: activeCount }, { count: archivedCount }] = await Promise.all([
    baseQuery().eq('archived', false),
    baseQuery().eq('archived', true),
  ]);

  return { active: activeCount || 0, archived: archivedCount || 0 };
};

/**
 * Confirm that a file upload to storage has completed.
 * Transitions document status from pending_upload to active.
 * @param {object} params
 * @param {string} params.entityId - Entity code
 * @param {string} params.id - Document UUID
 * @returns {Promise<object>}
 */
const confirmUpload = async ({ entityId, id }) => {
  const doc = await getDocumentById({ entityId, id });

  if (doc.status !== 'pending_upload') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: `Document is already in status "${doc.status}"`,
    });
  }

  const { data: updated, error } = await supabaseAdmin
    .from('documents')
    .update({
      status: 'active',
      upload_date: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to confirm upload',
    });
  }

  return updated;
};

/**
 * Get a pre-signed download URL for a document.
 * @param {object} params
 * @param {string} params.entityId - Entity code
 * @param {string} params.id - Document UUID
 * @returns {Promise<{ url: string, fileName: string }>}
 */
const getDownloadUrl = async ({ entityId, id }) => {
  const doc = await getDocumentById({ entityId, id });

  if (!doc.storage_path) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: 'Document has no associated file',
    });
  }

  if (doc.status === 'pending_upload') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Document upload has not been confirmed yet',
    });
  }

  const url = await getSignedDownloadUrl({
    path: doc.storage_path,
    expiresInSeconds: 300,
  });

  return { url, fileName: doc.original_name };
};

/**
 * Transition a document's lifecycle state.
 * @param {object} params
 * @param {string} params.entityId - Entity code
 * @param {string} params.id - Document UUID
 * @param {string} params.userId - User performing transition
 * @param {string} params.lifecycle - Target lifecycle state
 * @returns {Promise<object>}
 */
const updateLifecycle = async ({ entityId, id, userId, lifecycle }) => {
  await getDocumentById({ entityId, id });

  const { data: updated, error } = await supabaseAdmin
    .from('documents')
    .update({
      document_lifecycle: lifecycle,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to update document lifecycle',
    });
  }

  await auditService.log({
    action: 'document.lifecycle',
    table: 'documents',
    recordId: id,
    entity: entityId,
    userId,
    details: { lifecycle },
  });

  return updated;
};

module.exports = {
  sanitizeFileName,
  generateStoragePath,
  listDocuments,
  createDocument,
  getDocumentById,
  updateDocument,
  deleteDocument,
  archiveDocument,
  unarchiveDocument,
  countDocuments,
  confirmUpload,
  getDownloadUrl,
  updateLifecycle,
};
