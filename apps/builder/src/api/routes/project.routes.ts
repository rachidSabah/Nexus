import { FastifyInstance } from 'fastify';
import { ProjectController } from '../controllers/project.controller.js';

export function registerProjectRoutes(fastify: FastifyInstance, controller: ProjectController): void {
  fastify.post('/api/v1/projects', controller.create);
  fastify.get('/api/v1/projects', controller.list);
  fastify.get('/api/v1/projects/:id', controller.getById);
  fastify.delete('/api/v1/projects/:id', controller.delete);
}
