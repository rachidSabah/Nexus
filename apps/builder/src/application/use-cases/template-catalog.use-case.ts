import { BuildTemplate } from '../../domain/models/template.js';
import {
  IGetTemplateUseCase,
  IListTemplatesUseCase,
} from '../../domain/ports/inbound/template-use-cases.js';
import { TemplateNotFoundError } from '../../domain/errors/not-found.error.js';

export class TemplateCatalogUseCase implements IListTemplatesUseCase, IGetTemplateUseCase {
  constructor(private readonly templates: BuildTemplate[]) {}

  public async execute(): Promise<BuildTemplate[]>;
  public async execute(templateId: string): Promise<BuildTemplate>;
  public async execute(templateId?: string): Promise<BuildTemplate[] | BuildTemplate> {
    if (templateId !== undefined) {
      return this.getById(templateId);
    }
    return [...this.templates];
  }

  public async getById(templateId: string): Promise<BuildTemplate> {
    const template = this.templates.find((t) => t.id === templateId);
    if (!template) {
      throw new TemplateNotFoundError(templateId);
    }
    return template;
  }
}
