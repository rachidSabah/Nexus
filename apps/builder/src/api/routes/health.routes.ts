import { FastifyInstance } from 'fastify';
import { HealthController } from '../controllers/health.controller.js';

export function registerHealthRoutes(fastify: FastifyInstance, controller: HealthController): void {
  fastify.get('/health', controller.getHealth);
  fastify.get('/metrics', controller.getMetrics);
}
