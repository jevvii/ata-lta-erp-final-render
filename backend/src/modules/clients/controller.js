/**
 * Clients module controller.
 * Route handlers delegate to the service and record audit events.
 */

const clientsService = require('./service');
const { createClientSchema, updateClientSchema } = require('./schema');
const auditService = require('../../services/auditService');
const AppError = require('../../lib/AppError');

/**
 * Validate request body against a Zod schema.
 * @param {object} schema
 * @param {object} data
 */
const validate = (schema, data) => {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      detail: issues,
      code: 'VALIDATION_ERROR',
    });
  }
  return result.data;
};

const list = async (req, res, next) => {
  try {
    const entityId = req.entityUUID;
    const { data, meta } = await clientsService.listClients({
      entityId,
      search: req.query.search,
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
      sortBy: req.query.sortBy,
      sortOrder: req.query.sortOrder,
    });
    const isPaginated = req.query.page !== undefined || req.query.limit !== undefined;
    res.status(200).json(isPaginated ? { data, meta } : { data });
  } catch (err) {
    next(err);
  }
};

const create = async (req, res, next) => {
  try {
    const payload = validate(createClientSchema, req.body);
    const entityId = req.entityUUID;

    if (payload.entity && payload.entity !== req.entityCode) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Client entity must match active entity',
      });
    }

    const client = await clientsService.createClient({
      entityId,
      data: payload,
      createdBy: req.user.id,
    });

    await auditService.log({
      action: 'client.created',
      table: 'clients',
      recordId: client.id,
      entity: req.activeEntity,
      userId: req.user.id,
      details: { name: client.name, tin: client.tin },
    });

    res.status(201).json({ data: client });
  } catch (err) {
    next(err);
  }
};

const getById = async (req, res, next) => {
  try {
    const entityId = req.entityUUID;
    const client = await clientsService.getClientById({ id: req.params.id, entityId, allowCrossEntity: !entityId });

    if (!client) {
      throw new AppError({
        statusCode: 404,
        title: 'Not Found',
        detail: 'Client not found',
      });
    }

    res.status(200).json({ data: client });
  } catch (err) {
    next(err);
  }
};

const update = async (req, res, next) => {
  try {
    const payload = validate(updateClientSchema, req.body);
    const entityId = req.entityUUID;

    if (payload.entity && payload.entity !== req.entityCode) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Client entity must match active entity',
      });
    }

    const client = await clientsService.updateClient({
      id: req.params.id,
      entityId,
      data: payload,
      updatedBy: req.user.id,
    });

    await auditService.log({
      action: 'client.updated',
      table: 'clients',
      recordId: client.id,
      entity: req.activeEntity,
      userId: req.user.id,
      details: { name: client.name, tin: client.tin },
    });

    res.status(200).json({ data: client });
  } catch (err) {
    next(err);
  }
};

const remove = async (req, res, next) => {
  try {
    const entityId = req.entityUUID;
    const removed = await clientsService.deleteClient({
      id: req.params.id,
      entityId,
      deletedBy: req.user.id,
    });

    if (!removed) {
      throw new AppError({
        statusCode: 404,
        title: 'Not Found',
        detail: 'Client not found',
      });
    }

    await auditService.log({
      action: 'client.archived',
      table: 'clients',
      recordId: req.params.id,
      entity: req.activeEntity,
      userId: req.user.id,
      details: {},
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = { clientsController: { list, create, getById, update, remove } };
