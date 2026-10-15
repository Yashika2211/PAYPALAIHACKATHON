import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output, type LanguageModel, type ModelMessage } from "ai";
import type { z } from "zod";

export type Tier = "fast" | "smart";

const DEFAULTS = {
  google: { fast: "gemini-2.5-flash", smart: "gemini-2.5-flash" },
  anthropic: { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5" },
} as const;

type ProviderName = keyof typeof DEFAULTS;

function activeProvider(): ProviderName | null {
  const name = (process.env.LLM_PROVIDER ?? "google").toLowerCase();
  if (name === "google" && process.env.GOOGLE_GENERATIVE_AI_API_KEY) return "google";
  if (name === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

/** The model for a tier, or null when no provider is configured (deterministic fallback mode). */
export function getModel(tier: Tier): LanguageModel | null {
  const provider = activeProvider();
  if (!provider) return null;
  const override = tier === "fast" ? process.env.LLM_FAST_MODEL : process.env.LLM_SMART_MODEL;
  const modelId = override || DEFAULTS[provider][tier];
  return provider === "google" ? createGoogleGenerativeAI()(modelId) : createAnthropic()(modelId);
}

export function describeModel(tier: Tier): string {
  const provider = activeProvider();
  if (!provider) return "deterministic fallback";
  const override = tier === "fast" ? process.env.LLM_FAST_MODEL : process.env.LLM_SMART_MODEL;
  return `${provider}:${override || DEFAULTS[provider][tier]}`;
}

export interface LlmResult<T> {
  value: T;
  source: "llm" | "fallback";
  raw?: string;
  error?: string;
}

/**
 * Structured generation with a hard timeout. Any failure (no key, quota, timeout,
 * schema mismatch) returns the deterministic fallback so the product never stalls.
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
  const model = getModel(args.tier);
  if (!model) return { value: args.fallback(), source: "fallback" };
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
    return { value: result.output as z.infer<S>, source: "llm", raw: result.text };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`[llm] ${args.tier} call failed, using fallback: ${error.slice(0, 200)}`);
    return { value: args.fallback(), source: "fallback", error };
  }
}
