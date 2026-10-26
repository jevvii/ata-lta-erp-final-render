/**
 * Document service.
 * Business logic for document management — Supabase Storage-backed
 * metadata in PostgreSQL and pre-signed URL upload/download flow.
 *
 * Phase 3 — Agent B
 */

const { randomUUID } = require('crypto');
const { supabaseAdmin } = require('../../services/supabaseClient');
const { getSignedUploadUrl, getSignedDownloadUrl } = require('../../services/storageService');
const auditService = require('../../services/auditService');
const AppError = require('../../lib/AppError');
const { getUserConcernedWorkRequestIds, fetchInPages } = require('../../lib/userScope');
const { resolveTrustedUser, isUserAssignedToTask } = require('../../lib/taskAssignment');
const { buildPermissionSet, hasPermission } = require('../../lib/permissions');
const {
  validateRecordProjectLinkage,
  filterValidProjectRecords,
  resolveExistingStoredTaskId,
} = require('../../lib/projectLinkage');

const isDisbursementReceiptDoc = (d) => {
  if (!d) return false;
  const path = (d.storage_path || '').toLowerCase();
  if (path.includes('/disbursements/receipts/') || path.includes('/disbursements/')) return true;
  const cat = (d.category || '').toLowerCase();
  if (['receipt', 'receipts', 'disbursement', 'disbursement_receipt'].includes(cat)) return true;
  const docType = (d.document_type || '').toLowerCase();
  if (docType === 'disbursement_receipt' || docType === 'disbursement receipt') return true;
  return false;
};

// Task comments belong to the task's assignees, regardless of department.
// Standalone documents retain the existing DMS edit rule.
const canCommentOnDocument = async (document, user) => {
  if (!user?.id) return false;
  if (user.role === 'Admin') return true;
  const taskId = resolveExistingStoredTaskId(document);
  if (taskId) return isUserAssignedToTask(taskId, user.id);
  return hasPermission(buildPermissionSet(user), 'dms:edit');
};

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
 * Enrich documents with uploader_name, work_request_title, and linked_task_title.
 * @param {object[]} docs
 * @returns {Promise<object[]>}
 */
const enrichDocuments = async (docs) => {
  if (!docs || docs.length === 0) return docs;

  const uploaderIds = [...new Set(docs.map((d) => d.uploader_id).filter(Boolean))];
  const workRequestIds = [...new Set(docs.map((d) => d.work_request_id).filter(Boolean))];
  const linkedTaskIds = [...new Set(docs.map((d) => d.linked_task_id).filter(Boolean))];

  const userMap = new Map();
  const wrMap = new Map();
  const taskMap = new Map();

  try {
    if (uploaderIds.length > 0) {
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id, name')
        .in('id', uploaderIds);
      (users || []).forEach((u) => {
        if (u && u.id) userMap.set(u.id, u.name);
      });
    }

    if (workRequestIds.length > 0) {
      const { data: wrs } = await supabaseAdmin
        .from('work_requests')
        .select('id, title')
        .in('id', workRequestIds);
      (wrs || []).forEach((wr) => {
        if (wr && wr.id) wrMap.set(wr.id, wr.title);
      });
    }

    if (linkedTaskIds.length > 0) {
      const { data: tasks } = await supabaseAdmin
        .from('tasks')
        .select('id, title')
        .in('id', linkedTaskIds);
      (tasks || []).forEach((t) => {
        if (t && t.id) taskMap.set(t.id, t.title);
      });
    }
  } catch (err) {
    // Graceful fallback if relations cannot be fetched
  }

  return docs.map((doc) => ({
    ...doc,
    uploader_name: doc.uploader_id ? userMap.get(doc.uploader_id) || null : null,
    work_request_title: doc.work_request_id ? wrMap.get(doc.work_request_id) || null : null,
    linked_task_title: doc.linked_task_id ? taskMap.get(doc.linked_task_id) || null : null,
  }));
};

/**
 * List documents for the active entity.
 * @param {object} params
 * @param {string} params.entityId - Entity code
 * @param {object} [params.filters] - Optional filters
 * @returns {Promise<{ data: object[], count: number }>}
 */
