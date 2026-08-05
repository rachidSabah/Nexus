import { randomUUID } from 'node:crypto';

import {
  buildEvent,
  PluginError,
  type PluginLoadedEvent,
  type PluginDescriptor,
  type EventBusPort,
} from '@anx/core';

/**
 * Lifecycle hooks a plugin can implement. The runtime invokes these at
 * well-defined points in the request / system lifecycle.
 */
export type PluginHook =
  | 'onRequest'        // before routing
  | 'onRouteResolved'  // after routing, before provider call
  | 'onProviderStart'  // just before provider call
  | 'onProviderChunk'  // each stream chunk
  | 'onProviderEnd'    // after provider call
  | 'onError'          // any error
  | 'onResponse'       // before final response is sent
  | 'onStartup'        // gateway startup
  | 'onShutdown';      // gateway shutdown

/**
 * Concrete plugin contract. A plugin is a factory that returns an object
 * with hook handlers + metadata.
 */
export interface Plugin {
  readonly descriptor: PluginDescriptor;
  onStartup?(ctx: PluginContext): Promise<void>;
  onShutdown?(ctx: PluginContext): Promise<void>;
  onRequest?(ctx: PluginContext, request: unknown): Promise<unknown>;
  onRouteResolved?(ctx: PluginContext, decision: unknown): Promise<void>;
  onProviderStart?(ctx: PluginContext, info: unknown): Promise<void>;
  onProviderChunk?(ctx: PluginContext, chunk: unknown): Promise<unknown>;
  onProviderEnd?(ctx: PluginContext, info: unknown): Promise<void>;
  onError?(ctx: PluginContext, error: unknown): Promise<void>;
  onResponse?(ctx: PluginContext, response: unknown): Promise<unknown>;
}

export interface PluginContext {
  readonly pluginId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
  readonly events: EventBusPort;
  readonly config: Record<string, unknown>;
}

/**
 * Plugin loader contract — given a spec (module path / inline factory),
 * produce a Plugin instance.
 */
export interface PluginLoader {
  load(spec: PluginSpec): Promise<Plugin>;
}

export interface PluginSpec {
  readonly id: string;
  readonly source: 'inline' | 'module' | 'npm';
  readonly path?: string;
  readonly config?: Record<string, unknown>;
}

/**
 * Default plugin runtime — manages plugin lifecycle and hook dispatch.
 *
 * Hook dispatch rules:
 *   - Hooks run in registration order.
 *   - A throw in a hook does NOT abort the request; the error is logged and
 *     the runtime continues with the next plugin. (Use middleware for hard
 *     enforcement.)
 *   - "Transformer" hooks (onRequest, onProviderChunk, onResponse) pass
 *     the return value of plugin N to plugin N+1.
 */
export class PluginRuntime {
  private readonly plugins = new Map<string, Plugin>();
  private readonly loadOrder: string[] = [];

  constructor(
    private readonly events: EventBusPort,
    private readonly loader: PluginLoader = new InlinePluginLoader(),
  ) {}

  async load(spec: PluginSpec): Promise<void> {
    if (this.plugins.has(spec.id)) {
      throw new PluginError(spec.id, 'plugin already loaded');
    }
    const plugin = await this.loader.load(spec);
    void plugin.descriptor; // sanity check that descriptor exists
    this.plugins.set(spec.id, plugin);
    this.loadOrder.push(spec.id);

    if (plugin.onStartup) {
      await this.safeInvoke(plugin, 'onStartup', () =>
        plugin.onStartup!(this.makeContext(spec.id, randomUUID(), randomUUID(), spec.config ?? {})),
      );
    }

    await this.events.publish(
      buildEvent<PluginLoadedEvent>(
        'plugin.loaded',
        { pluginId: spec.id, version: plugin.descriptor.version },
      ),
    );
  }

  async unload(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;
    if (plugin.onShutdown) {
      await this.safeInvoke(plugin, 'onShutdown', () =>
        plugin.onShutdown!(this.makeContext(pluginId, randomUUID(), randomUUID(), {})),
      );
    }
    this.plugins.delete(pluginId);
    const idx = this.loadOrder.indexOf(pluginId);
    if (idx >= 0) this.loadOrder.splice(idx, 1);
  }

  list(): readonly PluginDescriptor[] {
    return this.loadOrder.map((id) => this.plugins.get(id)!.descriptor);
  }

  async invokeHook<T>(hook: PluginHook, ...args: unknown[]): Promise<T[]> {
    const results: T[] = [];
    for (const id of this.loadOrder) {
      const plugin = this.plugins.get(id)!;
      // Only invoke if the plugin declares this hook in its descriptor.
      if (!plugin.descriptor.hooks.includes(hook)) continue;

      const handler = (plugin as unknown as Record<string, ((...a: unknown[]) => Promise<unknown>) | undefined>)[hook];
      if (!handler) continue;
      try {
        const result = await handler(...args);
        if (result !== undefined) results.push(result as T);
      } catch (err) {
        // Log and continue — plugins must never break the request.
        // eslint-disable-next-line no-console
        console.error(`[plugins] ${id}.${hook} threw`, err);
      }
    }
    return results;
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async safeInvoke(
    plugin: Plugin,
    hook: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[plugins] ${plugin.descriptor.id}.${hook} threw`, err);
    }
  }

  private makeContext(
    pluginId: string,
    requestId: string,
    correlationId: string,
    config: Record<string, unknown>,
  ): PluginContext {
    return {
      pluginId,
      requestId,
      correlationId,
      log: (level, msg, meta) => {
        // eslint-disable-next-line no-console
        console[level === 'debug' ? 'log' : level](`[plugin:${pluginId}]`, msg, meta ?? '');
      },
      events: this.events,
      config,
    };
  }
}

/**
 * Loader for inline plugin factories. A "module" loader that dynamically
 * imports a path is provided as a separate class for security isolation.
 */
export class InlinePluginLoader implements PluginLoader {
  async load(spec: PluginSpec): Promise<Plugin> {
    if (spec.source === 'inline') {
      const factory = (spec as PluginSpec & { factory?: () => Plugin }).factory;
      if (!factory) throw new PluginError(spec.id, 'inline plugin missing factory');
      return factory();
    }
    if (spec.source === 'module' && spec.path) {
      const mod = await import(spec.path);
      const factory = mod.default ?? mod;
      if (typeof factory !== 'function') {
        throw new PluginError(spec.id, `module ${spec.path} did not export a factory`);
      }
      return factory(spec.config);
    }
    if (spec.source === 'npm') {
      throw new PluginError(
        spec.id,
        'npm plugin loading not yet implemented — install the package and use "module" source',
      );
    }
    throw new PluginError(spec.id, `unknown source: ${spec.source}`);
  }
}

/**
 * Augment PluginSpec with an optional inline factory.
 */
declare module './index.js' {
  interface PluginSpec {
    factory?: () => Plugin;
  }
}
