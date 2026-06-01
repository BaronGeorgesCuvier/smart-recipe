import type { CookidooRecipeInput } from "../devices/tm/schema.js";
import { getArray, getNumber, getRecord, getString, isRecord } from "../utils/unknown.js";

type CookidooStepInput = CookidooRecipeInput["steps"][number];
type CookidooModeInput = NonNullable<CookidooStepInput["modeAnnotations"]>[number]["mode"];
type CookidooIngredientAnnotation = NonNullable<CookidooStepInput["ingredientAnnotations"]>[number];
type CookidooModeAnnotation = NonNullable<CookidooStepInput["modeAnnotations"]>[number];

export function cleanHtmlText(text: string): string {
  if (!text) return "";
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&frac12;/g, "½")
    .replace(/&frac14;/g, "¼")
    .replace(/&frac34;/g, "¾")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function parseIsoDuration(duration: string): number {
  if (!duration) return 0;
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const seconds = match[3] ? parseInt(match[3], 10) : 0;
  return hours * 60 + minutes + Math.round(seconds / 60);
}

function turboModeFromText(durationText: string, countText?: string): CookidooModeInput | undefined {
  const pulseDuration = Number(durationText.replace(",", "."));
  if (pulseDuration !== 0.5 && pulseDuration !== 1 && pulseDuration !== 2) {
    return undefined;
  }
  const pulseCount = countText ? parseInt(countText, 10) : undefined;
  return {
    type: "turbo",
    pulseDuration,
    ...(pulseCount && pulseCount > 0 ? { pulseCount } : {})
  } as CookidooModeInput;
}

