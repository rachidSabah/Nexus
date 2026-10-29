import { createHash } from 'node:crypto';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  cacheControl?: { type: 'ephemeral' };
}

export interface PinnedCompactionResult {
  messages: ChatMessage[];
  prefixHash: string;
  pinnedTokenEstimate: number;
  compressedDeltaTokensSaved: number;
}

export class PrefixPinnedCompactor {
  constructor(
    private readonly minPinTurns: number = 4,
    private readonly tailCompressThresholdChars: number = 6000,
    private readonly deltaCompressor: (text: string) => string = PrefixPinnedCompactor.defaultCavemanCompress,
  ) {}

  public compact(messages: ChatMessage[]): PinnedCompactionResult {
    // 1. Freeze system messages + initial N turns so provider prefix cache stays 100% byte-identical
    const pinBoundary = Math.min(messages.length, this.minPinTurns);
    const pinnedPrefix = messages.slice(0, pinBoundary).map((msg, idx) =>
      idx === pinBoundary - 1 ? { ...msg, cacheControl: { type: 'ephemeral' as const } } : msg,
    );

    const prefixHash = createHash('sha256')
      .update(JSON.stringify(pinnedPrefix.map((m) => ({ r: m.role, c: m.content }))))
      .digest('hex');

    // 2. Only compress the un-cached sliding tail
    const slidingTail = messages.slice(pinBoundary);
    let savedChars = 0;

    const compactedTail = slidingTail.map((msg, index) => {
      // Never compress the very last user turn
      const isLastUserTurn = index === slidingTail.length - 1 && msg.role === 'user';
      if (isLastUserTurn || msg.content.length < this.tailCompressThresholdChars) {
        return msg;
      }
      const compressed = this.deltaCompressor(msg.content);
      savedChars += Math.max(0, msg.content.length - compressed.length);
      return { ...msg, content: compressed };
    });

    const pinnedTokenEstimate = Math.ceil(
      pinnedPrefix.reduce((acc, m) => acc + m.content.length, 0) / 4,
    );

    return {
      messages: [...pinnedPrefix, ...compactedTail],
      prefixHash,
      pinnedTokenEstimate,
      compressedDeltaTokensSaved: Math.ceil(savedChars / 4),
    };
  }

  public static defaultCavemanCompress(text: string): string {
    return text
      .replace(/\b(please|kindly|could you|I would like you to|basically|essentially)\b/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }
}
