import vm from 'node:vm';
import { createSign, createVerify } from 'node:crypto';
import type { PluginContext, PluginHook } from './index.js';

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Plugin Sandbox Engine (VM-isolated runtime execution)
 * ───────────────────────────────────────────────────────────────────────────
 */
export interface SandboxedExecutionResult<T = unknown> {
  readonly success: boolean;
  readonly result?: T;
  readonly error?: string;
  readonly executionTimeMs: number;
}

export class SandboxedPluginRunner {
  constructor(private readonly timeoutMs: number = 2000) {}

  /**
   * Executes arbitrary JS plugin script inside a locked vm.Context.
   */
  async runInSandbox<T = unknown>(
    code: string,
    contextGlobals: Record<string, unknown> = {},
  ): Promise<SandboxedExecutionResult<T>> {
    const startTime = Date.now();
    try {
      const sandbox: Record<string, unknown> = {
        console: {
          log: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
        },
        JSON,
        Math,
        Date,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        ...contextGlobals,
      };

      const context = vm.createContext(sandbox);
      const script = new vm.Script(code);

      const result = script.runInContext(context, {
        timeout: this.timeoutMs,
        displayErrors: true,
      }) as T;

      return {
        success: true,
        result,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Wraps an untrusted hook execution in sandbox protection.
   */
  createSandboxedHook(code: string, hookName: PluginHook): (ctx: PluginContext, input: unknown) => Promise<unknown> {
    return async (ctx: PluginContext, input: unknown) => {
      const wrappedCode = `(function(context, data) {
        ${code}
      })(context, data);`;

      const res = await this.runInSandbox(wrappedCode, {
        context: {
          pluginId: ctx.pluginId,
          requestId: ctx.requestId,
          config: ctx.config,
        },
        data: input,
      });

      if (!res.success) {
        ctx.log('error', `Sandboxed hook ${hookName} failed: ${res.error}`);
        return input; // Fallback safely to pass-through
      }
      return res.result !== undefined ? res.result : input;
    };
  }
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Verifiable Manifest Signer & Verifier
 * ───────────────────────────────────────────────────────────────────────────
 */
export interface SignedPluginManifest {
  readonly manifest: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly author: string;
    readonly hooks: readonly string[];
    readonly permissions?: readonly string[];
  };
  readonly signature: string; // Base64 signature
  readonly algorithm: 'RSA-SHA256';
}

export class VerifiablePluginSigner {
  static signManifest(
    manifest: SignedPluginManifest['manifest'],
    privateKeyPem: string,
  ): SignedPluginManifest {
    const canonical = JSON.stringify(manifest, Object.keys(manifest).sort());
    const signer = createSign('RSA-SHA256');
    signer.update(canonical);
    const signature = signer.sign(privateKeyPem, 'base64');
    return {
      manifest,
      signature,
      algorithm: 'RSA-SHA256',
    };
  }

  static verifyManifest(
    signed: SignedPluginManifest,
    publicKeyPem: string,
  ): boolean {
    try {
      const canonical = JSON.stringify(signed.manifest, Object.keys(signed.manifest).sort());
      const verifier = createVerify('RSA-SHA256');
      verifier.update(canonical);
      return verifier.verify(publicKeyPem, Buffer.from(signed.signature, 'base64'));
    } catch {
      return false;
    }
  }
}