export function mapOfficialCookidooToInput(recipe: unknown): CookidooRecipeInput {
  const ingredients = normalizeOfficialIngredients(recipe);
  const steps = normalizeOfficialSteps(recipe);
  const servingSize = getRecord(recipe, "servingSize");
  const servingSizeValue = getNumber(getRecord(servingSize, "quantity"), "value")
    ?? getNumber(servingSize, "value")
    ?? getNumber(getRecord(recipe, "yield"), "value")
    ?? (isRecord(recipe) ? recipe.recipeYield : undefined);
  const recipeYield = isRecord(recipe) ? recipe.recipeYield : undefined;
  const servingUnitText = getString(servingSize, "unitNotation")
    ?? getString(servingSize, "unitText")
    ?? getString(getRecord(recipe, "yield"), "unitText")
    ?? (typeof recipeYield === "string" ? recipeYield.replace(/^\d+\s*/, "") : undefined)
    ?? "Stück";

  const parsedIngredients = ingredients.map((ingText: string, idx: number) => ({
    id: `ing-${idx}`,
    text: cleanHtmlText(ingText)
  }));

  const parsedSteps = steps.map((stepObj): CookidooStepInput => {
    const stepText = cleanHtmlText(typeof stepObj === "string" ? stepObj : getString(stepObj, "formattedText") ?? getString(stepObj, "text") ?? "");
    const ingredientAnnotations: CookidooIngredientAnnotation[] = [];
    const modeAnnotations: CookidooModeAnnotation[] = [];
    const intervals: [number, number][] = [];

    const hasOverlap = (start: number, end: number) => {
      for (const [s, e] of intervals) {
        if (start < e && end > s) return true;
      }
      return false;
    };

    const modePatterns = [
      {
        pattern: /\bTurbo\s*\/\s*(\d+(?:[.,]\d+)?)\s*Sek\.?(?:\s*\/\s*(\d+)\s*(?:x|Mal))?/gi,
        parser: (_match: string, p1: string, p2: string) => turboModeFromText(p1, p2)
      },
      {
        pattern: /\b(?:(\d+)\s*(?:x|Mal)\s*)?(\d+(?:[.,]\d+)?)\s*Sek\.?\s*\/\s*Turbo\b/gi,
        parser: (_match: string, p1: string, p2: string) => turboModeFromText(p2, p1)
      },
      {
        pattern: /\b(\d+)\s*(?:Sek\.|Min\.)\/(?:\d+°C\/|Varoma\/)?(?:Linkslauf\/|Rechtslauf\/)?Stufe\s*(\d+(?:\.\d+)?)/gi,
        parser: (match: string, p1: string, p2: string) => {
          const isVaroma = match.toLowerCase().includes("varoma");
          const durationSec = match.toLowerCase().includes("min") ? parseInt(p1, 10) * 60 : parseInt(p1, 10);
          if (isVaroma) {
            return { type: "steaming" as const, time: durationSec, speed: p2 } as CookidooModeInput;
          }
          const speedNum = parseFloat(p2);
          if (speedNum >= 6) {
            return { type: "blend" as const, time: durationSec, speed: p2 } as CookidooModeInput;
          }
          return { type: "cook" as const, time: durationSec, temperature: 100, speed: p2 } as CookidooModeInput;
        }
      },
      {
        pattern: /Teig\s*[\uE000-\uE002]\/(\d+)\s*(?:Sek\.|Min\.)/gi,
        parser: (match: string, p1: string) => {
          const durationSec = match.toLowerCase().includes("min") ? parseInt(p1, 10) * 60 : parseInt(p1, 10);
          return { type: "dough" as const, time: durationSec };
        }
      }
    ];

    modePatterns.forEach(({ pattern, parser }) => {
      const matches = Array.from(stepText.matchAll(pattern));
      for (const match of matches) {
        if (match.index === undefined) continue;
        const start = match.index;
        const end = start + match[0].length;
        if (!hasOverlap(start, end)) {
          const mappedMode = parser(match[0], match[1], match[2] || "");
          if (mappedMode) {
            modeAnnotations.push({
              matchedSubstring: match[0],
              mode: mappedMode
            });
            intervals.push([start, end]);
          }
        }
      }
    });

    const candidateIngredients: { word: string; ingId: string }[] = [];
    parsedIngredients.forEach((ing: { id: string; text: string }) => {
      const cleanIng = ing.text
        .replace(/^\d+(?:\s*[\d/½¼¾+&;-]+)*\s*(?:g|kg|ml|TL|EL|Prise|Prisen|Würfel|Stück|portions?|g\.?|kg\.?|ml\.?)\s+/i, "")
        .trim();

      const words = cleanIng.split(/[\s,.-]+/);
      words.forEach((word: string) => {
        const trimmed = word.trim();
        if (trimmed.length > 3) {
          candidateIngredients.push({ word: trimmed, ingId: ing.id });
        }
      });
    });

    candidateIngredients.sort((a, b) => b.word.length - a.word.length);

    candidateIngredients.forEach(({ word, ingId }) => {
      const escaped = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
      const regex = new RegExp(`\\b(${escaped}\\w*)\\b`, "gi");
      const matches = Array.from(stepText.matchAll(regex));
      for (const match of matches) {
        if (match.index === undefined) continue;
        const start = match.index;
        const end = start + match[0].length;
        if (!hasOverlap(start, end)) {
          ingredientAnnotations.push({
            matchedSubstring: match[1],
            ingredientId: ingId
          });
          intervals.push([start, end]);
        }
      }
    });

    return {
      text: stepText,
      ingredientAnnotations,
      modeAnnotations
    };
  });

  return {
    title: getString(recipe, "name") ?? "Cookidoo Recipe",
    prepTime: getString(recipe, "prepTime") ? parseIsoDuration(getString(recipe, "prepTime") ?? "") : 0,
    totalTime: getString(recipe, "totalTime") ? parseIsoDuration(getString(recipe, "totalTime") ?? "") : 0,
    servingSize: typeof servingSizeValue === "number" ? servingSizeValue : parseInt(String(servingSizeValue ?? ""), 10) || 1,
    servingUnitText,
    ingredients: parsedIngredients,
    steps: parsedSteps,
    hints: "",
    settings: { locale: "de-DE" }
  };
}

function normalizeOfficialIngredients(recipe: unknown): string[] {
  const recipeIngredients = getArray(recipe, "recipeIngredient");
  if (recipeIngredients.length) {
    return recipeIngredients.filter((ingredient): ingredient is string => typeof ingredient === "string");
  }
  const groups = getArray(recipe, "recipeIngredientGroups");
  return groups.flatMap((group) =>
    getArray(group, "recipeIngredients").map((ingredient) =>
      [getNumber(getRecord(ingredient, "quantity"), "value"), getString(ingredient, "unitNotation"), getString(ingredient, "ingredientNotation"), getString(ingredient, "preparation")]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+,/g, ",")
    )
  );
}

function normalizeOfficialSteps(recipe: unknown): unknown[] {
  const instructions = getArray(recipe, "recipeInstructions");
  if (instructions.length) return instructions;
  return getArray(recipe, "recipeStepGroups").flatMap((group) => getArray(group, "recipeSteps"));
}