const listDocuments = async ({ entityId, filters = {}, user }) => {
  if (!user) {
    throw new AppError({
      statusCode: 401,
      title: 'Unauthorized',
      detail: 'Authentication required to list documents',
    });
  }

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

  const isAdmin = user.role === 'Admin';
  let concernedWrIds = null;
  if (!isAdmin) {
    concernedWrIds = await getUserConcernedWorkRequestIds(user, { entityId });
    if (concernedWrIds.length === 0) {
      return { data: [], count: 0 };
    }
  }

  const makeQuery = () => {
    let q = supabaseAdmin.from('documents').select('*').is('deleted_at', null);

    if (entityId && entityId !== 'ALL') {
      q = q.eq('entity_id', entityId);
    }

    if (isArchived) {
      q = q.eq('archived', true);
    } else {
      q = q.eq('archived', false);
    }

    // Exclude disbursement receipts from DMS documents views
    q = q
      .not('storage_path', 'ilike', '%/disbursements/receipts/%')
      .not('storage_path', 'ilike', '%/disbursements/%');

    if (category) q = q.eq('category', category);
    if (status) q = q.eq('status', status);
    if (lifecycle) q = q.eq('document_lifecycle', lifecycle);
    if (clientId) q = q.eq('client_id', clientId);
    if (workRequestId) q = q.eq('work_request_id', workRequestId);
    if (linkedTaskId) q = q.eq('linked_task_id', linkedTaskId);
    if (search) {
      q = q.or(
        `original_name.ilike.%${search}%,description.ilike.%${search}%,document_type.ilike.%${search}%`
      );
    }
    return q.order('created_at', { ascending: false });
  };

  const rawRows = await fetchInPages(makeQuery);

  const validRows = await filterValidProjectRecords(rawRows || [], {
    user,
    entityId,
    concernedWrIds,
  });

  const visibleRows = (validRows || []).filter((d) => !isDisbursementReceiptDoc(d));

  const total = visibleRows.length;
  const offset = (page - 1) * limit;
  const rows = visibleRows.slice(offset, offset + limit);

  const enriched = await enrichDocuments(rows);

  return { data: enriched, count: total };
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
      .select('id, work_request_id, assignee_id')
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

    // Role check: Admin bypasses
    const { data: uploader } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (uploader?.role !== 'Admin') {
      // Check if user is task assignee or task_assignees member
      const { data: taRows } = await supabaseAdmin
        .from('task_assignees')
        .select('id')
        .eq('task_id', data.linkedTaskId)
        .eq('user_id', userId);

      const isAssigned = task.assignee_id === userId || (taRows && taRows.length > 0);
      if (!isAssigned) {
        throw new AppError({
          statusCode: 403,
          title: 'Forbidden',
          detail: 'You are not assigned to this task and cannot attach documents to it.',
          code: 'FORBIDDEN_TASK_ATTACHMENT',
        });
      }
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
const getDocumentById = async ({ entityId, id, user, internal = false }) => {
  let query = supabaseAdmin
    .from('documents')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null);

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  const { data, error } = await query.single();

  if (error || !data) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: `Document ${id} not found`,
    });
  }

  if (!internal) {
    if (!user) {
      throw new AppError({
        statusCode: 401,
        title: 'Unauthorized',
        detail: 'Authentication required to view document',
      });
    }

    await validateRecordProjectLinkage({
      record: data,
      entityId,
      user,
      internal: false,
    });
  }

  const [enriched] = await enrichDocuments([data]);
  const document = enriched || data;
  return internal ? document : { ...document, can_comment: await canCommentOnDocument(document, user) };
};

