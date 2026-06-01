import type { RetrievedRecipePage } from "../retriever/types.js";
import { getArray, getNumber, getRecord, getString, isRecord } from "../utils/unknown.js";

type RecipeObject = Record<string, unknown>;

export function cookidooCreatedRecipeToPage(recipe: unknown, sourceUrl = ""): RetrievedRecipePage {
  const recipeRecord = asRecipeObject(recipe);
  const content = getRecord(recipeRecord, "recipeContent") ?? {};
  const title = getString(content, "name") ?? getString(recipeRecord, "title") ?? "Cookidoo Recipe";
  const ingredients = ingredientTexts(getArray(content, "ingredients").length ? getArray(content, "ingredients") : getArray(content, "recipeIngredient"));
  const steps = (getArray(content, "instructions").length ? getArray(content, "instructions") : getArray(content, "recipeInstructions"))
    .map((step) => (typeof step === "string" ? { text: step } : step));
  const recipeYield = getRecord(content, "yield");
  const hints = formatHints(isRecord(content) ? content.hints : undefined);
  const markdown = [
    `# ${title}`,
    "",
    "Source: Cookidoo created recipe",
    getNumber(recipeYield, "value") ? `Servings: ${getNumber(recipeYield, "value")} ${getString(recipeYield, "unitText") ?? "portion"}` : undefined,
    getNumber(content, "prepTime") ? `Prep time: ${Math.round((getNumber(content, "prepTime") ?? 0) / 60)} min` : undefined,
    getNumber(content, "totalTime") ? `Total time: ${Math.round((getNumber(content, "totalTime") ?? 0) / 60)} min` : undefined,
    getArray(content, "tools").length ? `Thermomix versions: ${getArray(content, "tools").join(", ")}` : undefined,
    "",
    "## Ingredients",
    ...ingredients.map((ingredient) => `- ${ingredient}`),
    "",
    "## Source Machine Steps",
    ...steps.flatMap((step, index) => [
      `${index + 1}. ${getStepText(step)}`,
      ...formatSourceAnnotations(getArray(step, "annotations")).map((line) => `   ${line}`)
    ]),
    hints ? ["", "## Notes", hints].join("\n") : undefined,
  ].filter(Boolean).join("\n");

  const id = getString(recipeRecord, "recipeId") ?? "";
  return {
    url: sourceUrl || id,
    finalUrl: sourceUrl || id,
    title,
    markdown,
    html: "",
    images: imageCandidatesFromCookidooContent(content),
  };
}

export function cookidooOfficialRecipeToPage(recipe: unknown, sourceUrl = ""): RetrievedRecipePage {
  const recipeRecord = asRecipeObject(recipe);
  const title = getString(recipeRecord, "title") ?? getString(recipeRecord, "name") ?? "Cookidoo Recipe";
  const groups = getArray(recipeRecord, "recipeIngredientGroups");
  const ingredients = groups.length
    ? groups.flatMap((group) => getArray(group, "recipeIngredients").map(formatOfficialIngredient))
    : ingredientTexts(getArray(recipeRecord, "recipeIngredient"));
  const stepGroups = getArray(recipeRecord, "recipeStepGroups");
  const steps = stepGroups.length
    ? stepGroups.flatMap((group) => getArray(group, "recipeSteps"))
    : getArray(recipeRecord, "recipeInstructions");
  const notes = getArray(recipeRecord, "additionalInformation").map((item) => cleanText(getString(item, "content") ?? "")).filter(Boolean);
  const servingSize = getRecord(recipeRecord, "servingSize");
  const servingQuantity = getRecord(servingSize, "quantity");

  const markdown = [
    `# ${title}`,
    "",
    "Source: Cookidoo official recipe",
    getNumber(servingQuantity, "value") ? `Servings: ${getNumber(servingQuantity, "value")} ${getString(servingSize, "unitNotation") ?? "portion"}` : undefined,
    getArray(recipeRecord, "thermomixVersions").length ? `Thermomix versions: ${getArray(recipeRecord, "thermomixVersions").join(", ")}` : undefined,
    getArray(recipeRecord, "optionalDevices").length ? `Optional devices: ${getArray(recipeRecord, "optionalDevices").join(", ")}` : undefined,
    "",
    "## Ingredients",
    ...ingredients.map((ingredient) => `- ${cleanText(ingredient)}`),
    "",
    "## Source Machine Steps",
    ...steps.map((step, index) => `${index + 1}. ${cleanText(getStepText(step))}`),
    notes.length ? ["", "## Notes", ...notes.map((note) => `- ${note}`)].join("\n") : undefined,
  ].filter(Boolean).join("\n");

  const id = getString(recipeRecord, "id") ?? "";
  return {
    url: sourceUrl || id,
    finalUrl: sourceUrl || id,
    title,
    markdown,
    html: "",
    images: imageCandidatesFromCookidooContent(recipeRecord),
  };
}

