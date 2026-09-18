import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RetrievedRecipePage } from "../src/retriever/types.js";
import {
  readGeneratedRecipeCache,
  writeGeneratedRecipeCache
} from "../src/pipeline/generation-cache.js";

const createdDirs: string[] = [];

function tempCacheDir(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "smart-recipe-generation-cache-")
  );
  createdDirs.push(dir);
  process.env.SMART_RECIPE_CACHE_DIR = dir;
  return dir;
}

function page(markdown = "# Soup\nCook it."): RetrievedRecipePage {
  return {
    url: "https://example.test/recipe",
    finalUrl: "https://example.test/recipe",
    title: "Soup",
    markdown,
    html: "",
    images: []
  };
}

const adapter = {
  id: "mc" as const,
  validateInput(input: unknown) {
    const ok =
      typeof input === "object" &&
      input !== null &&
      !Array.isArray(input) &&
      "title" in input;

    return {
      ok,
      errors: ok ? [] : ["invalid"]
    };
  },
  normalizeInput(input: unknown) {
    return input;
  }
};

afterEach(() => {
  delete process.env.SMART_RECIPE_CACHE_DIR;

  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("generation cache", () => {
  it("reuses a valid generated recipe for identical inputs", () => {
    tempCacheDir();

    const options = {
      page: page(),
      locale: "en-US" as const,
      model: "gemini-3.5-flash",
      reasoningEffort: "medium",
      excludeModes: [],
      adapter
    };

    const recipe = { title: "Cached soup" };

    writeGeneratedRecipeCache(options, recipe);

    expect(readGeneratedRecipeCache(options)).toEqual(recipe);
  });

  it("misses cache when source recipe content changes", () => {
    tempCacheDir();

    const original = {
      page: page("# Soup\nOriginal"),
      locale: "en-US" as const,
      model: "gemini-3.5-flash",
      reasoningEffort: "medium",
      excludeModes: [],
      adapter
    };

    writeGeneratedRecipeCache(original, { title: "Old soup" });

    const changed = {
      ...original,
      page: page("# Soup\nUpdated")
    };

    expect(readGeneratedRecipeCache(changed)).toBeUndefined();
  });
});
