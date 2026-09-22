import { describe, expect, it } from "vitest";
import { validateTmAdaptationOutput } from "../src/llm/openai-generator.js";

describe("Thermomix web adaptation fidelity", () => {
  const source = `
## Malzemeler
* 1 litre süt
* 1 litre su (yaklaşık beş su bardağı)
* 1.5 çay bardağı pirinç
* 2 yemek kaşığı nişasta
* 1.5 su bardağı toz şeker
* 1 su bardağı süt

1. Pirinci su ile kaynatın.
2. Sütü ekleyin.
`;

  it("rejects non-metric English volume units", () => {
    const output = {
      ingredients: [
        { id: "starch", text: "1.5 tbsp starch" },
        { id: "sugar", text: "1.125 cups granulated sugar" }
      ],
      steps: []
    };

    const errors = validateTmAdaptationOutput(output, source, "en-US");
    expect(errors.join("\n")).toContain("must use metric units");
  });

  it("rejects translated tea-glass units instead of mL", () => {
    const output = {
      ingredients: [
        { id: "rice", text: "1.125 Turkish tea glasses rice" }
      ],
      steps: []
    };

    const errors = validateTmAdaptationOutput(output, source, "en-US");
    expect(errors.join("\n")).toContain("1 çay bardağı = 100 mL");
  });

  it("rejects invented measuring-cup removal when absent from source", () => {
    const output = {
      ingredients: [],
      steps: [
        { text: "Cook without the measuring cup for 20 min/100°C/Reverse/Speed 1." }
      ]
    };

    const errors = validateTmAdaptationOutput(output, source, "en-US");
    expect(errors.join("\n")).toContain("Do not invent measuring-cup removal");
  });

  it("accepts metric English text without invented measuring-cup handling", () => {
    const output = {
      ingredients: [
        { id: "rice", text: "112.5 mL rice" },
        { id: "starch", text: "22.5 mL starch" },
        { id: "sugar", text: "225 mL granulated sugar" },
        { id: "milk", text: "150 mL milk" }
      ],
      steps: [
        { text: "Cook for 20 min/95°C/Reverse/Speed 1." }
      ]
    };

    expect(validateTmAdaptationOutput(output, source, "en-US")).toEqual([]);
  });
});