export function mapCustomCookidooToInput(recipe: unknown): CookidooRecipeInput {
  const content = getRecord(recipe, "recipeContent") ?? {};
  const ingredients = getArray(content, "ingredients").map((ing, idx) => ({
    id: `ing-${idx}`,
    text: getString(ing, "text") ?? ""
  }));

  return {
    title: getString(content, "name") ?? "Custom Recipe",
    prepTime: Math.round((getNumber(content, "prepTime") ?? 0) / 60),
    totalTime: Math.round((getNumber(content, "totalTime") ?? 0) / 60),
    servingSize: getNumber(getRecord(content, "yield"), "value") ?? 1,
    servingUnitText: getString(getRecord(content, "yield"), "unitText") ?? "Portionen",
    ingredients,
    steps: getArray(content, "instructions").map((step): CookidooStepInput => {
      const stepText = getString(step, "text") ?? "";
      const ingredientAnnotations: CookidooIngredientAnnotation[] = [];
      const modeAnnotations: CookidooModeAnnotation[] = [];

      const sourceIngredients = getArray(content, "ingredients");
      for (const ann of getArray(step, "annotations")) {
          const position = getRecord(ann, "position");
          const offset = getNumber(position, "offset") ?? 0;
          const length = getNumber(position, "length") ?? 0;
          const matchedSubstring = stepText.slice(offset, offset + length);
          if (getString(ann, "type") === "INGREDIENT") {
            const description = getRecord(getRecord(ann, "data"), "description");
            const rawDescription = isRecord(getRecord(ann, "data")) ? getRecord(ann, "data")?.description : undefined;
            const ingText = typeof rawDescription === "string"
              ? rawDescription
              : getString(description, "text") ?? "";
            const ingIdx = sourceIngredients.findIndex((ing) => (getString(ing, "text") ?? "").toLowerCase().includes(ingText.toLowerCase()));
            const ingredientId = ingIdx !== -1 ? `ing-${ingIdx}` : `ing-0`;
            ingredientAnnotations.push({
              matchedSubstring,
              ingredientId
            });
          } else if (getString(ann, "type") === "MODE") {
            const modeName = getString(ann, "name");
            const modeData = getRecord(ann, "data") ?? {};
            let mappedMode: CookidooModeInput | null = null;
            if (modeName === "dough") {
              mappedMode = { type: "dough", time: getNumber(modeData, "time") ?? 60 } as CookidooModeInput;
            } else if (modeName === "blend") {
              mappedMode = { type: "blend", time: getNumber(modeData, "time") ?? 30, speed: getString(modeData, "speed") ?? "7" } as CookidooModeInput;
            } else if (modeName === "turbo") {
              mappedMode = { type: "turbo", pulseDuration: getNumber(modeData, "time") ?? getNumber(modeData, "pulseDuration") ?? 2, pulseCount: getNumber(modeData, "pulseCount") } as CookidooModeInput;
            } else if (modeName === "warm_up" || modeName === "warmUp") {
              mappedMode = { type: "warmUp", temperature: Number(getString(getRecord(modeData, "temperature"), "value") ?? 37), speed: getString(modeData, "speed") ?? "1" } as CookidooModeInput;
            } else if (modeName === "cook") {
              mappedMode = { type: "cook", time: getNumber(modeData, "time") ?? 60, temperature: Number(getString(getRecord(modeData, "temperature"), "value") ?? 100), speed: getString(modeData, "speed") ?? "1" } as CookidooModeInput;
            } else if (modeName === "rice_cooker" || modeName === "riceCooker") {
              mappedMode = { type: "riceCooker" } as CookidooModeInput;
            } else if (modeName === "steaming") {
              mappedMode = { type: "steaming", time: getNumber(modeData, "time") ?? 60, speed: getString(modeData, "speed") ?? "1", accessory: getString(modeData, "accessory") ?? "Varoma" } as CookidooModeInput;
            } else if (modeName === "browning") {
              mappedMode = { type: "browning", time: getNumber(modeData, "time") ?? 60, temperature: Number(getString(getRecord(modeData, "temperature"), "value") ?? 140) } as CookidooModeInput;
            }
            if (mappedMode) {
              modeAnnotations.push({
                matchedSubstring,
                mode: mappedMode
              });
            }
          }
      }
      return {
        text: stepText,
        ingredientAnnotations,
        modeAnnotations
      };
    }),
    hints: formatCookidooHints(isRecord(content) ? content.hints : undefined),
    settings: { locale: "de-DE" }
  };
}

function formatCookidooHints(hints: unknown): string {
  if (typeof hints === "string") return hints;
  if (!Array.isArray(hints)) return "";
  return hints
    .map((hint) => {
      if (typeof hint === "string") return hint;
      if (hint && typeof hint === "object") {
        const content = getString(hint, "content") ?? getString(hint, "text");
        return content ? cleanHtmlText(content) : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
