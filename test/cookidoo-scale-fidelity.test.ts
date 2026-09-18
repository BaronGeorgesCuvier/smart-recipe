import { describe, expect, it } from "vitest";
import { validateCookidooScaleSteps } from "../src/recipes/cookidoo-scale-fidelity.js";

const source = `
## Ingredients
- 10–15 g ginger
- 40 g shallots
- 20 g butter
- 270 g pumpkin
- 70 g potatoes
- 270 g water
- 130 g cream

## Source Machine Steps
1. Add ginger and shallots.
2. Add pumpkin and potatoes.
`;

describe("Cookidoo scale fidelity", () => {
  it("accepts the minimum value of a source gram range", () => {
    const output = {
      servingSize: {
        steps: [
          {
            title: "Weigh ginger",
            description: "Add 10 g ginger.",
            mode: {
              type: "scale",
              grams: 10
            }
          }
        ]
      }
    };

    expect(
      validateCookidooScaleSteps(output, source)
    ).toEqual([]);
  });

  it("rejects another value from the range instead of the minimum", () => {
    const output = {
      servingSize: {
        steps: [
          {
            title: "Weigh ginger",
            description: "Add 15 g ginger.",
            mode: {
              type: "scale",
              grams: 15
            }
          }
        ]
      }
    };

    const errors =
      validateCookidooScaleSteps(output, source);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      "not supported"
    );
  });

  it("rejects combining two source gram ingredients into one artificial target", () => {
    const output = {
      servingSize: {
        steps: [
          {
            title: "Weigh vegetables",
            description: "Add 340 g vegetables.",
            mode: {
              type: "scale",
              grams: 340
            }
          }
        ]
      }
    };

    const errors =
      validateCookidooScaleSteps(output, source);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      "not supported"
    );
  });

  it("rejects multiple gram amounts inside one scale step", () => {
    const output = {
      servingSize: {
        steps: [
          {
            title: "Weigh pumpkin and potatoes",
            description:
              "Add 270 g pumpkin and 70 g potatoes.",
            mode: {
              type: "scale",
              grams: 340
            }
          }
        ]
      }
    };

    const errors =
      validateCookidooScaleSteps(output, source);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      "do not combine multiple gram ingredients"
    );
  });

  it("rejects a scale step that hides its gram amount", () => {
    const output = {
      servingSize: {
        steps: [
          {
            title: "Weigh vegetables",
            description: "Add the vegetables.",
            mode: {
              type: "scale",
              grams: 270
            }
          }
        ]
      }
    };

    const errors =
      validateCookidooScaleSteps(output, source);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      "must visibly identify exactly one gram amount"
    );
  });

  it("accepts an exact source gram quantity", () => {
    const output = {
      servingSize: {
        steps: [
          {
            title: "Weigh butter",
            description: "Add 20 g butter.",
            mode: {
              type: "scale",
              grams: 20
            }
          }
        ]
      }
    };

    expect(
      validateCookidooScaleSteps(output, source)
    ).toEqual([]);
  });
});
