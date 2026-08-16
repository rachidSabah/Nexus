import { FastifyInstance } from 'fastify';
import { BuildController } from '../controllers/build.controller.js';

export function registerBuildRoutes(fastify: FastifyInstance, controller: BuildController): void {
  fastify.post('/api/v1/builds', controller.trigger);
  fastify.get('/api/v1/builds', controller.list);
  fastify.get('/api/v1/builds/:id', controller.getById);
  fastify.post('/api/v1/builds/:id/cancel', controller.cancel);
  fastify.get('/api/v1/builds/:id/logs', controller.getLogs);
}
