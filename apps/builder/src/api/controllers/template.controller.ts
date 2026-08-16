import { FastifyReply, FastifyRequest } from 'fastify';
import { TemplateCatalogUseCase } from '../../application/use-cases/template-catalog.use-case.js';

export class TemplateController {
  constructor(private readonly templateCatalog: TemplateCatalogUseCase) {}

  public list = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const templates = await this.templateCatalog.execute();
    reply.status(200).send({
      success: true,
      data: templates,
      total: templates.length,
    });
  };

  public getById = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> => {
    const { id } = request.params;
    const template = await this.templateCatalog.getById(id);
    reply.status(200).send({
      success: true,
      data: template,
    });
  };
}
