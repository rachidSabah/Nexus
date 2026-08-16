import { ProjectFramework } from './types.js';
import { StepConfig } from './step.js';

export interface BuildTemplate {
  id: string;
  name: string;
  description: string;
  framework: ProjectFramework;
  defaultSteps: StepConfig[];
  defaultEnv?: Record<string, string>;
  outputDirectories: string[];
}
