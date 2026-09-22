import OpenAI from "openai";
import type { RetrievedRecipePage } from "../retriever/types.js";
import type { RecipeInput } from "../recipes/schema.js";
import { applyCookidooSpeedRamps } from "../recipes/cookidoo-speed-ramp.js";
import { validateCookidooScaleSteps } from "../recipes/cookidoo-scale-fidelity.js";
import type { RecipeGenerationOptions, RecipeGenerator } from "./types.js";
import { makeOpenAIStrictSchema } from "./schema-format.js";
import { detectRecipeSource } from "../sources/index.js";
import { getArray, getRecord, getString } from "../utils/unknown.js";
import type { ReasoningEffort } from "./types.js";

type GenerationDefaults = Required<Omit<RecipeGenerationOptions, "adapter">> & Pick<RecipeGenerationOptions, "adapter">;

export interface OpenAIRecipeGeneratorOptions extends RecipeGenerationOptions {
  client?: OpenAI;
  adapter: NonNullable<RecipeGenerationOptions["adapter"]>;
}

export class OpenAIRecipeGenerator implements RecipeGenerator {
  private readonly client: OpenAI;
  private readonly defaults: GenerationDefaults;

  constructor(options: OpenAIRecipeGeneratorOptions) {
    this.client = options.client ?? new OpenAI({
      apiKey: process.env.GEMINI_API_KEY,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
    });
    this.defaults = {
      model: options.model ?? process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
      reasoningEffort: options.reasoningEffort ?? parseReasoningEffort(process.env.GEMINI_REASONING_EFFORT ?? process.env.OPENAI_REASONING_EFFORT),
      locale: options.locale ?? "de-DE",
      maxCorrectionAttempts: options.maxCorrectionAttempts ?? 3,
      excludeModes: options.excludeModes ?? [],
      adapter: options.adapter
    };
  }

  async generate(page: RetrievedRecipePage, options: RecipeGenerationOptions = {}): Promise<RecipeInput> {
    const cleanOptions = Object.fromEntries(
      Object.entries(options).filter(([_, v]) => v !== undefined)
    );
    const mergedOptions = { ...this.defaults, ...cleanOptions } as GenerationDefaults;
    if (!mergedOptions.adapter) {
      throw new Error("OpenAIRecipeGenerator requires a device adapter.");
    }
    const finalOptions = mergedOptions as Required<RecipeGenerationOptions>;
    let feedback: { errors: string[]; previous: unknown } | undefined;

    const adapter = finalOptions.adapter;
    const detectedSource = detectRecipeSource(page.finalUrl || page.url);
    const useCookidooFidelityFixes =
      adapter.id === "mc" &&
      detectedSource.type === "cookidoo-official";

    for (let attempt = 0; attempt <= finalOptions.maxCorrectionAttempts; attempt += 1) {
      const output = await this.generateOnce(page, finalOptions, feedback);
      const validation = adapter.validateInput(output);
      const excludedErrors = validateExcludedModes(output, finalOptions.excludeModes);
      const scaleErrors = useCookidooFidelityFixes
        ? validateCookidooScaleSteps(output, page.markdown)
        : [];
      const allErrors = [
        ...validation.errors,
        ...excludedErrors,
        ...scaleErrors
      ];
      if (
        validation.ok &&
        excludedErrors.length === 0 &&
        scaleErrors.length === 0
      ) {
        const normalized =
          adapter.normalizeInput(output) as RecipeInput;

        const finalized = useCookidooFidelityFixes
          ? applyCookidooSpeedRamps(normalized, page.markdown)
          : normalized;

        const finalValidation =
          adapter.validateInput(finalized);

        if (finalValidation.ok) {
          return finalized;
        }

        feedback = {
          errors: finalValidation.errors,
          previous: finalized
        };

        continue;
      }
      feedback = { errors: allErrors, previous: output };
    }

    throw new Error(`OpenAI output failed validation after ${finalOptions.maxCorrectionAttempts} correction attempts:\n${feedback?.errors.join("\n")}`);
  }

  private async generateOnce(
    page: RetrievedRecipePage,
    options: Required<RecipeGenerationOptions>,
    feedback?: { errors: string[]; previous: unknown }
  ): Promise<unknown> {
    const adapter = options.adapter;
    const schema = adapter.getSchema(options);
    const strictSchema = makeOpenAIStrictSchema(schema);
    const fullSchemaText = JSON.stringify(schema, null, 2);
    const correctionText = feedback
      ? [
        "Previous generated JSON failed validation.",
        "Validation errors:",
        feedback.errors.join("\n"),
        "",
        "Previous JSON:",
        JSON.stringify(feedback.previous, null, 2),
        "",
        "Return corrected JSON only."
      ].join("\n")
      : "";

    const detectedSource = detectRecipeSource(page.finalUrl || page.url);
    const sourcePolicy =
      detectedSource.type === "cookidoo-official"
        ? "machine-fidelity"
        : "adapt";

    const response = await this.client.chat.completions.create({
      model: options.model,
      messages: [
        {
          role: "system",
          content: adapter.getPromptInstructions(options.locale, {
              ...options,
              sourcePolicy
            })
        },
        {
          role: "user",
          content: [
            `Source URL: ${page.finalUrl || page.url}`,
            `Detected title: ${page.title}`,
            `Preferred locale: ${options.locale}`,
            "",
            "Full schema with detailed descriptions:",
            fullSchemaText,
            correctionText,
            "",
            "Recipe page as Markdown:",
            page.markdown
          ].filter(Boolean).join("\n")
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: adapter.id === "tm"
            ? "thermomix_cookidoo_recipe"
            : "monsieur_cuisine_smart_recipe",
          strict: true,
          schema: strictSchema
        }
      }
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Gemini bos cevap dondurdu.");
    }

    return JSON.parse(content);
  }
}

/**
 * Checks that none of the recipe steps use a mode that was excluded for this generation run.
 * Returns an array of human-readable error strings suitable for feeding back to the LLM.
 */
function validateExcludedModes(output: unknown, excludeModes: string[] = []): string[] {
  const finalExcludeModes = excludeModes ?? [];
  if (!finalExcludeModes.length || typeof output !== "object" || !output) return [];
  const excluded = new Set(finalExcludeModes);
  const errors: string[] = [];

  // MC structure
  const mcSteps = getArray(getRecord(output, "servingSize"), "steps");
  mcSteps.forEach((step, index) => {
    const modeType = getString(getRecord(step, "mode"), "type");
    if (modeType && excluded.has(modeType)) {
      errors.push(`/servingSize/steps/${index}/mode/type must not be "${modeType}" — this mode requires an accessory the user does not own. Replace it with an alternative mode or type "none".`);
    }
  });

  // TM structure
  const tmSteps = getArray(output, "steps");
  tmSteps.forEach((step, index) => {
    const annotations = getArray(step, "modeAnnotations");
    annotations.forEach((ann, annIdx) => {
      const modeType = getString(getRecord(ann, "mode"), "type");
      if (modeType && excluded.has(modeType)) {
        errors.push(`/steps/${index}/modeAnnotations/${annIdx}/mode/type must not be "${modeType}" — this mode requires an accessory the user does not own. Replace it with an alternative mode.`);
      }
    });
  });

  return errors;
}

function parseReasoningEffort(value: string | undefined): ReasoningEffort {
  return value === "minimal" || value === "low" || value === "medium" || value === "high" ? value : "medium";
}
