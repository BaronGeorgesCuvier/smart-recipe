import { afterEach, describe, expect, it, vi } from "vitest";

import { MonsieurCuisineSmartClient } from "../src/mc/client.js";
import { MonsieurCuisineApiError } from "../src/mc/errors.js";
import { MonsieurCuisineAdapter } from "../src/devices/mc/adapter.js";
import type { RecipeInput } from "../src/recipes/schema.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Monsieur Cuisine client regressions", () => {
  it("reads media arrays nested under data.media", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            media: [
              {
                id: 10660038,
                url: "https://example.test/details.jpeg"
              },
              {
                id: 10660039,
                url: "https://example.test/thumbnail.jpeg"
              }
            ]
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    ) as unknown as typeof fetch;

    const client = new MonsieurCuisineSmartClient({
      cookie: "test-cookie",
      fetch: fetchImpl
    });

    const media = await client.getMedia([10660038, 10660039]);

    expect(media).toEqual([
      {
        id: 10660038,
        url: "https://example.test/details.jpeg"
      },
      {
        id: 10660039,
        url: "https://example.test/thumbnail.jpeg"
      }
    ]);
  });

  it("preserves vendor error code on proxy HTTP errors", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: 40008,
          message: "Invalid category",
          data: null
        }),
        {
          status: 403,
          headers: { "content-type": "application/json" }
        }
      )
    ) as unknown as typeof fetch;

    const client = new MonsieurCuisineSmartClient({
      cookie: "test-cookie",
      fetch: fetchImpl
    });

    await expect(
      client.proxy({
        endpoint: "api/v3/auth/user/recipes/",
        method: "POST"
      })
    ).rejects.toMatchObject({
      name: "MonsieurCuisineApiError",
      status: 403,
      code: 40008
    });
  });
});

describe("Monsieur Cuisine category fallback", () => {
  it("retries once without categories when backend returns 40008", async () => {
    const recipeInput: RecipeInput = {
      title: "Regression test soup",
      description: "Test recipe.",
      settings: {
        locale: "en-US",
        complexityId: 22
      },
      status: "draft",
      categoryIds: [228, 588],
      nutrients: [
        { name: "calories", unit: "kCal", amount: 100 }
      ],
      servingSize: {
        amount: 2,
        unit: "portions",
        instruction: "",
        preparationTime: 5,
        readyInTime: 10,
        ingredientGroups: [
          {
            name: "Ingredients",
            ingredients: [
              {
                name: "Water",
                amount: 200,
                unit: "g",
                isOptional: false
              }
            ]
          }
        ],
        steps: [
          {
            title: "Add water",
            description: "Add 200 g water.",
            mode: {
              type: "scale",
              grams: 200
            }
          }
        ]
      }
    };

    const createRecipe = vi
      .spyOn(MonsieurCuisineSmartClient.prototype, "createRecipe")
      .mockRejectedValueOnce(
        new MonsieurCuisineApiError("Invalid category", {
          status: 403,
          code: 40008
        })
      )
      .mockResolvedValueOnce({ id: 123456 });

    const adapter = new MonsieurCuisineAdapter();

    const warn = vi.fn();

    const result = await adapter.upload({
      payload: adapter.createPayload(recipeInput),
      recipeInput,
      page: {
        url: "https://example.test/source",
        finalUrl: "https://example.test/source",
        title: "Regression test soup",
        markdown: "# Regression test soup",
        html: "",
        images: []
      },
      locale: "en-US",
      cookie: "test-cookie",
      logger: {
        info: vi.fn(),
        warn,
        error: vi.fn()
      },
      imageProvider: {
        getImage: async () => undefined
      }
    });

    expect(createRecipe).toHaveBeenCalledTimes(2);

    const firstPayload = createRecipe.mock.calls[0][0];
    const secondPayload = createRecipe.mock.calls[1][0];

    expect(firstPayload.categoryIds).toEqual([228, 588]);
    expect(secondPayload.categoryIds).toEqual([]);

    expect(result.payload.categoryIds).toEqual([]);
    expect(result.draft).toEqual({ id: 123456 });
    expect(warn).toHaveBeenCalled();
  });
});
