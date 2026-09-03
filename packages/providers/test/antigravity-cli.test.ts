import { describe, it, expect, vi } from "vitest";
import { AntigravityCliAdapter } from "../src/adapters/antigravity-cli.js";
import type { ProviderEndpoint } from "@anx/core";

describe("AntigravityCliAdapter", () => {
  const adapter = new AntigravityCliAdapter();

  it("identifies providerId and displayName correctly", () => {
    expect(adapter.providerId).toBe("antigravity-cli");
    expect(adapter.displayName).toBe("Google Antigravity CLI");
  });

  it("resolves model aliases correctly", () => {
    expect(adapter.resolveModel("antigravity-cli/gemini-3.7-flash-medium")).toBe("gemini-3.7-flash-medium");
    expect(adapter.resolveModel("antigravity/gemini-3.7-flash-medium")).toBe("gemini-3.7-flash-medium");
    expect(adapter.resolveModel("other-model")).toBe("other-model");
  });

  it("parses agy models output correctly without crashing on banners", () => {
    const rawOutput = `Usage: agy.exe models [flags]

List available models

Flags:
  -h      Show help
  --help  Show help
Fetching available models...
gemini-3.8-flash-high	Gemini 3.8 Flash (High)
gemini-3.8-flash-medium	Gemini 3.8 Flash (Medium)
gemini-3.7-flash-high	Gemini 3.7 Flash (High)
gemini-3.7-flash-medium	Gemini 3.7 Flash (Medium)
claude-sonnet-4-6	Claude Sonnet 4.6 (Thinking)
claude-opus-4-6-thinking	Claude Opus 4.6 (Thinking)
gpt-oss-120b-medium	GPT-OSS 120B (Medium)
`;

    const descriptors = adapter.parseModelsOutput(rawOutput);
    expect(descriptors.length).toBe(7);

    const gemini = descriptors.find((d) => d.id === "gemini-3.7-flash-medium");
    expect(gemini).toBeDefined();
    expect(gemini?.displayName).toBe("Gemini 3.7 Flash (Medium)");
    expect(gemini?.providerId).toBe("antigravity-cli");
    expect(gemini?.capabilities?.streaming).toBe(true);
    expect(gemini?.capabilities?.toolCalling).toBe(true);
    expect(gemini?.capabilities?.reasoning).toBe(true);
    expect(gemini?.pricing?.isFree).toBe(true);

    const sonnet = descriptors.find((d) => d.id === "claude-sonnet-4-6");
    expect(sonnet).toBeDefined();
    expect(sonnet?.capabilities?.vision).toBe(true);
  });

  it("handles malformed or empty models output gracefully", () => {
    expect(adapter.parseModelsOutput("")).toEqual([]);
    expect(adapter.parseModelsOutput("Fetching available models...\n\nUsage: agy models")).toEqual([]);
    expect(adapter.parseModelsOutput("Invalid line without columns")).toEqual([]);
  });

  it("detects installed executable and parses version", async () => {
    const exe = await adapter.findExecutable();
    if (exe) {
      expect(typeof exe).toBe("string");
      const version = await adapter.getVersion(exe);
      if (version) {
        expect(version).toMatch(/\d+\.\d+\.\d+/);
      }
    }
  }, 15000);

  it("provides detailed health state", async () => {
    const health = await adapter.getDetailedHealth();
    expect(["READY", "NOT_INSTALLED", "INSTALLED_NOT_AUTHENTICATED", "DEGRADED", "ERROR"]).toContain(health.status);
    expect(health.lastCheck).toBeGreaterThan(0);
  }, 20000);
});
