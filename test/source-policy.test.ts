import { describe, expect, it } from "vitest";
import { buildRecipeInstructions } from "../src/llm/prompts.js";

describe("recipe source policy", () => {
  it("keeps generic adaptation rules for normal recipe sources", () => {
    const prompt = buildRecipeInstructions(
      "de-DE",
      [],
      "adapt"
    );

    expect(prompt).toContain("PRACTICAL WEIGHING AND MARKET QUANTITIES");
    expect(prompt).toContain("GROSS VS. NET WEIGHT RULE");
    expect(prompt).toContain("PRE-CUTTING INGREDIENTS");
    expect(prompt).toContain("CHOP-SCRAPE-SAUTÉ SEQUENCE");
  });

  it("uses a clean machine-fidelity prompt for official machine recipes", () => {
    const prompt = buildRecipeInstructions(
      "de-DE",
      [],
      "machine-fidelity"
    );

    expect(prompt).toContain("SOURCE POLICY: MACHINE-FIDELITY");
    expect(prompt).toContain("INGREDIENT FIDELITY");
    expect(prompt).toContain("STEP FIDELITY");
    expect(prompt).toContain("UNREPRESENTABLE SETTINGS");

    expect(prompt).not.toContain("PRACTICAL WEIGHING AND MARKET QUANTITIES");
    expect(prompt).not.toContain("GROSS VS. NET WEIGHT RULE");
    expect(prompt).not.toContain("PRE-CUTTING INGREDIENTS");
    expect(prompt).not.toContain("CHOP-SCRAPE-SAUTÉ SEQUENCE");
    expect(prompt).not.toContain("LIQUID ADJUSTMENT");
  });

  it("defaults to adapt policy for existing callers", () => {
    const prompt = buildRecipeInstructions("de-DE");

    expect(prompt).toContain("PRACTICAL WEIGHING AND MARKET QUANTITIES");
    expect(prompt).not.toContain("SOURCE POLICY: MACHINE-FIDELITY");
  });
});
