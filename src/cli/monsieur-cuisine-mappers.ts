import type { RecipeInput } from "../recipes/schema.js";
import type { SupportedLocale } from "../catalogs/types.js";
import { getArray, getNumber, getRecord, getString } from "../utils/unknown.js";

export function mapMonsieurCuisineToInput(recipe: unknown): RecipeInput {
  const source = getRecord(recipe, "data")?.recipe ?? recipe;
  const serving = getArray(source, "servingSizes")[0] ?? getRecord(source, "servingSize") ?? {};
  return {
    title: getString(source, "title") ?? "Recipe",
    description: getString(source, "description") ?? "",
    settings: {
      locale: (getString(source, "languageLocale") ?? "de-DE") as SupportedLocale,
      complexityId: getNumber(getRecord(source, "complexity"), "id") ?? 142
    },
    status: getString(source, "status") === "private-publish" ? "private-publish" : "draft",
    categoryIds: [],
    nutrients: getArray(source, "nutrients").map((nutrient) => ({
      name: (getString(nutrient, "name") ?? "calories") as "calories" | "carbohydrate" | "fat" | "protein",
      unit: getString(nutrient, "unit") ?? "",
      amount: getNumber(nutrient, "amount") ?? 0
    })),
    servingSize: {
      amount: getNumber(serving, "amount") ?? 1,
      unit: getString(serving, "unit") ?? "Portion",
      preparationTime: getNumber(serving, "preparationTime") ?? 0,
      readyInTime: getNumber(serving, "readyInTime") ?? 0,
      ingredientGroups: getArray(serving, "ingredientGroups").map((group) => ({
        name: getString(group, "name") ?? "",
        ingredients: getArray(group, "ingredients").map((ingredient) => ({
          name: getString(ingredient, "name") ?? "",
          amount: getString(ingredient, "amount") ?? getNumber(ingredient, "amount") ?? "",
          unit: getString(ingredient, "unit") ?? "",
          isOptional: getBoolean(ingredient, "isOptional") ?? false
        }))
      })),
      steps: getArray(serving, "steps").map((step) => ({
        title: firstNonEmpty(getString(step, "title"), getString(step, "description"), getString(step, "text")),
        description: getString(step, "title") ? (getString(step, "description") ?? getString(step, "text") ?? "") : "",
        mode: mapMode(getRecord(step, "mode"))
      }))
    }
  } as unknown as RecipeInput;
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => value && value.length > 0) ?? "";
}

function getBoolean(value: unknown, key: string): boolean | undefined {
  const record = getRecord({ value }, "value");
  return record && typeof record[key] === "boolean" ? record[key] : undefined;
}

type McMode = RecipeInput["servingSize"]["steps"][number]["mode"];

function mapMode(mode: unknown): McMode {
  if (!mode) return { type: "none" };
  const type = getString(mode, "type");
  const settings = getArray(mode, "deviceSettings")[0] ?? {};
  const duration = getNumber(settings, "time") ?? 0;
  const mins = Math.floor(duration / 60);
  const secs = duration % 60;

  if (type === "manualCooking" || type === "manual_cooking") {
    return {
      type: "manualCooking",
      temperature: getNumber(settings, "temperature") ?? 0,
      minutes: mins,
      seconds: secs,
      speed: getNumber(settings, "speed") ?? 0,
      rotationDirection: getBoolean(settings, "clockwise") === false ? "left" : "right"
    } as McMode;
  }
  if (type === "turbo") return { type: "turbo", seconds: duration };
  if (type === "scale") return { type: "scale", grams: getNumber(settings, "weight") ?? 0 };
  if (type === "roasting" || type === "roast") return { type: "roast", temperature: getNumber(settings, "temperature") ?? 0, minutes: mins, seconds: secs } as McMode;
  if (type === "solid_dough_knead" || type === "solidDoughKnead") return { type: "solidDoughKnead", minutes: mins, seconds: secs };
  if (type === "soft_dough_knead" || type === "softDoughKnead") return { type: "softDoughKnead", minutes: mins, seconds: secs };
  if (type === "liquid_dough_knead" || type === "liquidDoughKnead") return { type: "liquidDoughKnead", minutes: mins, seconds: secs };
  if (type === "steam" || type === "steaming") return { type: "steam", minutes: mins, seconds: secs };
  if (type === "sous_vide" || type === "sousVide") return { type: "sousVide", temperature: getNumber(settings, "temperature") ?? 0, minutes: mins, seconds: secs } as McMode;
  if (type === "slow_cooking" || type === "slowCooking") return { type: "slowCooking", temperature: getNumber(settings, "temperature") ?? 0, minutes: mins, seconds: secs } as McMode;
  if (type === "cooking_eggs" || type === "cookingEggs") return { type: "cookingEggs", size: "medium", texture: "waxy_soft" };
  if (type === "precleaning") return { type: "precleaning", duration: "short" };
  if (type === "fermentation") return { type: "fermentation", temperature: getNumber(settings, "temperature") ?? 0, minutes: mins, seconds: secs } as McMode;
  if (type === "rice_cooking" || type === "riceCooking") return { type: "riceCooking", minutes: mins, seconds: secs };
  if (type === "food_cooking" || type === "foodProcessor") return { type: "foodProcessor", minutes: mins, seconds: secs };
  if (type === "puree") return { type: "puree", minutes: mins, seconds: secs };
  if (type === "smoothie") return { type: "smoothie", minutes: mins, seconds: secs };
  return { type: "none" };
}
