import { FastifyInstance } from 'fastify';
import { ArtifactController } from '../controllers/artifact.controller.js';

export function registerArtifactRoutes(fastify: FastifyInstance, controller: ArtifactController): void {
  fastify.get('/api/v1/builds/:buildId/artifacts', controller.listByBuildId);
  fastify.get('/api/v1/artifacts/:id/download', controller.download);
}
