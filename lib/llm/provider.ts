import { createHash } from "node:crypto";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, isStepCount, Output, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { db, schema } from "@/lib/db/client";

export type Tier = "fast" | "smart";

// Each tier is a chain: if a model is overloaded, out of quota or slow, the next one
// is tried. Lite models sit at the end because they keep separate free-tier quota.
const DEFAULTS = {
  google: {
    fast: ["gemini-3.5-flash-lite", "gemini-flash-lite-latest"],
    smart: ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"],
  },
  anthropic: { fast: ["claude-haiku-5-5"], smart: ["claude-sonnet-5-5", "claude-haiku-5-5"] },
} as const;

type ProviderName = keyof typeof DEFAULTS;

const splitList = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function activeProvider(): ProviderName | null {
  const name = (process.env.LLM_PROVIDER ?? "google").toLowerCase();
  if (name === "google" && process.env.GOOGLE_GENERATIVE_AI_API_KEY) return "google";
  if (name === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

function modelIds(tier: Tier): string[] {
  const provider = activeProvider();
  if (!provider) return [];
  const override = splitList(tier === "fast" ? process.env.LLM_FAST_MODEL : process.env.LLM_SMART_MODEL);
  return override.length ? override : [...DEFAULTS[provider][tier]];
}

/** Model+key labels that reported exhausted quota, skipped until the timestamp. */
const cooldown = new Map<string, number>();
const QUOTA_COOLDOWN_MS = 10 * 60_000;

interface Candidate {
  label: string;
  model: LanguageModel;
}

/**
 * Model × API-key chain for a tier. Several comma-separated Google keys (separate
 * free projects) multiply the free quota; the best model is tried on every key first.
 */
function candidates(tier: Tier): Candidate[] {
  const provider = activeProvider();
  if (!provider) return [];
  const ids = modelIds(tier);
  if (provider === "anthropic") {
    const make = createAnthropic();
    return ids.map((id) => ({ label: id, model: make(id) }));
  }
  const keys = splitList(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  const makers = keys.map((apiKey) => createGoogleGenerativeAI({ apiKey }));
  return ids.flatMap((id) => makers.map((make, k) => ({ label: keys.length > 1 ? `${id}#${k + 1}` : id, model: make(id) })));
}

export function describeModel(tier: Tier): string {
  const provider = activeProvider();
  if (!provider) return "deterministic fallback";
  const keys = provider === "google" ? splitList(process.env.GOOGLE_GENERATIVE_AI_API_KEY).length : 1;
  return `${provider}:${modelIds(tier).join(" → ")}${keys > 1 ? ` (${keys} keys)` : ""}`;
}

export interface LlmResult<T> {
  value: T;
  /** llm: live model answer. cache: an earlier live answer to the identical input. fallback: deterministic code. */
  source: "llm" | "cache" | "fallback";
  model?: string;
  raw?: string;
  error?: string;
}

function defaultCacheKey(tier: Tier, system: string, prompt?: string, messages?: ModelMessage[]): string {
  return createHash("sha256").update(JSON.stringify({ tier, system, prompt, messages })).digest("hex");
}

async function readCache(key: string) {
  try {
    return await db.query.llmCache.findFirst({ where: eq(schema.llmCache.key, key) });
  } catch {
    return undefined;
  }
}

async function writeCache(key: string, value: unknown, model: string) {
  try {
    await db
      .insert(schema.llmCache)
      .values({ key, value: value as object, model })
      .onConflictDoUpdate({ target: schema.llmCache.key, set: { value: value as object, model, createdAt: new Date() } });
  } catch {
    /* caching is best effort */
  }
}

/**
 * Structured generation with a hard timeout per attempt. Any failure (no key,
 * overload, quota, timeout, schema mismatch) moves down the chain; if every live
 * model fails, the last good answer to the identical input is replayed (labelled
 * "cache"), and only then the deterministic fallback runs. The product never stalls.
 */
export async function structured<S extends z.ZodType>(args: {
  tier: Tier;
  schema: S;
  system: string;
  prompt?: string;
  messages?: ModelMessage[];
  fallback: () => z.infer<S>;
  timeoutMs?: number;
  /** Stable key for inputs whose bytes vary (e.g. re-encoded sample photos). */
  cacheKey?: string;
}): Promise<LlmResult<z.infer<S>>> {
  const chain = candidates(args.tier);
  const key = args.cacheKey ? `k:${args.cacheKey}` : defaultCacheKey(args.tier, args.system, args.prompt, args.messages);
  let lastError = "no model configured";

  for (const { label, model } of chain) {
    if ((cooldown.get(label) ?? 0) > Date.now()) continue;
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
      await writeCache(key, result.output, label);
      return { value: result.output as z.infer<S>, source: "llm", model: label, raw: result.text };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (/quota|RESOURCE_EXHAUSTED|rate limit/i.test(lastError)) cooldown.set(label, Date.now() + QUOTA_COOLDOWN_MS);
      console.warn(`[llm] ${label} failed: ${lastError.slice(0, 160)}`);
    }
  }

  if (chain.length) {
    const cached = await readCache(key);
    if (cached) return { value: args.schema.parse(cached.value), source: "cache", model: cached.model, error: lastError };
  }
  return { value: args.fallback(), source: "fallback", error: lastError };
}

/**
 * Tool-calling loop over the model chain. Tools enforce their own rules in code;
 * `done` tells us whether the agent actually finished the job, so a model that
 * stops early is treated like a failure and the next model (or the caller's
 * deterministic path) takes over.
 */
export async function runToolAgent(args: {
  tier: Tier;
  system: string;
  prompt: string;
  tools: ToolSet;
  maxSteps: number;
  done: () => boolean;
  timeoutMs?: number;
}): Promise<{ model: string | null; error?: string }> {
  let lastError = "no model configured";
  for (const { label, model } of candidates(args.tier)) {
    if ((cooldown.get(label) ?? 0) > Date.now()) continue;
    try {
      await generateText({
        model,
        system: args.system,
        prompt: args.prompt,
        tools: args.tools,
        stopWhen: isStepCount(args.maxSteps),
        abortSignal: AbortSignal.timeout(args.timeoutMs ?? 45_000),
        maxRetries: 1,
      });
      if (args.done()) return { model: label };
      lastError = `${label} stopped before finishing`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (/quota|RESOURCE_EXHAUSTED|rate limit/i.test(lastError)) cooldown.set(label, Date.now() + QUOTA_COOLDOWN_MS);
      console.warn(`[llm] ${label} (tools) failed: ${lastError.slice(0, 160)}`);
    }
    if (args.done()) return { model: label };
  }
  return { model: null, error: lastError };
}
