import { BuildTemplate } from '../../models/template.js';

export interface IListTemplatesUseCase {
  execute(): Promise<BuildTemplate[]>;
}

export interface IGetTemplateUseCase {
  execute(templateId: string): Promise<BuildTemplate>;
}
