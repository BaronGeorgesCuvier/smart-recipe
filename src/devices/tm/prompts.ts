import { getLocalePromptGuidance } from "../../llm/locale-guidance.js";
import type { SupportedLocale } from "../../catalogs/types.js";

export function buildCookidooRecipeInstructions(
  locale: SupportedLocale = "de-DE",
  options: {
    excludeModes?: string[];
    version?: "TM5" | "TM6" | "TM7";
    tmVersion?: "tm5" | "tm6" | "tm7";
  } = {}
): string {
  const localeGuidance = getLocalePromptGuidance(locale);
  const rawVersion = options.version ?? options.tmVersion ?? process.env.TM_VERSION ?? "TM6";
  const version = (rawVersion.toUpperCase() === "TM5" ? "TM5" : rawVersion.toUpperCase() === "TM7" ? "TM7" : "TM6") as "TM5" | "TM6" | "TM7";
  const excludeModes = options.excludeModes ?? [];

  const instructions = [
    "Convert recipe page content into the provided Thermomix Cookidoo recipe input JSON.",
    "",
    `Target: Thermomix (${version}).`,
    version === "TM5"
      ? "IMPORTANT: Target device is TM5. TM5 does NOT support 'browning' or 'sousVide' modes. Do NOT generate browning or sousVide annotations under any circumstances."
      : version === "TM7"
      ? "Target device is TM7, which supports all guided modes including browning, steaming, cook, dough, blend, turbo, warmUp, and riceCooker (inheriting all TM6 modes)."
      : "Target device is TM6, which supports all guided modes including browning, steaming, cook, dough, blend, turbo, warmUp, and riceCooker.",
    "",
    excludeModes.length > 0
      ? `IMPORTANT: The following modes are excluded by user preference: ${excludeModes.join(", ")}. Do NOT use them.`
      : "",
    "",
    "Adapt only what is necessary to make the recipe executable on Thermomix. Preserve source ingredient quantities, preparation qualifiers, step intent, time, temperature, speed, direction, and order unless a device constraint requires a change.",
    "SOURCE AUTHORITY: Treat only the recipe author's ingredient list, method/instructions, yield, timing, and explicit notes as authoritative recipe content. Ignore reviews, user comments, ratings, testimonials, 'tried it' notes, related-recipe text, advertising, navigation, and social-media boilerplate even when they appear inside the retrieved Markdown.",
    "INGREDIENT IDENTITY FIDELITY: Preserve the ingredient identity exactly at the level stated by the source. Do NOT add varieties, examples, brands, botanical types, starch types, fat percentages, cuts, ripeness, preparation qualifiers, substitutions, or alternatives that the source does not state. Example: source 'rice' must remain simply rice; do not invent 'short-grain', 'Baldo', or 'Osmancık'. Source 'starch' must remain simply starch; do not invent 'cornstarch' or 'wheat starch'.",
    "Do NOT invent optional garnishes, serving suggestions, substitutions, flavor additions, or hints that are absent from the authoritative source. If the source has no hints or serving suggestions, set hints to an empty string.",
    "",
    "STRICT CAPACITY LIMIT: The mixing bowl holds a maximum of 2.2 liters (approx. 2200 g). You MUST calculate the cumulative weight and volume of all ingredients currently in the bowl at every step. If the recipe would exceed this limit, choose ONE uniform scale factor less than 1.0 before generating the ingredient list and apply that exact factor to every scalable source ingredient from the beginning.",
    "UNIFORM SCALING RULE: Never scale different quantified ingredients by different factors. Scale in the SOURCE UNIT first, then translate/convert units only after scaling. Example for factor 0.75: 1 L -> 0.75 L, 2 tbsp -> 1.5 tbsp, 1 cup -> 0.75 cup, 1.5 cups -> 1.125 cups. Any later conversion to grams or milliliters must represent that same scaled source amount; do not round one ingredient using a different effective factor.",
    "SCALING EXCEPTIONS: Do not scale quantities that are inherently 'to taste', 'as needed', or unquantified garnish/finishing amounts. Optional quantified ingredients should still use the same scale factor if retained.",
    "SCALING VERIFICATION: Before returning JSON, compare every quantified output ingredient against the source and verify that either (a) it is unchanged because no scaling was needed, or (b) it equals the source amount multiplied by the single chosen scale factor. If this check fails, correct the ingredient list before returning.",
    "HOT FOAMING LIQUID HEADROOM: For recipes that contain substantial milk, cream, starch-thickened liquid, or another mixture likely to foam or expand and that are heated above 90°C or intentionally brought to a boil, do not scale merely to the absolute 2.2 L bowl maximum. Use a more conservative working target of at most about 2.0 L total bowl contents at the hottest/fullest step, applying the same single uniform scale factor to the whole recipe.",
    "BOILING SEMANTICS: If the source explicitly says 'boil', 'bring to a boil', 'boil for N minutes', or an equivalent outcome such as 'two boils', do not describe a sub-boiling 90–95°C Thermomix step as boiling. Either choose an executable setting consistent with reaching the stated boiling outcome while respecting the safety/capacity rules, or use honest wording such as 'heat/cook' when intentionally adapting below boiling. Never silently claim that 90°C or 95°C equals boiling.",
    "",
    "DOUGH LIMIT: The motor cannot knead heavy doughs above 800 g of flour (approx. 1300 g total dough weight). If the source recipe exceeds this, you MUST scale it down.",
    "",
    `Use ${localeGuidance.outputLanguage} for every user-facing recipe field and set settings.locale to ${localeGuidance.locale}. Translate where necessary.`,
    "TARGET-LANGUAGE CONSISTENCY: Every word in title, ingredients, step text, hints, and visible machine-setting phrases must use the target language. Do not leak German Cookidoo terms such as 'Linkslauf', 'Rechtslauf', 'Stufe', 'Sek.', or 'Min.' into non-German output. For English, use terms such as 'Reverse', 'Speed', 'sec', and 'min'.",
    "ACCESSORY FIDELITY: Do not invent measuring-cup removal, basket placement, lid-opening instructions, spatula use, or other accessory handling unless it is explicitly present in the source or technically required to execute a selected Thermomix mode safely. Ordinary TTS heating/mixing does not by itself justify adding 'without measuring cup'.",
    `Convert units to ${localeGuidance.unitConvention}`,
    "UNIT-CONVERSION FIDELITY: Never invent an ingredient-specific mass/volume equivalence that is not stated by the source or supplied by a deterministic conversion rule. In particular, do not append guessed gram values to cups, tea glasses, tablespoons, or similar volume measures for dry ingredients. If a reliable conversion is unavailable, preserve the scaled source measure in translated form rather than hallucinating an approximate weight.",
    "",
    "STEP FORMAT — TEXT & ANNOTATIONS:",
    "Each step is a structured object containing:",
    "  - text: The full natural text of the step instructions (with proper spaces, complete sentences).",
    "  - ingredientAnnotations: (optional) array of objects linking substrings to ingredients:",
    "    - matchedSubstring: the exact substring from the step text that names the ingredient.",
    "    - ingredientId: the string identifier of the ingredient (e.g. 'koriander', 'zwiebel').",
    "  - modeAnnotations: (optional) array of objects linking substrings to guided mode settings:",
    "    - matchedSubstring: the exact substring from the step text that represents the guided mode settings.",
    "    - mode: the guided mode object (see below).",
    "",
    "IMPORTANT:",
    "- The step text must be written naturally with spaces. Do NOT omit spaces or concatenate words.",
    "- For ingredientAnnotations, specify every occurrence of an ingredient in the step text.",
    "- For modeAnnotations, specify the exact phrase describing the guided mode (e.g. \"10 Sek./Stufe 7 zerkleinern\", \"Dank Linkslauf 15 Min./Stufe 1 garen\"). Only annotate the guided mode once per operation (do NOT duplicate mode annotations).",
    "",
    "GUIDED MODE RULES & CONSTRAINTS (based on exact Cookidoo editor values):",
    "1. TTS: Generic tappable Time/Temperature/Speed control for ordinary Thermomix runs. Use for source operations such as 5 s/speed 5, 20 s/speed 4, or 15 min/100°C/speed 1. time is required; speed is required; temperature 37–120°C is optional; direction CW/CCW is optional. Prefer TTS whenever the source explicitly gives ordinary time/speed settings that are not a dedicated guided mode.",
    "TTS TEMPERATURE FIDELITY: If the source operation does not explicitly specify a temperature, OMIT the temperature field entirely. Never use 37°C or any other temperature as a placeholder/default.",
    "2. COOK: Backward-compatible heated TTS alias. Temperature 37–120°C, time in seconds, speed soft/1–5, optional direction CW/CCW. Prefer type 'tts' for new output.",
    "3. STEAMING: Varoma cooking. NO temperature field. Time 1–5940s (max 99 min). Speed: soft, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5. Direction: CW or CCW. Accessory: 'Varoma', 'Gareinsatz', or 'both'.",
    "4. BROWNING: TM6/TM7 only. Time 1–1800s (max 30 min). Temperature MUST be one of [140, 145, 150, 155, 160]. Do not set power; Cookidoo My Creations rejects the unconfirmed power field.",
    "5. DOUGH: Time 1–1200s (max 20 min). No speed or temperature.",
    "6. BLEND (Pürieren): HIGH-SPEED ONLY. Speed MUST be one of [6, 6.5, 7, 7.5, 8]. Time 10–300s (min 10s, max 5 min). Use TTS instead for ordinary short/manual speed operations that are not truly puree/blend mode.",
    "7. TURBO: Short maximum-speed pulses. Use 'pulseDuration' (must be exactly 0.5, 1, or 2) and optional 'pulseCount' (1–9).",
    "8. WARM UP (Erwärmen): Temperature must be one of [37, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90] °C. Speed: soft, 1, or 2. No time field.",
    "9. RICE COOKER: No parameters.",
    "",
    "EXAMPLES (ingredients list for these examples: [\"25 g frischer Koriander\", \"2 Knoblauchzehen\", \"1 Zwiebel, halbiert\", \"15 g Ingwer, frisch\", \"20 g Pflanzenöl\", \"1 EL Currypulver\", \"½ TL Chiliflocken\", \"150 g rote Linsen\", \"400 g stückige Tomaten\", \"400 g Kokosmilch\", \"600 g Wasser\"]):",
    JSON.stringify([
      {
        text: "Koriander in den Mixtopf geben, 10 Sek./Stufe 7 zerkleinern und umfüllen.",
        ingredientAnnotations: [
          { matchedSubstring: "Koriander", ingredientId: "koriander" }
        ],
        modeAnnotations: [
          { matchedSubstring: "10 Sek./Stufe 7 zerkleinern", mode: { type: "blend", time: 10, speed: "7" } }
        ]
      },
      {
        text: "Zwiebel, Knoblauch und Ingwer in den Mixtopf geben und 5 Sek./Stufe 5 zerkleinern.",
        ingredientAnnotations: [
          { matchedSubstring: "Zwiebel", ingredientId: "zwiebel" },
          { matchedSubstring: "Knoblauch", ingredientId: "knoblauch" },
          { matchedSubstring: "Ingwer", ingredientId: "ingwer" }
        ],
        modeAnnotations: [
          { matchedSubstring: "5 Sek./Stufe 5 zerkleinern", mode: { type: "tts", time: 5, speed: "5" } }
        ]
      },
      {
        text: "Pflanzenöl, Currypulver und Chiliflocken zugeben und 4 Min./140°C anbraten.",
        ingredientAnnotations: [
          { matchedSubstring: "Pflanzenöl", ingredientId: "pflanzenoel" },
          { matchedSubstring: "Currypulver", ingredientId: "currypulver" },
          { matchedSubstring: "Chiliflocken", ingredientId: "chiliflocken" }
        ],
        modeAnnotations: [
          { matchedSubstring: "4 Min./140°C anbraten", mode: { type: "browning", time: 240, temperature: 140 } }
        ]
      },
      {
        text: "Stückige Tomaten, Kokosmilch, Wasser, Salz und Pfeffer zugeben. Gareinsatz auf den Deckel stellen.",
        ingredientAnnotations: [
          { matchedSubstring: "Stückige Tomaten", ingredientId: "tomaten" },
          { matchedSubstring: "Kokosmilch", ingredientId: "kokosmilch" },
          { matchedSubstring: "Wasser", ingredientId: "wasser" }
        ]
      }
    ], null, 2),
    "",
    "GENERAL STYLE & CONVENTIONS:",
    "- Paraphrase source wording as needed, but preserve factual recipe content and machine settings.",
    "- Do not add culinary facts that are not supported by the source.",
    "- Be specific, concise, and clear.",
    "- hints: Extract only tips, variations, or serving suggestions explicitly present in the source recipe. Never invent them. Use an empty string if the source provides none."
  ];

  return instructions.filter(Boolean).join("\n");
}
