import { afterEach, describe, expect, it } from "vitest";
import { resolveExcludedModes } from "../src/cli/import-workflow.js";

describe("import workflow mode exclusions", () => {
  const originalMcFoodProcessor = process.env.MC_HAS_FOOD_PROCESSOR;

  afterEach(() => {
    if (originalMcFoodProcessor === undefined) {
      delete process.env.MC_HAS_FOOD_PROCESSOR;
    } else {
      process.env.MC_HAS_FOOD_PROCESSOR = originalMcFoodProcessor;
    }
  });

  it("does not exclude generic Thermomix cook steps because they map to TTS", () => {
    expect(resolveExcludedModes("tm", {})).not.toContain("cook");
  });

  it("still excludes the Monsieur Cuisine food processor when the accessory is absent", () => {
    process.env.MC_HAS_FOOD_PROCESSOR = "false";

    expect(resolveExcludedModes("mc", {})).toContain("foodProcessor");
  });

  it("preserves explicit exclusions for either device", () => {
    expect(resolveExcludedModes("tm", { excludeModes: "turbo,browning" }))
      .toEqual(["turbo", "browning"]);
  });
});
