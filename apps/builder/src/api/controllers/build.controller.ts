import { FastifyReply, FastifyRequest } from 'fastify';
import {
  ICancelBuildUseCase,
  IGetBuildLogsUseCase,
  IGetBuildUseCase,
  IListBuildsUseCase,
  ITriggerBuildUseCase,
} from '../../domain/ports/inbound/build-use-cases.js';
import {
  CancelBuildSchema,
  ListBuildsQuerySchema,
  TriggerBuildSchema,
} from '../dtos/build.dto.js';

export class BuildController {
  constructor(
    private readonly triggerBuildUseCase: ITriggerBuildUseCase,
    private readonly getBuildUseCase: IGetBuildUseCase,
    private readonly listBuildsUseCase: IListBuildsUseCase,
    private readonly cancelBuildUseCase: ICancelBuildUseCase,
    private readonly getBuildLogsUseCase: IGetBuildLogsUseCase
  ) {}

  public trigger = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const body = TriggerBuildSchema.parse(request.body);
    const job = await this.triggerBuildUseCase.execute(body);
    reply.status(202).send({
      success: true,
      data: job.toJSON(),
    });
  };

  public getById = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> => {
    const { id } = request.params;
    const job = await this.getBuildUseCase.execute(id);
    reply.status(200).send({
      success: true,
      data: job.toJSON(),
    });
  };

  public list = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const query = ListBuildsQuerySchema.parse(request.query);
    const result = await this.listBuildsUseCase.execute(query);
    reply.status(200).send({
      success: true,
      data: result.items.map((b) => b.toJSON()),
      total: result.total,
      limit: query.limit,
      offset: query.offset,
    });
  };

  public cancel = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> => {
    const { id } = request.params;
    const body = CancelBuildSchema.parse(request.body || {});
    const job = await this.cancelBuildUseCase.execute(id, body.reason);
    reply.status(200).send({
      success: true,
      data: job.toJSON(),
    });
  };

  public getLogs = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> => {
    const { id } = request.params;
    const result = await this.getBuildLogsUseCase.execute(id);
    reply.status(200).send({
      success: true,
      data: result,
    });
  };
}
