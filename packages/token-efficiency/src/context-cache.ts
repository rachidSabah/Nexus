import { createHash } from 'node:crypto';

export interface ContextFingerprint {
  contextHash: string;
  toolSchemaHash: string;
  systemPromptHash: string;
  timestamp: number;
  byteSize: number;
}

export class ContextCache {
  private static readonly cache = new Map<string, ContextFingerprint>();
  private static totalBytesAvoided = 0;
  private static totalTokensAvoided = 0;
  private static hits = 0;
  private static misses = 0;

  static hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  static checkAndRecord(
    agentId: string,
    systemPrompt: string,
    toolSchemasJson: string,
    contextContent: string
  ): { isHit: boolean; fingerprint: ContextFingerprint; tokensAvoided: number } {
    const sysHash = this.hashContent(systemPrompt);
    const toolHash = this.hashContent(toolSchemasJson);
    const ctxHash = this.hashContent(contextContent);

    const combinedKey = `${agentId}::${sysHash}:${toolHash}:${ctxHash}`;
    const byteSize = systemPrompt.length + toolSchemasJson.length + contextContent.length;
    const estTokens = Math.ceil(byteSize / 4);

    const existing = this.cache.get(combinedKey);
    if (existing) {
      this.hits += 1;
      this.totalBytesAvoided += byteSize;
      this.totalTokensAvoided += estTokens;
      return {
        isHit: true,
        fingerprint: existing,
        tokensAvoided: estTokens,
      };
    }

    this.misses += 1;
    const fingerprint: ContextFingerprint = {
      contextHash: ctxHash,
      toolSchemaHash: toolHash,
      systemPromptHash: sysHash,
      timestamp: Date.now(),
      byteSize,
    };

    this.cache.set(combinedKey, fingerprint);
    return {
      isHit: false,
      fingerprint,
      tokensAvoided: 0,
    };
  }

  static getStats() {
    return {
      hits: this.hits,
      misses: this.misses,
      totalBytesAvoided: this.totalBytesAvoided,
      totalTokensAvoided: this.totalTokensAvoided,
      cachedFingerprints: this.cache.size,
    };
  }

  static clear() {
    this.cache.clear();
    this.totalBytesAvoided = 0;
    this.totalTokensAvoided = 0;
    this.hits = 0;
    this.misses = 0;
  }
}
