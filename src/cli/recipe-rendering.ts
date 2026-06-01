import type { CookidooRecipeInput } from "../devices/tm/schema.js";
import { getDeviceAdapter } from "../devices/index.js";
import { isRecord } from "../utils/unknown.js";
import {
  mapOfficialCookidooToInput,
  mapCustomCookidooToInput,
} from "./cookidoo-mappers.js";
import { mapMonsieurCuisineToInput } from "./monsieur-cuisine-mappers.js";

export function mapRecipeToInput(device: "mc" | "tm", recipe: unknown): unknown {
  if (device === "tm") {
    return isOfficialCookidooRecipe(recipe)
      ? mapOfficialCookidooToInput(recipe)
      : mapCustomCookidooToInput(recipe);
  }
  return mapMonsieurCuisineToInput(recipe);
}

export function formatRecipeForTerminal(device: "mc" | "tm", recipe: unknown): string {
  const adapter = getDeviceAdapter(device);

  if (device === "tm") {
    let input: CookidooRecipeInput;
    if (isOfficialCookidooRecipe(recipe)) {
      input = mapOfficialCookidooToInput(recipe);
    } else {
      input = mapCustomCookidooToInput(recipe);
    }
    return adapter.formatInputForTerminal(input);
  }

  return adapter.formatInputForTerminal(mapMonsieurCuisineToInput(recipe));
}

function isOfficialCookidooRecipe(recipe: unknown): boolean {
  return Boolean(isRecord(recipe) && (
    recipe["@type"] === "Recipe" ||
    recipe.recipeIngredientGroups ||
    recipe.recipeStepGroups ||
    recipe.servingSize
  ));
}
