import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SupportedLocale } from "../catalogs/types.js";
import type { DeviceAdapter } from "../devices/adapter.js";
import type { ReasoningEffort } from "../llm/types.js";
import type { PromptModeType } from "../recipes/types.js";
import type { RetrievedRecipePage } from "../retriever/types.js";

const CACHE_VERSION = 11;

type CacheAdapter = Pick<
  DeviceAdapter,
  "id" | "validateInput" | "normalizeInput"
>;

export interface GenerationCacheOptions {
  page: RetrievedRecipePage;
  locale: SupportedLocale;
  model?: string;
  reasoningEffort?: ReasoningEffort | string;
  excludeModes?: PromptModeType[];
  adapter: CacheAdapter;
}

export function generationCacheFile(options: GenerationCacheOptions): string {
  const contentHash = hash(options.page.markdown);

  const key = hash(JSON.stringify({
    version: CACHE_VERSION,
    adapter: options.adapter.id,
    sourceUrl: options.page.finalUrl || options.page.url,
    title: options.page.title,
    contentHash,
    locale: options.locale,
    model: options.model ?? "",
    reasoningEffort: options.reasoningEffort ?? "",
    excludeModes: [...(options.excludeModes ?? [])].sort()
  }));

  return path.join(cacheRoot(), `${key}.json`);
}

export function readGeneratedRecipeCache(
  options: GenerationCacheOptions
): unknown | undefined {
  const file = generationCacheFile(options);
  if (!fs.existsSync(file)) return undefined;

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return undefined;
    }

    const record = parsed as Record<string, unknown>;

    if (record.version !== CACHE_VERSION) return undefined;

    const recipeInput = record.recipeInput;
    const validation = options.adapter.validateInput(recipeInput);

    if (!validation.ok) return undefined;

    return options.adapter.normalizeInput(recipeInput);
  } catch {
    return undefined;
  }
}

export function writeGeneratedRecipeCache(
  options: GenerationCacheOptions,
  recipeInput: unknown
): void {
  const file = generationCacheFile(options);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  fs.writeFileSync(
    file,
    JSON.stringify({
      version: CACHE_VERSION,
      createdAt: new Date().toISOString(),
      sourceUrl: options.page.finalUrl || options.page.url,
      recipeInput
    }, null, 2) + "\n",
    "utf8"
  );
}

function cacheRoot(): string {
  return process.env.SMART_RECIPE_CACHE_DIR
    ? path.resolve(process.env.SMART_RECIPE_CACHE_DIR)
    : path.join(os.homedir(), ".smart-recipe-cache", "generated");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