export function monsieurCuisineRecipeToPage(recipe: unknown, sourceUrl = ""): RetrievedRecipePage {
  const recipeRecord = asRecipeObject(recipe);
  const dataRecipe = getRecord(getRecord(recipeRecord, "data"), "recipe");
  const sourceRecipe = dataRecipe ?? recipeRecord;
  const title = getString(sourceRecipe, "title") ?? getString(sourceRecipe, "name") ?? "Monsieur Cuisine Recipe";
  const serving = getArray(sourceRecipe, "servingSizes")[0] ?? getRecord(sourceRecipe, "servingSize") ?? {};
  const ingredientGroups = getArray(serving, "ingredientGroups");
  const steps = getArray(serving, "steps");

  const markdown = [
    `# ${title}`,
    "",
    "Source: Monsieur Cuisine recipe",
    getNumber(serving, "amount") ? `Servings: ${getNumber(serving, "amount")} ${getString(serving, "unit") ?? "portion"}` : undefined,
    getNumber(serving, "preparationTime") ? `Prep time: ${getNumber(serving, "preparationTime")} min` : undefined,
    getNumber(serving, "readyInTime") ? `Total time: ${getNumber(serving, "readyInTime")} min` : undefined,
    "",
    "## Ingredients",
    ...ingredientGroups.flatMap((group) => [
      getString(group, "name") ? `### ${getString(group, "name")}` : undefined,
      ...getArray(group, "ingredients").map((ingredient) =>
        `- ${[valueToString(getRecordOrSelf(ingredient, "amount")), getString(ingredient, "unit"), getString(ingredient, "name")].filter(Boolean).join(" ")}${getBoolean(ingredient, "isOptional") ? " (optional)" : ""}`
      )
    ].filter((line): line is string => typeof line === "string")),
    "",
    "## Source Machine Steps",
    ...steps.flatMap((step, index) => [
      `${index + 1}. ${[getString(step, "title"), getString(step, "description") ?? getString(step, "text")].filter(Boolean).join(" - ")}`,
      getRecord(step, "mode") ? `   Source mode: ${formatMonsieurCuisineMode(getRecord(step, "mode"))}` : undefined
    ].filter((line): line is string => typeof line === "string")),
  ].filter(Boolean).join("\n");

  return {
    url: sourceUrl || String(sourceRecipe.id ?? ""),
    finalUrl: sourceUrl || String(sourceRecipe.id ?? ""),
    title,
    markdown,
    html: "",
    images: [],
  };
}

function asRecipeObject(value: unknown): RecipeObject {
  return isRecord(value) ? value : {};
}

function getRecordOrSelf(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function getBoolean(value: unknown, key: string): boolean | undefined {
  return isRecord(value) && typeof value[key] === "boolean" ? value[key] : undefined;
}

function valueToString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function ingredientTexts(items: unknown[]): string[] {
  return items.map((ingredient) => typeof ingredient === "string" ? ingredient : getString(ingredient, "text") ?? "").filter(Boolean);
}

function formatOfficialIngredient(ingredient: unknown): string {
  const quantity = getRecord(ingredient, "quantity");
  return [getNumber(quantity, "value"), getString(ingredient, "unitNotation"), getString(ingredient, "ingredientNotation"), getString(ingredient, "preparation")]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+,/g, ",");
}

function getStepText(step: unknown): string {
  if (typeof step === "string") return step;
  return getString(step, "text") ?? getString(step, "formattedText") ?? "";
}

function formatSourceAnnotations(annotations: unknown[] | undefined): string[] {
  if (!Array.isArray(annotations)) return [];
  return annotations
    .filter((annotation) => getString(annotation, "type") === "MODE" || getString(annotation, "type") === "TTS")
    .map((annotation) => {
      const data = isRecord(annotation) ? annotation.data : undefined;
      if (getString(annotation, "type") === "MODE") {
        return `Source mode: ${getString(annotation, "name") ?? ""}${data ? ` ${JSON.stringify(data)}` : ""}`;
      }
      return `Source settings: ${JSON.stringify(data ?? {})}`;
    });
}

function formatMonsieurCuisineMode(mode: unknown): string {
  const settings = getArray(mode, "deviceSettings")[0];
  return [getString(mode, "type"), settings ? JSON.stringify(settings) : undefined].filter(Boolean).join(" ");
}

function imageCandidatesFromCookidooContent(content: unknown): RetrievedRecipePage["images"] {
  const urls = collectCookidooImageUrls(content).map(normalizeCookidooImageUrl);
  return [...new Set(urls)].map((url) => ({
    url,
    contentType: "image/jpeg",
    score: 80,
    reason: "Cookidoo recipe image",
  }));
}

function collectCookidooImageUrls(content: unknown): string[] {
  const urls: string[] = [];
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    if (!value.trim()) return;
    urls.push(value);
  };
  const addAsset = (asset: unknown) => {
    if (!isRecord(asset)) return;
    add(asset.square);
    add(asset.portrait);
    add(asset.landscape);
    addAsset(asset.images);
  };

  add(getString(content, "image"));
  add(getString(content, "squareImage"));
  add(getString(content, "squareRetinaImage"));
  add(getString(content, "landscapeImage"));
  add(getString(content, "portraitImage"));
  addAsset(getRecord(getRecord(content, "assets"), "images"));
  addAsset(getRecord(content, "assets"));

  for (const asset of getArray(content, "descriptiveAssets")) {
    addAsset(asset);
  }

  return urls;
}

function normalizeCookidooImageUrl(url: string): string {
  return url.replace("/{transformation}", "");
}

function formatHints(hints: unknown): string {
  if (typeof hints === "string") return hints;
  if (!Array.isArray(hints)) return "";
  return hints.map((hint) => typeof hint === "string" ? hint : cleanText(getString(hint, "content") ?? getString(hint, "text") ?? "")).filter(Boolean).join("\n");
}

function cleanText(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
