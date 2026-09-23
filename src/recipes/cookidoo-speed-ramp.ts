import type { RecipeInput } from "./schema.js";
import type { RecipeStepInput } from "./types.js";

interface SpeedRamp {
  durationSeconds: number;
  startSpeed: number;
  endSpeed: number;
}

const MIN_STAGE_SECONDS = 3;

export function applyCookidooSpeedRamps(
  input: RecipeInput,
  sourceMarkdown: string
): RecipeInput {
  const ramps = extractCookidooSpeedRamps(sourceMarkdown);

  if (ramps.length === 0) {
    return input;
  }

  const steps = [...input.servingSize.steps];

  for (const ramp of ramps) {
    const stageSpeeds = buildStageSpeeds(ramp);

    if (stageSpeeds.length < 2) {
      continue;
    }

    if (alreadyContainsRamp(steps, ramp, stageSpeeds)) {
      continue;
    }

    const stepIndex = findApproximateRampStep(steps, ramp);

    if (stepIndex === -1) {
      continue;
    }

    const original = steps[stepIndex];
    const durations = splitDuration(ramp.durationSeconds, stageSpeeds.length);

    const replacement = stageSpeeds.map((speed, index) => {
      const seconds = durations[index];

      return {
        title: `${original.title} (${index + 1}/${stageSpeeds.length})`.slice(0, 80),
        description: "",
        mode: {
          type: "manualCooking",
          temperature: 0,
          minutes: Math.floor(seconds / 60),
          seconds: seconds % 60,
          speed,
          rotationDirection: "right"
        }
      } as RecipeStepInput;
    });

    steps.splice(stepIndex, 1, ...replacement);
  }

  return {
    ...input,
    servingSize: {
      ...input.servingSize,
      steps
    }
  };
}

function extractCookidooSpeedRamps(markdown: string): SpeedRamp[] {
  const ramps: SpeedRamp[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    if (!/gradual|schritt|ansteig|increas|progress|aument|augment|stopniow|zwiększ/i.test(line)) {
      continue;
    }

    const speedMatch = line.match(
      /(?:Stufe|Speed)\s*(\d+)\s*[-–—]\s*(\d+)/i
    );

    if (!speedMatch) {
      continue;
    }

    const minutesMatch = line.match(
      /(\d+)\s*(?:Min\.?|minutes?)/i
    );

    const secondsMatch = line.match(
      /(\d+)\s*(?:Sek\.?|seconds?|sec\.?)/i
    );

    const durationSeconds =
      Number(minutesMatch?.[1] ?? 0) * 60 +
      Number(secondsMatch?.[1] ?? 0);

    const startSpeed = Number(speedMatch[1]);
    const endSpeed = Number(speedMatch[2]);

    if (
      durationSeconds <= 0 ||
      !Number.isInteger(startSpeed) ||
      !Number.isInteger(endSpeed) ||
      startSpeed < 0 ||
      endSpeed > 10 ||
      startSpeed >= endSpeed
    ) {
      continue;
    }

    ramps.push({
      durationSeconds,
      startSpeed,
      endSpeed
    });
  }

  return ramps;
}

function buildStageSpeeds(ramp: SpeedRamp): number[] {
  const availableSpeeds = ramp.endSpeed - ramp.startSpeed + 1;

  const maximumStagesByDuration = Math.floor(
    ramp.durationSeconds / MIN_STAGE_SECONDS
  );

  const stageCount = Math.min(
    availableSpeeds,
    maximumStagesByDuration
  );

  if (stageCount < 2) {
    return [];
  }

  if (stageCount === availableSpeeds) {
    return Array.from(
      { length: availableSpeeds },
      (_, index) => ramp.startSpeed + index
    );
  }

  const speeds: number[] = [];

  for (let index = 0; index < stageCount; index += 1) {
    const fraction = index / (stageCount - 1);

    const speed = Math.round(
      ramp.startSpeed +
      fraction * (ramp.endSpeed - ramp.startSpeed)
    );

    if (speeds.at(-1) !== speed) {
      speeds.push(speed);
    }
  }

  return speeds;
}

function splitDuration(
  totalSeconds: number,
  stages: number
): number[] {
  const base = Math.floor(totalSeconds / stages);
  const remainder = totalSeconds % stages;

  return Array.from(
    { length: stages },
    (_, index) => base + (index < remainder ? 1 : 0)
  );
}

function findApproximateRampStep(
  steps: RecipeStepInput[],
  ramp: SpeedRamp
): number {
  const candidates: number[] = [];

  steps.forEach((step, index) => {
    const mode = step.mode;

    if (mode.type === "manualCooking") {
      if (
        mode.temperature !== 0 ||
        mode.rotationDirection !== "right"
      ) {
        return;
      }

      const duration =
        mode.minutes * 60 +
        mode.seconds;

      if (
        duration === ramp.durationSeconds &&
        mode.speed >= ramp.startSpeed &&
        mode.speed <= ramp.endSpeed
      ) {
        candidates.push(index);
      }

      return;
    }

    if (
      mode.type === "puree" ||
      mode.type === "smoothie"
    ) {
      const duration =
        mode.minutes * 60 +
        mode.seconds;

      if (duration === ramp.durationSeconds) {
        candidates.push(index);
      }
    }
  });

  const hinted = candidates.find((index) => {
    const previous = steps[index - 1];

    const text = [
      previous?.title ?? "",
      previous?.description ?? "",
      steps[index].title
    ]
      .join(" ")
      .toLowerCase();

    return /gradual|increase|ramp|schritt|ansteig|stopniow|zwiększ/.test(text);
  });

  if (hinted !== undefined) {
    return hinted;
  }

  return candidates.length === 1
    ? candidates[0]
    : -1;
}

function alreadyContainsRamp(
  steps: RecipeStepInput[],
  ramp: SpeedRamp,
  expectedSpeeds: number[]
): boolean {
  for (
    let start = 0;
    start <= steps.length - expectedSpeeds.length;
    start += 1
  ) {
    const slice = steps.slice(
      start,
      start + expectedSpeeds.length
    );

    let totalDuration = 0;
    let matches = true;

    for (let index = 0; index < slice.length; index += 1) {
      const mode = slice[index].mode;

      if (
        mode.type !== "manualCooking" ||
        mode.temperature !== 0 ||
        mode.rotationDirection !== "right" ||
        mode.speed !== expectedSpeeds[index]
      ) {
        matches = false;
        break;
      }

      totalDuration +=
        mode.minutes * 60 +
        mode.seconds;
    }

    if (
      matches &&
      totalDuration === ramp.durationSeconds
    ) {
      return true;
    }
  }

  return false;
}
