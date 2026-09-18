import { describe, expect, it } from "vitest";
import type { RecipeInput } from "../src/recipes/schema.js";
import { applyCookidooSpeedRamps } from "../src/recipes/cookidoo-speed-ramp.js";

function makeRecipe(): RecipeInput {
  return {
    title: "Pumpkin Soup",
    description: "Test recipe",
    settings: {
      locale: "en-US",
      complexityId: 22
    },
    status: "draft",
    categoryIds: [],
    nutrients: [],
    servingSize: {
      amount: 4,
      unit: "servings",
      instruction: "",
      preparationTime: 15,
      readyInTime: 30,
      ingredientGroups: [],
      steps: [
        {
          title: "Add seasonings",
          description:
            "Add remaining cream. Purée in the next step, gradually increasing speed.",
          mode: {
            type: "none"
          }
        },
        {
          title: "Purée the soup",
          description: "",
          mode: {
            type: "manualCooking",
            temperature: 0,
            minutes: 0,
            seconds: 45,
            speed: 8,
            rotationDirection: "right"
          }
        }
      ]
    }
  } as RecipeInput;
}

describe("Cookidoo speed ramp conversion", () => {
  it("splits a 45 second speed 5-9 ramp into five guided steps", () => {
    const source = `
## Source Machine Steps

5. Salz, Pfeffer und Sahne zugeben,
45 Sek./Stufe 5-9 schrittweise ansteigend pürieren.
`;

    const result = applyCookidooSpeedRamps(
      makeRecipe(),
      source
    );

    const steps = result.servingSize.steps;

    expect(steps).toHaveLength(6);

    const rampSteps = steps.slice(1);

    expect(
      rampSteps.map((step) =>
        step.mode.type === "manualCooking"
          ? step.mode.speed
          : null
      )
    ).toEqual([5, 6, 7, 8, 9]);

    expect(
      rampSteps.map((step) =>
        step.mode.type === "manualCooking"
          ? step.mode.minutes * 60 + step.mode.seconds
          : null
      )
    ).toEqual([9, 9, 9, 9, 9]);

    const totalSeconds = rampSteps.reduce(
      (total, step) => {
        if (step.mode.type !== "manualCooking") {
          return total;
        }

        return (
          total +
          step.mode.minutes * 60 +
          step.mode.seconds
        );
      },
      0
    );

    expect(totalSeconds).toBe(45);
  });


  it("replaces a 45 second Puree approximation with the exact 5-9 stepped ramp", () => {
    const recipe = makeRecipe();

    recipe.servingSize.steps[1] = {
      title: "Puree the soup",
      description: "",
      mode: {
        type: "puree",
        minutes: 0,
        seconds: 45
      }
    };

    const source = `
5. Salz und Sahne zugeben,
45 Sek./Stufe 5-9 schrittweise ansteigend pürieren.
`;

    const result = applyCookidooSpeedRamps(
      recipe,
      source
    );

    const rampSteps = result.servingSize.steps.slice(1);

    expect(
      rampSteps.map((step) =>
        step.mode.type === "manualCooking"
          ? step.mode.speed
          : null
      )
    ).toEqual([5, 6, 7, 8, 9]);

    expect(
      rampSteps.map((step) =>
        step.mode.type === "manualCooking"
          ? step.mode.minutes * 60 + step.mode.seconds
          : null
      )
    ).toEqual([9, 9, 9, 9, 9]);
  });

  it("does nothing when the source has no speed ramp", () => {
    const recipe = makeRecipe();

    const result = applyCookidooSpeedRamps(
      recipe,
      "45 Sek./Stufe 8 pürieren."
    );

    expect(result.servingSize.steps).toEqual(
      recipe.servingSize.steps
    );
  });
});
