import { FastifyInstance } from 'fastify';
import { TemplateController } from '../controllers/template.controller.js';

export function registerTemplateRoutes(fastify: FastifyInstance, controller: TemplateController): void {
  fastify.get('/api/v1/templates', controller.list);
  fastify.get('/api/v1/templates/:id', controller.getById);
}
