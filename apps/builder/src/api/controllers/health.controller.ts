import { FastifyReply, FastifyRequest } from 'fastify';
import { IBuildRepository } from '../../domain/ports/outbound/build-repository.port.js';
import { IProjectRepository } from '../../domain/ports/outbound/project-repository.port.js';

export class HealthController {
  private readonly startTime = Date.now();

  constructor(
    private readonly projectRepository: IProjectRepository,
    private readonly buildRepository: IBuildRepository
  ) {}

  public getHealth = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.status(200).send({
      status: 'healthy',
      service: 'agent-nexus-builder',
      version: '0.5.0',
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
    });
  };

  public getMetrics = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const projects = await this.projectRepository.findAll();
    const activeBuilds = await this.buildRepository.findActiveBuilds();
    const totalBuilds = await this.buildRepository.count();
    const memory = process.memoryUsage();

    reply.status(200).send({
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      counts: {
        projectsTotal: projects.length,
        buildsActive: activeBuilds.length,
        buildsTotal: totalBuilds,
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        rssMb: Math.round(memory.rss / (1024 * 1024)),
        heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
        heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024)),
      },
    });
  };
}
