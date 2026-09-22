import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { getTmAccountLocale, mcHasFoodProcessor } from "../src/config/env.js";

describe("mcHasFoodProcessor config helper", () => {
  let originalEnvValue: string | undefined;

  beforeEach(() => {
    originalEnvValue = process.env.MC_HAS_FOOD_PROCESSOR;
  });

  afterEach(() => {
    if (originalEnvValue === undefined) {
      delete process.env.MC_HAS_FOOD_PROCESSOR;
    } else {
      process.env.MC_HAS_FOOD_PROCESSOR = originalEnvValue;
    }
  });

  it("should return false by default when env variable is not set", () => {
    delete process.env.MC_HAS_FOOD_PROCESSOR;
    expect(mcHasFoodProcessor()).toBe(false);
  });

  it("should return true when env variable is set to 'true' (case-insensitive)", () => {
    process.env.MC_HAS_FOOD_PROCESSOR = "true";
    expect(mcHasFoodProcessor()).toBe(true);

    process.env.MC_HAS_FOOD_PROCESSOR = "TRUE";
    expect(mcHasFoodProcessor()).toBe(true);
  });

  it("should return false when env variable is set to 'false' (case-insensitive)", () => {
    process.env.MC_HAS_FOOD_PROCESSOR = "false";
    expect(mcHasFoodProcessor()).toBe(false);

    process.env.MC_HAS_FOOD_PROCESSOR = "FALSE";
    expect(mcHasFoodProcessor()).toBe(false);
  });

  it("should return false for any other values that are not 'true'", () => {
    process.env.MC_HAS_FOOD_PROCESSOR = "yes";
    expect(mcHasFoodProcessor()).toBe(false);

    process.env.MC_HAS_FOOD_PROCESSOR = "";
    expect(mcHasFoodProcessor()).toBe(false);
  });
});


describe("getTmAccountLocale", () => {
  const originalAccountLocale = process.env.TM_ACCOUNT_LOCALE;
  const originalRecipeLocale = process.env.TM_LOCALE;

  afterEach(() => {
    if (originalAccountLocale === undefined) delete process.env.TM_ACCOUNT_LOCALE;
    else process.env.TM_ACCOUNT_LOCALE = originalAccountLocale;

    if (originalRecipeLocale === undefined) delete process.env.TM_LOCALE;
    else process.env.TM_LOCALE = originalRecipeLocale;
  });

  it("uses the explicit Cookidoo account locale independently from recipe locale", () => {
    process.env.TM_LOCALE = "en-US";
    process.env.TM_ACCOUNT_LOCALE = "pl-PL";
    expect(getTmAccountLocale("de-DE")).toBe("pl-PL");
  });

  it("falls back to the legacy TM locale when account locale is unset", () => {
    delete process.env.TM_ACCOUNT_LOCALE;
    process.env.TM_LOCALE = "pl-PL";
    expect(getTmAccountLocale("de-DE")).toBe("pl-PL");
  });
});
