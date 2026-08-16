import { FastifyReply, FastifyRequest } from 'fastify';
import {
  ICreateProjectUseCase,
  IDeleteProjectUseCase,
  IGetProjectUseCase,
  IListProjectsUseCase,
} from '../../domain/ports/inbound/project-use-cases.js';
import { CreateProjectSchema } from '../dtos/project.dto.js';

export class ProjectController {
  constructor(
    private readonly createProjectUseCase: ICreateProjectUseCase,
    private readonly getProjectUseCase: IGetProjectUseCase,
    private readonly listProjectsUseCase: IListProjectsUseCase,
    private readonly deleteProjectUseCase: IDeleteProjectUseCase
  ) {}

  public create = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const body = CreateProjectSchema.parse(request.body);
    const project = await this.createProjectUseCase.execute(body);
    reply.status(201).send({
      success: true,
      data: project.toJSON(),
    });
  };

  public getById = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> => {
    const { id } = request.params;
    const project = await this.getProjectUseCase.execute(id);
    reply.status(200).send({
      success: true,
      data: project.toJSON(),
    });
  };

  public list = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const projects = await this.listProjectsUseCase.execute();
    reply.status(200).send({
      success: true,
      data: projects.map((p) => p.toJSON()),
      total: projects.length,
    });
  };

  public delete = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> => {
    const { id } = request.params;
    await this.deleteProjectUseCase.execute(id);
    reply.status(200).send({
      success: true,
      message: `Project ${id} deleted successfully`,
    });
  };
}
