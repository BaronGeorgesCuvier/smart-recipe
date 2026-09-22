import { Buffer } from "node:buffer";
import Ajv2020Module from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import type { DeviceAdapter, DevicePromptOptions, RecipeUploadLogger } from "../adapter.js";
import type { RetrievedRecipePage } from "../../retriever/types.js";
import { CookidooRecipeInputSchema, type CookidooRecipeInput } from "./schema.js";
import { createCookidooMetaPatch, createCookidooInstructions, getImageDimensions, type CookidooPayload } from "./payload.js";
import { buildCookidooRecipeInstructions } from "./prompts.js";
import { browserLoginForCookidoo, passwordLoginForCookidoo } from "./browser-login.js";
import {
  COOKIDOO_IMAGE_UPLOAD_PRESET,
  CookidooClient,
  CookidooCopyRecipeResponseSchema,
  CookidooCreatedRecipeListSchema,
  CookidooPatchResponseSchema,
  CookidooProfileSchema,
  CookidooRecipePageSchema,
} from "./client.js";
import { RetrievedRecipeImageProvider, type RecipeImageProvider } from "../../pipeline/images.js";
import { extractJsonLd, findRecipeObjects } from "../../retriever/json-ld.js";
import type { SupportedLocale } from "../../catalogs/types.js";
import { formatAjvValidationErrors } from "../../recipes/validation.js";
import { getArray, getNumber, getRecord, getString, isRecord } from "../../utils/unknown.js";
import { CookidooRateLimitError } from "./errors.js";


