import { BuildTemplate } from '../../domain/models/template.js';

export const DEFAULT_BUILD_TEMPLATES: BuildTemplate[] = [
  {
    id: 'node-ts-app',
    name: 'Node.js & TypeScript Application',
    description: 'Standard TypeScript build, lint, test, and bundle pipeline',
    framework: 'typescript',
    defaultSteps: [
      { id: 'install', name: 'Install Dependencies', command: 'npm ci || npm install' },
      { id: 'typecheck', name: 'Type Check', command: 'npx tsc --noEmit', continueOnError: false },
      { id: 'build', name: 'Build Bundle', command: 'npm run build' },
      { id: 'test', name: 'Run Tests', command: 'npm test --if-present', continueOnError: true },
    ],
    outputDirectories: ['dist', 'build'],
  },
  {
    id: 'nextjs-app',
    name: 'Next.js Web Application',
    description: 'Next.js production build with standalone output generation',
    framework: 'nextjs',
    defaultSteps: [
      { id: 'install', name: 'Install Dependencies', command: 'npm install' },
      { id: 'lint', name: 'Next Lint', command: 'npx next lint --fix', continueOnError: true },
      { id: 'build', name: 'Next.js Build', command: 'npx next build' },
    ],
    outputDirectories: ['.next', 'out'],
  },
  {
    id: 'react-spa',
    name: 'React SPA (Vite / CRA)',
    description: 'Modern React Single Page Application builder',
    framework: 'react',
    defaultSteps: [
      { id: 'install', name: 'Install Dependencies', command: 'npm install' },
      { id: 'build', name: 'Vite Build', command: 'npm run build' },
    ],
    outputDirectories: ['dist'],
  },
  {
    id: 'python-service',
    name: 'Python Application & Microservice',
    description: 'Python virtualenv setup, pytest, and wheel package build',
    framework: 'python',
    defaultSteps: [
      { id: 'deps', name: 'Install Requirements', command: 'pip install -r requirements.txt' },
      { id: 'test', name: 'Run Unit Tests', command: 'pytest', continueOnError: true },
      { id: 'package', name: 'Build Wheel', command: 'python -m build --if-present', continueOnError: true },
    ],
    outputDirectories: ['dist', '__pycache__'],
  },
  {
    id: 'rust-binary',
    name: 'Rust Cargo Crate & Binary',
    description: 'Rust cargo check, test, and release compilation',
    framework: 'rust',
    defaultSteps: [
      { id: 'check', name: 'Cargo Check', command: 'cargo check' },
      { id: 'test', name: 'Cargo Test', command: 'cargo test', continueOnError: true },
      { id: 'build', name: 'Cargo Release Build', command: 'cargo build --release' },
    ],
    outputDirectories: ['target/release'],
  },
  {
    id: 'custom-pipeline',
    name: 'Custom Pipeline',
    description: 'Generic customizable build pipeline with custom steps',
    framework: 'custom',
    defaultSteps: [
      { id: 'step-1', name: 'Execute Custom Step', command: 'echo "Executing custom build step"' },
    ],
    outputDirectories: ['dist', 'artifacts'],
  },
];
