import { BuildJob } from '../../domain/models/build-job.js';
import { IBuildRepository } from '../../domain/ports/outbound/build-repository.port.js';
import { IExecutionEnginePort } from '../../domain/ports/outbound/execution-engine.port.js';
import { IEventPublisherPort } from '../../domain/ports/outbound/event-publisher.port.js';
import { ICancelBuildUseCase } from '../../domain/ports/inbound/build-use-cases.js';
import { BuildJobNotFoundError } from '../../domain/errors/not-found.error.js';
import { v4 as uuidv4 } from 'uuid';

export class CancelBuildUseCase implements ICancelBuildUseCase {
  constructor(
    private readonly buildRepository: IBuildRepository,
    private readonly executionEngine: IExecutionEnginePort,
    private readonly eventPublisher: IEventPublisherPort
  ) {}

  public async execute(buildId: string, reason?: string): Promise<BuildJob> {
    const job = await this.buildRepository.findById(buildId);
    if (!job) {
      throw new BuildJobNotFoundError(buildId);
    }

    if (job.status === 'running' || job.status === 'queued') {
      await this.executionEngine.cancelExecution(buildId);
      job.cancel(reason);
      await this.buildRepository.save(job);

      await this.eventPublisher.publish({
        eventId: uuidv4(),
        eventType: 'build.completed',
        timestamp: new Date(),
        buildId: job.id,
        projectId: job.projectId,
        status: 'cancelled',
        error: reason || 'Cancelled by user',
      });
    }

    return job;
  }
}