const resolveDocumentCaller = async ({ user, userId, caller, internal }) => {
  const effectiveUser = caller || user || (await resolveTrustedUser({ user, userId }));
  if (!internal && !effectiveUser) {
    throw new AppError({
      statusCode: 401,
      title: 'Unauthorized',
      detail: 'Authentication required to modify document',
    });
  }
  return effectiveUser;
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
const updateDocument = async ({ entityId, id, userId, data, user, caller, internal = false }) => {
  // Verify document exists, belongs to entity, and caller has project membership
  const effectiveUser = await resolveDocumentCaller({ user, userId, caller, internal });
  await getDocumentById({ entityId, id, user: effectiveUser, internal });

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
const deleteDocument = async ({ entityId, id, userId, user, caller, internal = false }) => {
  const effectiveUser = await resolveDocumentCaller({ user, userId, caller, internal });
  const doc = await getDocumentById({ entityId, id, user: effectiveUser, internal });

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

const archiveDocument = async ({ entityId, id, userId, user, caller, internal = false }) => {
  const effectiveUser = await resolveDocumentCaller({ user, userId, caller, internal });
  const existing = await getDocumentById({ entityId, id, user: effectiveUser, internal });
  const { data: updated, error } = await supabaseAdmin
    .from('documents')
    .update({ archived: true, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to archive document',
    });
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

const unarchiveDocument = async ({ entityId, id, userId, user, caller, internal = false }) => {
  const effectiveUser = await resolveDocumentCaller({ user, userId, caller, internal });
  const existing = await getDocumentById({ entityId, id, user: effectiveUser, internal });
  const { data: updated, error } = await supabaseAdmin
    .from('documents')
    .update({ archived: false, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to unarchive document',
    });
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

const countDocuments = async ({ entityId, user }) => {
  const isAdmin = user?.role === 'Admin';
  let concernedWrIds = null;
  if (!isAdmin) {
    if (!user) return { active: 0, archived: 0 };
    concernedWrIds = await getUserConcernedWorkRequestIds(user, { entityId });
    if (concernedWrIds.length === 0) {
      return { active: 0, archived: 0 };
    }
  }

  const makeQuery = () => {
    let q = supabaseAdmin.from('documents').select('*').is('deleted_at', null);

    if (entityId && entityId !== 'ALL') {
      q = q.eq('entity_id', entityId);
    }

    // Exclude disbursement receipts from DMS documents views
    q = q
      .not('storage_path', 'ilike', '%/disbursements/receipts/%')
      .not('storage_path', 'ilike', '%/disbursements/%');

    return q.order('created_at', { ascending: false });
  };

  const data = await fetchInPages(makeQuery);

  const validRows = await filterValidProjectRecords(data || [], {
    user,
    entityId,
    concernedWrIds,
  });

  const visibleRows = (validRows || []).filter((d) => !isDisbursementReceiptDoc(d));

  const activeCount = visibleRows.filter((d) => !d.archived).length;
  const archivedCount = visibleRows.filter((d) => d.archived).length;

  return { active: activeCount, archived: archivedCount };
};

/**
 * Confirm that a file upload to storage has completed.
 * Transitions document status from pending_upload to active.
 * @param {object} params
 * @param {string} params.entityId - Entity code
 * @param {string} params.id - Document UUID
 * @returns {Promise<object>}
 */
const confirmUpload = async ({ entityId, id, userId, user, caller, internal = false }) => {
  const effectiveUser = await resolveDocumentCaller({ user, userId, caller, internal });
  const doc = await getDocumentById({ entityId, id, user: effectiveUser, internal });

  if (doc.status !== 'pending_upload') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: `Document is already in status "${doc.status}"`,
    });
  }

  const effectiveUserId = userId || effectiveUser?.id || null;
  const updatePayload = {
    status: 'active',
    upload_date: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...(effectiveUserId ? { updated_by: effectiveUserId } : {}),
  };

  const { data: updated, error } = await supabaseAdmin
    .from('documents')
    .update(updatePayload)
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
const getDownloadUrl = async ({ entityId, id, user }) => {
  const doc = await getDocumentById({ entityId, id, user });

  if (doc.external_url && doc.external_url.trim()) {
    return { url: doc.external_url.trim(), fileName: doc.original_name || doc.file_name || 'document' };
  }

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
const updateLifecycle = async ({ entityId, id, userId, lifecycle, user, caller, internal = false }) => {
  const effectiveUser = await resolveDocumentCaller({ user, userId, caller, internal });
  await getDocumentById({ entityId, id, user: effectiveUser, internal });

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

// Authorization and mutation run together under a PostgreSQL row lock. Never
// read/replace the thread in JavaScript: separate API workers must serialize too.
const mutateDocumentComment = async ({ entityId, id, commentId, user, text, action }) => {
  if (!user || !user.id) {
    throw new AppError({
      statusCode: 401,
      title: 'Unauthorized',
      detail: 'Authentication required to mutate document comments',
    });
  }
  const document = await getDocumentById({ entityId, id, user, internal: false });
  if (!document.can_comment) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: document.linked_task_id
        ? 'You must be assigned to this task to comment on its documents.'
        : 'Document edit permission is required to comment.',
      code: 'DOCUMENT_COMMENT_FORBIDDEN',
    });
  }

  const { data, error } = await supabaseAdmin.rpc('mutate_document_comment', {
    p_entity_id: entityId,
    p_document_id: id,
    p_comment_id: commentId || null,
    p_user_id: user.id,
    p_text: text || null,
    p_action: action,
  });
  if (error) {
    const statusCode = { P0002: 404, '42501': 403, '22023': 400, '22P02': 400 }[error.code] || 500;
    throw new AppError({
      statusCode,
      title: { 404: 'Not Found', 403: 'Forbidden', 400: 'Validation Error' }[statusCode] || 'Database Error',
      detail: statusCode === 500 ? 'Failed to save document comment' : error.message,
    });
  }
  return { ...data, can_comment: true };
};
const addDocumentComment = (params) => mutateDocumentComment({ ...params, action: 'add' });
const updateDocumentComment = (params) => mutateDocumentComment({ ...params, action: 'edit' });
const deleteDocumentComment = (params) => mutateDocumentComment({ ...params, action: 'delete' });

module.exports = {
  addDocumentComment,
  updateDocumentComment,
  deleteDocumentComment,
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
