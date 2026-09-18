const GRAM_AMOUNT_PATTERN =
  /(\d+(?:[.,]\d+)?)\s*(?:[-\u2013\u2014]\s*(\d+(?:[.,]\d+)?))?\s*g\b/gi;

interface SourceGramConstraints {
  exact: Set<number>;
  ranges: Array<[number, number]>;
}

export function validateCookidooScaleSteps(
  output: unknown,
  sourceMarkdown = ""
): string[] {
  if (!output || typeof output !== "object") {
    return [];
  }

  const servingSize =
    (output as Record<string, unknown>).servingSize;

  if (!servingSize || typeof servingSize !== "object") {
    return [];
  }

  const steps =
    (servingSize as Record<string, unknown>).steps;

  if (!Array.isArray(steps)) {
    return [];
  }

  const sourceConstraints =
    collectSourceGramConstraints(sourceMarkdown);

  const errors: string[] = [];

  steps.forEach((step, index) => {
    if (!step || typeof step !== "object") {
      return;
    }

    const record = step as Record<string, unknown>;
    const mode = record.mode;

    if (!mode || typeof mode !== "object") {
      return;
    }

    const modeRecord =
      mode as Record<string, unknown>;

    if (modeRecord.type !== "scale") {
      return;
    }

    const target =
      typeof modeRecord.grams === "number"
        ? modeRecord.grams
        : undefined;

    const description =
      typeof record.description === "string"
        ? record.description
        : "";

    const gramMatches = [
      ...description.matchAll(GRAM_AMOUNT_PATTERN)
    ];

    if (gramMatches.length === 0) {
      errors.push(
        "/servingSize/steps/" +
          index +
          ": every scale step must visibly identify exactly one gram amount."
      );
      return;
    }

    const rangeMatch = gramMatches.find(
      (match) => match[2] !== undefined
    );

    if (rangeMatch) {
      errors.push(
        "/servingSize/steps/" +
          index +
          ': a fixed scale target cannot directly represent the range "' +
          rangeMatch[0] +
          '". Use one exact target that lies inside the source range.'
      );
      return;
    }

    if (gramMatches.length > 1) {
      errors.push(
        "/servingSize/steps/" +
          index +
          ": do not combine multiple gram ingredients into one scale target. Create one scale step per gram ingredient."
      );
      return;
    }

    if (target === undefined) {
      return;
    }

    const described = Number(
      gramMatches[0][1].replace(",", ".")
    );

    if (
      Number.isFinite(described) &&
      !sameNumber(described, target)
    ) {
      errors.push(
        "/servingSize/steps/" +
          index +
          ": scale target is " +
          target +
          " g but the visible amount is " +
          described +
          " g."
      );
      return;
    }

    if (
      sourceMarkdown &&
      !sourceAllowsGramTarget(
        sourceConstraints,
        target
      )
    ) {
      errors.push(
        "/servingSize/steps/" +
          index +
          ": scale target " +
          target +
          " g is not supported by any gram quantity or gram range in the official source."
      );
    }
  });

  return errors;
}

function collectSourceGramConstraints(
  sourceMarkdown: string
): SourceGramConstraints {
  const exact = new Set<number>();
  const ranges: Array<[number, number]> = [];

  if (!sourceMarkdown) {
    return { exact, ranges };
  }

  const withoutNutrition = sourceMarkdown.replace(
    /\n## Nutrition\b[\s\S]*?(?=\n## |\s*$)/gi,
    "\n"
  );

  const matches = withoutNutrition.matchAll(
    GRAM_AMOUNT_PATTERN
  );

  for (const match of matches) {
    const first = Number(
      match[1].replace(",", ".")
    );

    if (!Number.isFinite(first)) {
      continue;
    }

    if (match[2] !== undefined) {
      const second = Number(
        match[2].replace(",", ".")
      );

      if (!Number.isFinite(second)) {
        continue;
      }

      ranges.push([
        Math.min(first, second),
        Math.max(first, second)
      ]);
    } else {
      exact.add(first);
    }
  }

  return { exact, ranges };
}

function sourceAllowsGramTarget(
  constraints: SourceGramConstraints,
  target: number
): boolean {
  for (const value of constraints.exact) {
    if (sameNumber(value, target)) {
      return true;
    }
  }

  return constraints.ranges.some(
    ([minimum]) =>
      sameNumber(target, minimum)
  );
}

function sameNumber(
  left: number,
  right: number
): boolean {
  return Math.abs(left - right) < 1e-9;
}