const ansi = {
  reset: "\x1b[0m\x1b[24m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  cyan: "\x1b[36m",
  brightCyan: "\x1b[96m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightMagenta: "\x1b[95m",
  gray: "\x1b[90m",
};

type CookidooModeInput = NonNullable<CookidooRecipeInput["steps"][number]["modeAnnotations"]>[number]["mode"];

function hasExplicitTemperature(text: string): boolean {
  return /\b\d{2,3}\s*°?\s*C\b/i.test(text) || /\bvaroma\b/i.test(text);
}

function normalizeModeForMatchedText(mode: CookidooModeInput, matchedSubstring: string): CookidooModeInput {
  if (mode.type !== "tts") return mode;

  const normalized = { ...mode };

  // Gemini occasionally fills the optional temperature with the schema minimum
  // (37 C) even when the source operation only specifies time + speed.
  // Never send a temperature unless it is explicitly present in the matched source text.
  if (!hasExplicitTemperature(matchedSubstring)) {
    delete normalized.temperature;
  }

  // Clockwise is Cookidoo's default and does not need to be synthesized.
  if (normalized.direction === "CW") {
    delete normalized.direction;
  }

  return normalized as CookidooModeInput;
}
type CookidooValidator = { (data: unknown): boolean; errors?: ErrorObject[] | null };

const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => {
  compile(schema: unknown): CookidooValidator;
};
const cookidooAjv = new Ajv2020({ allErrors: true, strict: false });
const cookidooRecipeInputValidator = cookidooAjv.compile(CookidooRecipeInputSchema);

export class ThermomixAdapter implements DeviceAdapter<CookidooRecipeInput, CookidooPayload> {
  readonly id = "tm" as const;
  readonly deviceName = "Thermomix" as const;

  getSchema() {
    return CookidooRecipeInputSchema;
  }

  getPromptInstructions(locale: string, options?: DevicePromptOptions) {
    return buildCookidooRecipeInstructions(locale as SupportedLocale, options);
  }

  validateInput(input: unknown) {
    const ok = cookidooRecipeInputValidator(input);
    return ok
      ? { ok, errors: [] }
      : formatAjvValidationErrors(CookidooRecipeInputSchema, input, cookidooRecipeInputValidator.errors);
  }

  normalizeInput(input: CookidooRecipeInput): CookidooRecipeInput {
    return {
      ...input,
      title: (input.title ?? "").trim(),
      ingredients: (input.ingredients ?? []).map((i) => ({
        id: (i.id ?? "").trim(),
        text: (i.text ?? "").trim(),
      })),
      steps: (input.steps ?? []).map((step) => ({
        text: (step.text ?? "").trim(),
        ingredientAnnotations: (step.ingredientAnnotations ?? []).map((ann) => ({
          ...ann,
          matchedSubstring: (ann.matchedSubstring ?? "").trim(),
          ingredientId: (ann.ingredientId ?? "").trim(),
        })),
        modeAnnotations: (step.modeAnnotations ?? []).map((ann) => {
          const matchedSubstring = (ann.matchedSubstring ?? "").trim();
          return {
            ...ann,
            matchedSubstring,
            mode: normalizeModeForMatchedText(ann.mode, matchedSubstring),
          };
        }),
      })),
    } as CookidooRecipeInput;
  }

  formatInputForTerminal(input: CookidooRecipeInput): string {
    const parts: string[] = [];
    parts.push("");
    parts.push(`  ${ansi.gray}┌${"─".repeat(input.title.length + 4)}┐${ansi.reset}`);
    parts.push(`  ${ansi.gray}│  ${ansi.reset}${ansi.bold}${ansi.brightMagenta}${input.title}${ansi.reset}${ansi.gray}  │${ansi.reset}`);
    parts.push(`  ${ansi.gray}└${"─".repeat(input.title.length + 4)}┘${ansi.reset}`);
    parts.push("");

    const metrics = [
      `👥 ${ansi.bold}${input.servingSize} ${input.servingUnitText}${ansi.reset}`,
      `🕒 Prep: ${ansi.bold}${input.prepTime} Min.${ansi.reset}`,
      `🏁 Total: ${ansi.bold}${input.totalTime} Min.${ansi.reset}`,
    ];
    parts.push("  " + metrics.join("   "));
    parts.push("");

    parts.push(`  ${ansi.bold}${ansi.underline}Ingredients:${ansi.reset}`);
    parts.push("");
    for (const ing of input.ingredients) {
      parts.push(`    • ${ing.text}`);
    }
    parts.push("");

    parts.push(`  ${ansi.bold}${ansi.underline}Steps:${ansi.reset}`);
    parts.push("");
    input.steps.forEach((step, idx) => {
      interface ResolvedAnnotation {
        type: "INGREDIENT" | "MODE";
        offset: number;
        length: number;
        matchedSubstring: string;
        data: string | CookidooModeInput;
      }

      const searchOffsets: Record<string, number> = {};
      const resolved: ResolvedAnnotation[] = [];

      if (step.ingredientAnnotations) {
        for (const ann of step.ingredientAnnotations) {
          const term = ann.matchedSubstring;
          const startFrom = searchOffsets[term] ?? 0;
          const offset = step.text.indexOf(term, startFrom);
          if (offset !== -1) {
            const ingObj = input.ingredients.find(i => i.id === ann.ingredientId);
            resolved.push({
              type: "INGREDIENT",
              offset,
              length: term.length,
              matchedSubstring: term,
              data: ingObj ? ingObj.text : "",
            });
            searchOffsets[term] = offset + term.length;
          }
        }
      }

      if (step.modeAnnotations) {
        for (const ann of step.modeAnnotations) {
          const term = ann.matchedSubstring;
          const startFrom = searchOffsets[term] ?? 0;
          const offset = step.text.indexOf(term, startFrom);
          if (offset !== -1) {
            resolved.push({
              type: "MODE",
              offset,
              length: term.length,
              matchedSubstring: term,
              data: ann.mode,
            });
            searchOffsets[term] = offset + term.length;
          }
        }
      }

      resolved.sort((a, b) => a.offset - b.offset);

      let inlineText = "";
      let lastIndex = 0;

      for (const ann of resolved) {
        if (ann.offset > lastIndex) {
          inlineText += step.text.slice(lastIndex, ann.offset);
        }

        const annText = step.text.slice(ann.offset, ann.offset + ann.length);
        if (ann.type === "INGREDIENT") {
          inlineText += `${ansi.bold}${annText}${ansi.reset}`;
          if (ann.data) {
            inlineText += `${ansi.gray} ["${ann.data}"]${ansi.reset}`;
          }
        } else if (ann.type === "MODE") {
          inlineText += `${ansi.brightYellow}${ansi.bold}${annText}${ansi.reset}`;
        }

        lastIndex = ann.offset + ann.length;
      }

      if (lastIndex < step.text.length) {
        inlineText += step.text.slice(lastIndex);
      }

      parts.push(`    ${ansi.bold}${ansi.brightGreen}${idx + 1}.${ansi.reset} ${inlineText}`);

      // Print mode details on a separate line below the step
      for (const ann of resolved) {
        if (ann.type === "MODE") {
          const m = ann.data as CookidooModeInput;
          const params: string[] = [];
          if (m.type === "dough") {
            params.push(`${m.time}s`);
          } else if (m.type === "blend") {
            if (m.time) params.push(`${m.time}s`);
            params.push(`Speed ${m.speed}`);
          } else if (m.type === "turbo") {
            params.push(`${m.pulseDuration}s/pulse`);
            if (m.pulseCount) params.push(`${m.pulseCount}x`);
          } else if (m.type === "warmUp") {
            params.push(`${m.temperature}°C`);
            params.push(`Speed ${m.speed}`);
          } else if (m.type === "tts" || m.type === "cook") {
            params.push(`${m.time}s`);
            if (m.temperature !== undefined) params.push(`${m.temperature}°C`);
            params.push(`Speed ${m.speed}`);
            if (m.direction) params.push(m.direction);
          } else if (m.type === "steaming") {
            params.push(`${m.time}s`);
            params.push(`Speed ${m.speed}`);
            if (m.direction) params.push(m.direction);
            if (m.accessory) params.push(m.accessory);
          } else if (m.type === "browning") {
            params.push(`${m.time}s`);
            params.push(`${m.temperature}°C`);
            if (m.power) params.push(m.power);
          }
          const modeLabel = m.type === "tts" || m.type === "cook" ? "TTS" : `Mode: ${m.type}`;
          parts.push(`      ${ansi.bold}${ansi.brightYellow}[${modeLabel} | "${ann.matchedSubstring}"${params.length > 0 ? " | " + params.join(", ") : ""}]${ansi.reset}`);
        }
      }

    });
    parts.push("");

    return parts.join("\n");
  }

  async browserLogin(options: {
    locale?: string;
    userDataDir?: string;
    timeoutMs?: number;
    headless?: boolean;
    keepOpen?: boolean;
    installBrowsers?: boolean;
    browserChannel?: string;
    browserPath?: string;
    browserSandbox?: boolean;
    credentials?: { email: string; password?: string };
    onStatus?: (message: string) => void;
  }) {
    const result = await browserLoginForCookidoo({
      locale: options.locale,
      userDataDir: options.userDataDir,
      timeoutMs: options.timeoutMs,
      headless: options.headless,
      keepOpen: options.keepOpen,
      installBrowsers: options.installBrowsers,
      browserChannel: options.browserChannel,
      browserPath: options.browserPath,
      browserSandbox: options.browserSandbox,
      credentials: options.credentials,
      onStatus: options.onStatus,
    });
    return {
      cookie: result.cookie,
      source: result.source,
      cookieNames: result.cookieNames,
    };
  }

  async passwordLogin(options: {
    locale?: string;
    credentials: { email: string; password: string };
  }) {
    const result = await passwordLoginForCookidoo({
      locale: options.locale,
      credentials: options.credentials,
    });
    return {
      cookie: result.cookie,
      source: result.source,
      cookieNames: result.cookieNames,
    };
  }

  async getCurrentUser(cookie: string) {
    const client = new CookidooClient({ cookie, locale: "de-DE" });
    return client.request<unknown>({
      method: "GET",
      path: "/community/profile",
      accept: "application/json",
      responseSchema: CookidooProfileSchema,
    });
  }

  async listDrafts(options: { cookie: string; page?: number; size?: number }) {
    const locale = (process.env.TM_LOCALE ?? "de-DE") as string;
    const client = new CookidooClient({ cookie: options.cookie, locale });
    const res = await client.request<unknown>({
      method: "GET",
      path: `/created-recipes/${client.language}`,
      responseSchema: CookidooCreatedRecipeListSchema,
    });
    const candidateRecipes = Array.isArray(res) ? res : getArray(res, "items").length > 0 ? getArray(res, "items") : getArray(res, "data");
    const allRecipes = Array.isArray(candidateRecipes) ? candidateRecipes : [];
    const size = options.size && options.size > 0 ? options.size : allRecipes.length;
    const page = options.page && options.page > 0 ? options.page : 1;
    const start = (page - 1) * size;
    const recipes = allRecipes.slice(start, start + size);
    return {
      data: {
        recipes: recipes.map((recipe) => {
          const content = getRecord(recipe, "recipeContent");
          const recipeId = getString(recipe, "recipeId");
          const ingredients = getArray(content, "ingredients");
          const recipeIngredients = getArray(content, "recipeIngredient");
          const instructions = getArray(content, "instructions");
          const recipeInstructions = getArray(content, "recipeInstructions");
          return {
            id: recipeId,
            title: getString(content, "name") ?? getString(recipe, "name") ?? "",
            status: getString(recipe, "workStatus") ?? getString(recipe, "status") ?? "ACTIVE",
            updatedAt: getString(recipe, "modifiedAt") ?? getString(recipe, "createdAt"),
            deviceTypes: getArray(content, "tools").length > 0 ? getArray(content, "tools") : getArray(content, "tool").length > 0 ? getArray(content, "tool") : ["Thermomix"],
            ingredientCount: ingredients.length || recipeIngredients.length || undefined,
            stepCount: instructions.length || recipeInstructions.length || undefined,
            hasImage: Boolean(getString(content, "image") || getArray(content, "descriptiveAssets").length),
            hasHints: Boolean(isRecord(content) ? content.hints : undefined),
            recipeUrl: recipeId
              ? `https://${client.domain}/created-recipes/${client.language}/${encodeURIComponent(recipeId)}`
              : undefined,
          };
        }),
        total: allRecipes.length,
        totalPage: size > 0 ? Math.max(1, Math.ceil(allRecipes.length / size)) : 1,
      },
    };
  }

  async getRecipe(options: { cookie: string; id: string; public?: boolean }) {
    const locale = (process.env.TM_LOCALE ?? "de-DE") as string;
    const client = new CookidooClient({ cookie: options.cookie, locale });
    
    const isOfficial = /^r\d+$/.test(options.id);
    const path = isOfficial
      ? `/recipes/recipe/${client.language}/${encodeURIComponent(options.id)}`
      : options.public
        ? `/created-recipes/public/recipes/${client.language}/${encodeURIComponent(options.id)}`
        : `/created-recipes/${client.language}/${encodeURIComponent(options.id)}`;

    const result = await client.request<unknown>({ method: "GET", path, responseSchema: CookidooRecipePageSchema });
    
    if (isOfficial && typeof result === "string") {
      const jsonLd = extractJsonLd(result);
      const recipes = findRecipeObjects(jsonLd);
      if (recipes.length > 0) {
        return recipes[0];
      }
    }
    
    return result;
  }

  createPayload(input: CookidooRecipeInput): CookidooPayload {
    // TM payload is created via meta and instruction patches. We return the patches.
    return {
      meta: createCookidooMetaPatch(input),
      instructions: createCookidooInstructions(input),
    };
  }

  async upload(options: {
    payload: CookidooPayload;
    recipeInput: CookidooRecipeInput;
    page: RetrievedRecipePage;
    locale: string;
    cookie: string;
    logger: RecipeUploadLogger;
    imageProvider?: RecipeImageProvider<CookidooRecipeInput>;
  }) {
    const logger = options.logger;
    const client = new CookidooClient({
      cookie: options.cookie,
      locale: options.locale,
    });

    const imageProvider = options.imageProvider ?? new RetrievedRecipeImageProvider();
    const recipeImage = await imageProvider.getImage(options.page, options.recipeInput);

    let uploadedImage: { public_id: string; format: string } | undefined;
    if (recipeImage) {
      logger.info({ imageSource: recipeImage.source, imageUrl: recipeImage.sourceUrl }, "uploading recipe image to Cookidoo via Cloudinary");
      try {
        const imageBuffer = Buffer.from(recipeImage.bytes);
        const dims = getImageDimensions(imageBuffer) ?? { width: 600, height: 600 };
        
        let x = 0;
        let y = 0;
        let w = dims.width;
        let h = dims.height;
        if (dims.width > dims.height) {
          x = Math.floor((dims.width - dims.height) / 2);
          w = dims.height;
          h = dims.height;
        } else if (dims.height > dims.width) {
          y = Math.floor((dims.height - dims.width) / 2);
          w = dims.width;
          h = dims.width;
        }
        const customCoordinates = `${x},${y},${w},${h}`;

        const timestamp = Math.floor(Date.now() / 1000);
        
        logger.info({ dims, customCoordinates }, "requesting Cookidoo upload signature");
        const { signature } = await client.requestImageSignature({
          timestamp,
          source: "uw",
          customCoordinates,
          uploadPreset: COOKIDOO_IMAGE_UPLOAD_PRESET,
        });

        logger.info({ signature }, "uploading to Cloudinary");
        const cloudinaryRes = await client.uploadImageToCloudinary({
          fileBytes: recipeImage.bytes,
          mimeType: recipeImage.contentType,
          timestamp,
          signature,
          source: "uw",
          customCoordinates,
        });

        uploadedImage = {
          public_id: cloudinaryRes.public_id,
          format: cloudinaryRes.format,
        };
        logger.info({ uploadedImage }, "successfully uploaded image to Cloudinary");
      } catch (err) {
        logger.error(err, "failed to upload recipe image; proceeding without image");
      }
    }

    let draft: unknown;

    // Prefer Cookidoo's blank custom-recipe creation endpoint. This avoids the
    // import/copy rate limit entirely and does not depend on a public dummy recipe.
    try {
      logger.info({ title: options.recipeInput.title }, "creating blank Cookidoo recipe");
      draft = await client.request<unknown>({
        method: "POST",
        path: `/created-recipes/${client.language}`,
        responseSchema: CookidooCopyRecipeResponseSchema,
        accept: "application/json",
        body: {
          recipeName: options.recipeInput.title,
        },
      });
    } catch (createError: unknown) {
      // Older Cookidoo deployments may not support blank creation. Preserve
      // the previous copy-from-public flow as a compatibility fallback.
      logger.warn(
        { error: createError },
        "blank Cookidoo recipe creation failed; falling back to public copy"
      );

      const delays = [30_000, 60_000, 90_000, 120_000];
      let attempt = 0;
      const publicUrl = `https://${client.domain}/created-recipes/public/recipes/${client.language}/01KB04WSJP4SHNBKJK4H4FT0PZ`;

      for (;;) {
        try {
          logger.info({ publicUrl, attempt }, "copying public dummy recipe to Cookidoo");
          draft = await client.request<unknown>({
            method: "POST",
            path: `/created-recipes/${client.language}`,
            responseSchema: CookidooCopyRecipeResponseSchema,
            body: {
              recipeUrl: publicUrl,
              servingSize: 1,
            },
          });
          break;
        } catch (err: unknown) {
          const errorRecord = isRecord(err) ? err : undefined;
          const body = getRecord(errorRecord, "body");
          const isRateLimit =
            err instanceof CookidooRateLimitError ||
            getString(errorRecord, "name") === "CookidooRateLimitError" ||
            getNumber(errorRecord, "status") === 429 ||
            getString(body, "code") === "importFailed";

          if (!isRateLimit || attempt >= delays.length) {
            throw err;
          }

          const delayMs = Math.max(getNumber(errorRecord, "retryAfterMs") ?? 0, delays[attempt]);
          logger.warn(
            { attempt: attempt + 1, delayMs },
            `rate limited by Cookidoo copy API. Retrying after delay...`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          attempt += 1;
        }
      }
    }

    const recipeId = extractCreatedRecipeId(draft);
    if (!recipeId) {
      logger.error({ draft }, "Cookidoo copy response did not include a recipe ID");
      throw new Error("Failed to copy public recipe draft. No recipe ID returned.");
    }

    const metaPatch = createCookidooMetaPatch(options.recipeInput);
    if (uploadedImage) {
      metaPatch.image = `${uploadedImage.public_id}.${uploadedImage.format}`;
      metaPatch.isImageOwnedByUser = false;
    }
    const instructions = createCookidooInstructions(options.recipeInput);

    logger.info({ recipeId, title: metaPatch.name }, "patching Cookidoo recipe metadata");
    await client.request<unknown>({
      method: "PATCH",
      path: `/created-recipes/${client.language}/${encodeURIComponent(recipeId)}`,
      responseSchema: CookidooPatchResponseSchema,
      body: metaPatch,
    });

    logger.info({ recipeId }, "patching Cookidoo recipe instructions");
    await client.request<unknown>({
      method: "PATCH",
      path: `/created-recipes/${client.language}/${encodeURIComponent(recipeId)}`,
      responseSchema: CookidooPatchResponseSchema,
      body: { instructions },
    });

    const recipeUrl = `https://${client.domain}/created-recipes/${client.language}/${recipeId}`;

    return {
      uploadedImage,
      recipeImage: recipeImage ? { ...recipeImage, bytes: recipeImage.bytes.byteLength } : undefined,
      draft: {
        id: recipeId,
        title: metaPatch.name,
        status: "draft",
        recipeId,
      },
      recipeUrl,
      payload: {
        meta: metaPatch,
        instructions,
      },
    };
  }
}

function extractCreatedRecipeId(response: unknown): string | undefined {
  const recipe = getRecord(response, "recipe");
  const data = getRecord(response, "data");
  const dataRecipe = getRecord(data, "recipe");
  const createdRecipe = getRecord(response, "createdRecipe");
  const candidates = [
    getString(response, "recipeId"),
    getString(response, "id"),
    getString(recipe, "recipeId"),
    getString(recipe, "id"),
    getString(data, "recipeId"),
    getString(data, "id"),
    getString(dataRecipe, "recipeId"),
    getString(dataRecipe, "id"),
    getString(createdRecipe, "recipeId"),
    getString(createdRecipe, "id"),
  ];
  const value = candidates.find((candidate): candidate is string => Boolean(candidate?.trim()));
  return value?.trim();
}
