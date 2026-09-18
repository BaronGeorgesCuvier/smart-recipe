import { describe, expect, it } from "vitest";
import { cookidooOfficialRecipeToPage } from "../src/sources/format-page.js";

describe("Cookidoo official source fidelity", () => {
  it("preserves structured ranges, alternatives, metadata and nutrition", () => {
    const page = cookidooOfficialRecipeToPage({
      id: "r-test",
      title: "Structured source fixture",

      servingSize: {
        quantity: { value: 4 },
        unitNotation: "portions"
      },

      times: [
        {
          type: "activeTime",
          quantity: { value: 900 }
        },
        {
          type: "totalTime",
          quantity: { value: 1800 }
        }
      ],

      difficulty: "easy",

      nutritionGroups: [
        {
          name: "",
          recipeNutritions: [
            {
              quantity: 1,
              unitNotation: "portion",
              nutritions: [
                { type: "kcal", number: 124, unittype: "kcal" },
                { type: "carb2", number: 8, unittype: "g" },
                { type: "fat", number: 9, unittype: "g" },
                { type: "protein", number: 2, unittype: "g" }
              ]
            }
          ]
        }
      ],

      recipeIngredientGroups: [
        {
          title: "Main",
          recipeIngredients: [
            {
              quantity: {
                from: 10,
                to: 15
              },
              unitNotation: "g",
              ingredientNotation: "Range ingredient",
              preparation: "sliced",
              optional: false
            },
            {
              quantity: {
                value: 0.5
              },
              unitNotation: "tsp",
              ingredientNotation: "Primary ingredient",
              optional: false,

              recipeAlternativeIngredient: {
                quantity: {
                  value: 1
                },
                unitNotation: "piece",
                ingredientNotation: "Alternative ingredient",
                preparation: "",
                optional: false
              }
            }
          ]
        }
      ],

      recipeStepGroups: [
        {
          title: "",
          recipeSteps: [
            {
              formattedText:
                "Process 45 sec at speed 5-9, gradually increasing."
            }
          ]
        }
      ]
    });

    expect(page.markdown).toContain("Servings: 4 portions");
    expect(page.markdown).toContain("Prep time: 15 min");
    expect(page.markdown).toContain("Total time: 30 min");
    expect(page.markdown).toContain("Difficulty: easy");

    expect(page.markdown).toContain("### Main");
    expect(page.markdown).toContain(
      "- 10–15 g Range ingredient sliced"
    );

    expect(page.markdown).toContain(
      "0.5 tsp Primary ingredient [Alternative: 1 piece Alternative ingredient]"
    );

    expect(page.markdown).toContain(
      "calories 124 kcal; carbohydrate 8 g; fat 9 g; protein 2 g"
    );

    expect(page.markdown).toContain(
      "speed 5-9, gradually increasing"
    );
  });
});
