import { describe, it, expect } from 'vitest';
import { PromptTemplateRegistry } from '../src/index.js';

describe('Prompt Template Registry (with versioning)', () => {
  it('registers and renders versioned templates with variable substitution', () => {
    const registry = new PromptTemplateRegistry();

    registry.register({
      name: 'code-review',
      version: '1.0.0',
      template: 'Please review the following {{language}} code:\n\n```\n{{code}}\n```',
      defaults: { language: 'TypeScript' },
    });

    const rendered = registry.render('code-review', { code: 'const x = 42;' });
    expect(rendered).toContain('Please review the following TypeScript code');
    expect(rendered).toContain('const x = 42;');
  });

  it('supports version resolution and immutability', () => {
    const registry = new PromptTemplateRegistry();

    registry.register({
      name: 'greeting',
      version: '1.0.0',
      template: 'Hello, {{name}}!',
    });

    registry.register({
      name: 'greeting',
      version: '2.0.0',
      template: 'Greetings and welcome, {{name}}!',
    });

    // Default renders latest (2.0.0)
    expect(registry.render('greeting', { name: 'Alice' })).toBe('Greetings and welcome, Alice!');

    // Explicit version renders 1.0.0
    expect(registry.render('greeting', { name: 'Bob' }, '1.0.0')).toBe('Hello, Bob!');

    // Re-registering existing version throws
    expect(() => {
      registry.register({
        name: 'greeting',
        version: '1.0.0',
        template: 'Overwritten',
      });
    }).toThrow(/already registered/);
  });
});
