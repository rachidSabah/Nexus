/**
 * ───────────────────────────────────────────────────────────────────────────
 * Prompt Template Registry (with Semantic Versioning)
 *
 * Implements centralized, immutable, versioned prompt templates with
 * variable interpolation, defaults, and semantic version resolution.
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface PromptTemplateDefinition {
  readonly name: string;
  readonly version: string; // e.g. "1.0.0", "1.1.0"
  readonly template: string;
  readonly description?: string;
  readonly defaults?: Record<string, string>;
  readonly tags?: readonly string[];
  readonly createdAt?: Date;
}

export interface PromptTemplateRecord extends PromptTemplateDefinition {
  readonly createdAt: Date;
  readonly variables: readonly string[];
}

export class PromptTemplateRegistry {
  private readonly templates = new Map<string, Map<string, PromptTemplateRecord>>(); // name -> version -> record

  /**
   * Register a versioned prompt template.
   * If the template name and version already exist, throws an error (immutable).
   */
  register(def: PromptTemplateDefinition): PromptTemplateRecord {
    const nameMap = this.templates.get(def.name) ?? new Map<string, PromptTemplateRecord>();
    if (nameMap.has(def.version)) {
      throw new Error(`Prompt template ${def.name}@${def.version} is already registered (templates are immutable)`);
    }

    // Extract all {{variable}} keys
    const foundVars = new Set<string>();
    const matches = def.template.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g);
    for (const m of matches) {
      if (m[1]) foundVars.add(m[1]);
    }

    const record: PromptTemplateRecord = {
      ...def,
      createdAt: def.createdAt ?? new Date(),
      variables: Array.from(foundVars),
    };

    nameMap.set(def.version, record);
    this.templates.set(def.name, nameMap);
    return record;
  }

  /**
   * Retrieve a template by name and optional version.
   * If version is omitted, returns the latest registered version.
   */
  get(name: string, version?: string): PromptTemplateRecord | undefined {
    const nameMap = this.templates.get(name);
    if (!nameMap || nameMap.size === 0) return undefined;

    if (version) {
      return nameMap.get(version);
    }

    // Return latest version sorted descending
    const versions = Array.from(nameMap.keys()).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    const latest = versions[0];
    return latest ? nameMap.get(latest) : undefined;
  }

  /**
   * Render a template with provided variables and default fallbacks.
   */
  render(name: string, variables: Record<string, unknown> = {}, version?: string): string {
    const template = this.get(name, version);
    if (!template) {
      throw new Error(`Prompt template ${name}${version ? `@${version}` : ''} not found`);
    }

    let rendered = template.template;
    const mergedVars: Record<string, unknown> = {
      ...(template.defaults ?? {}),
      ...variables,
    };

    for (const [key, val] of Object.entries(mergedVars)) {
      const reg = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
      rendered = rendered.replace(reg, String(val ?? ''));
    }

    return rendered;
  }

  /**
   * List all registered template records.
   */
  list(nameFilter?: string): readonly PromptTemplateRecord[] {
    const list: PromptTemplateRecord[] = [];
    for (const [name, versionMap] of this.templates.entries()) {
      if (nameFilter && name !== nameFilter) continue;
      for (const record of versionMap.values()) {
        list.push(record);
      }
    }
    return list;
  }

  /**
   * Delete a specific version of a template.
   */
  delete(name: string, version: string): boolean {
    const nameMap = this.templates.get(name);
    if (!nameMap) return false;
    const removed = nameMap.delete(version);
    if (nameMap.size === 0) this.templates.delete(name);
    return removed;
  }
}
