import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output, type LanguageModel, type ModelMessage } from "ai";
import type { z } from "zod";

export type Tier = "fast" | "smart";

// Each tier is a chain: if a model is overloaded or slow, the next one is tried
// before falling back to deterministic code.
const DEFAULTS = {
  google: {
    fast: ["gemini-3.5-flash-lite", "gemini-flash-lite-latest"],
    smart: ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-flash-latest"],
  },
  anthropic: { fast: ["claude-haiku-5-5"], smart: ["claude-sonnet-5-5", "claude-haiku-5-5"] },
} as const;

type ProviderName = keyof typeof DEFAULTS;

function activeProvider(): ProviderName | null {
  const name = (process.env.LLM_PROVIDER ?? "google").toLowerCase();
  if (name === "google" && process.env.GOOGLE_GENERATIVE_AI_API_KEY) return "google";
  if (name === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

function modelIds(tier: Tier): string[] {
  const provider = activeProvider();
  if (!provider) return [];
  const override = (tier === "fast" ? process.env.LLM_FAST_MODEL : process.env.LLM_SMART_MODEL)?.trim();
  return override ? override.split(",").map((s) => s.trim()) : [...DEFAULTS[provider][tier]];
}

/** The model chain for a tier; empty when no provider is configured (deterministic fallback mode). */
export function getModels(tier: Tier): LanguageModel[] {
  const provider = activeProvider();
  if (!provider) return [];
  const make = provider === "google" ? createGoogleGenerativeAI() : createAnthropic();
  return modelIds(tier).map((id) => make(id));
}

export function describeModel(tier: Tier): string {
  const provider = activeProvider();
  return provider ? `${provider}:${modelIds(tier).join(" → ")}` : "deterministic fallback";
}

export interface LlmResult<T> {
  value: T;
  source: "llm" | "fallback";
  model?: string;
  raw?: string;
  error?: string;
}

/**
 * Structured generation with a hard timeout per model. Any failure (no key,
 * overload, quota, timeout, schema mismatch) moves to the next model, then to
 * the deterministic fallback, so the product never stalls.
 */
export async function structured<S extends z.ZodType>(args: {
  tier: Tier;
  schema: S;
  system: string;
  prompt?: string;
  messages?: ModelMessage[];
  fallback: () => z.infer<S>;
  timeoutMs?: number;
}): Promise<LlmResult<z.infer<S>>> {
  const models = getModels(args.tier);
  const ids = modelIds(args.tier);
  let lastError = "no model configured";
  for (const [i, model] of models.entries()) {
    try {
      const base = {
        model,
        system: args.system,
        output: Output.object({ schema: args.schema }),
        abortSignal: AbortSignal.timeout(args.timeoutMs ?? 20_000),
        maxRetries: 1,
      };
      const result = args.messages
        ? await generateText({ ...base, messages: args.messages })
        : await generateText({ ...base, prompt: args.prompt ?? "" });
      return { value: result.output as z.infer<S>, source: "llm", model: ids[i], raw: result.text };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[llm] ${ids[i]} failed: ${lastError.slice(0, 160)}`);
    }
  }
  return { value: args.fallback(), source: "fallback", error: lastError };
}
