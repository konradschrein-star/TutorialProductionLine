/**
 * Broadcast Photography Specifications & Visual Guidelines
 *
 * Reusable, format-agnostic visual specification system for AI image generation.
 * Pure data + pure helper functions. No IO.
 *
 * Provides camera, lens, lighting, composition, and angle specifications
 * that get injected into LLM prompts to produce photorealistic broadcast-quality images
 * instead of generic AI-generated visuals.
 */

// ---------------------------------------------------------------------------
// Shot Types
// ---------------------------------------------------------------------------

export const SHOT_TYPES = [
  "establishing",
  "wide",
  "medium",
  "medium_closeup",
  "closeup",
  "detail",
  "over_shoulder",
] as const;

export type ShotType = (typeof SHOT_TYPES)[number];

// ---------------------------------------------------------------------------
// Camera Angles
// ---------------------------------------------------------------------------

export const CAMERA_ANGLES = [
  "eye_level",
  "slight_low_angle",
  "high_angle",
  "low_angle",
  "dutch_angle",
  "profile",
  "over_shoulder",
  "three_quarter",
] as const;

export type CameraAngle = (typeof CAMERA_ANGLES)[number];

// ---------------------------------------------------------------------------
// Broadcast Photography Specs
// ---------------------------------------------------------------------------

export const BROADCAST_PHOTOGRAPHY_SPECS = {
  camera: {
    type: "Broadcast-grade ENG camera or professional DSLR",
    lenses: {
      establishing: "24mm wide angle lens",
      wide: "24-35mm wide angle lens",
      medium: "35-50mm standard lens",
      medium_closeup: "50mm standard lens",
      closeup: "50-85mm portrait lens",
      detail: "70mm+ telephoto or macro lens",
      over_shoulder: "35-50mm standard lens",
    },
    aperture: {
      establishing: "f/4-f/5.6 (greater depth of field)",
      wide: "f/4-f/5.6 (greater depth of field)",
      medium: "f/2.8-f/4 (moderate depth)",
      medium_closeup: "f/2.8-f/4 (moderate depth)",
      closeup: "f/2.8-f/4 (subject separation from background)",
      detail: "f/2.8 (shallow depth, background blur)",
      over_shoulder: "f/2.8-f/4 (subject separation)",
    },
  },

  lighting: {
    natural: "Natural daylight, 5500K color temperature balanced",
    indoor: "Mixed fluorescent and ambient light, 4500-5000K",
    golden: "Golden hour (4500K), warm tones, soft directional shadows",
    overcast: "Overcast diffused light, soft shadows, even illumination",
    studio: "Professional studio lighting, three-point setup, 5000K",
    evening: "Evening blue hour mixed with warm artificial building lights",
    avoid: "Harsh midday sun, extreme shadows, oversaturation, flat frontal flash",
  },

  composition: {
    ruleOfThirds: "Subject on left or right third line, not dead center",
    headroom: "Appropriate negative space above subjects (not cropped tight)",
    leadingLines: "Use architectural elements, roads, or environmental lines to guide the eye",
    depth: "Visible foreground, midground, and background layers for dimensional depth",
    horizon: "Level horizon unless Dutch angle is intentionally used for dramatic effect",
    negativeSpace: "Use empty space to emphasize subject isolation when appropriate",
  },

  productionReality: {
    environments: "Crowded rooms with natural chaos, not sterile empty spaces",
    people: "Slightly out-of-focus background figures in natural positions",
    movement: "Slight motion blur on moving subjects (1/200s shutter feel)",
    lensCharacteristics: "Subtle lens flare when light sources present, natural vignetting at edges",
    focus: "Sharp on primary subject, gradual falloff to background",
    imperfections: "Slight noise in shadows, subtle lens distortion, natural grain at ISO 800-1600",
  },

  cameraAngles: {
    eye_level: "Standard neutral perspective, subject at eye level — objective, balanced",
    slight_low_angle: "Slightly below eye level looking up — gives subject subtle authority",
    high_angle: "Shot from above looking down — shows scale, vulnerability, or overview",
    low_angle: "Shot from below looking up — shows power, dominance, subject authority",
    dutch_angle: "Tilted horizon — tension, instability, unease (use VERY sparingly)",
    profile: "Side view, 90-degree angle to subject — contemplation, neutrality",
    over_shoulder: "From behind one subject looking toward another — context, relationship",
    three_quarter: "Angled 45 degrees to subject — shows depth, natural perspective",
  },

  avoidAITells: [
    "Perfect symmetry (too artificial — real photos are slightly asymmetric)",
    "Oversaturated colors (Instagram filter look — use professional neutral grading)",
    "Extreme bokeh (iPhone portrait mode — use realistic lens DOF)",
    "Perfectly clean environments (sterile CG look — real spaces have clutter)",
    "Everyone facing camera (unnatural staging — people in backgrounds look elsewhere)",
    "Extreme wide angles with distortion (GoPro look — use rectilinear lenses)",
    "HDR tone-mapping artifacts (halo edges — use natural dynamic range)",
    "Plastic skin texture (AI hallmark — include pores, micro-wrinkles, stray hairs)",
    "Perfect teeth/eyes (uncanny — subtle imperfections are human)",
    "Uniform lighting with no shadows (flat — real light creates depth through shadow)",
    "Repetitive patterns or textures (AI tiling artifacts — break up repetition)",
    "Text or signage (AI cannot render text reliably — avoid or blur)",
    "Hands with wrong finger count (AI hallmark — minimize visible hands or use gloves/partial framing)",
    "Over-rendered hair (AI tendency — keep hair natural, slightly messy)",
  ],

  realityChecks: [
    "Natural imperfections: slight noise, subtle lens distortion, film grain",
    "Environmental context: power lines, signage, urban clutter, weather stains",
    "Weather effects: cloud cover, lighting quality, wind-blown elements",
    "Time continuity: consistent sun position within scene sequence",
    "Production hints: lens flare, vignetting, focus rolloff, chromatic aberration at edges",
    "Human elements: wrinkled clothing, varied skin tones, asymmetric features",
  ],
} as const;

// ---------------------------------------------------------------------------
// Shot Distribution by Narrative Position
// ---------------------------------------------------------------------------

/**
 * Recommend a shot type based on scene position in the narrative arc.
 *
 * Distribution strategy:
 * - Opening (0-15%): Establishing + Medium (set the stage)
 * - Development (15-70%): Medium + Closeup (main content)
 * - Evidence (70-85%): Medium + Detail + Closeup (facts, data)
 * - Conclusion (85-100%): Medium + Establishing (wrap up, pull back)
 */
export function recommendShotType(
  sceneIndex: number,
  totalScenes: number,
  narrativeHint?: "opening" | "development" | "evidence" | "conclusion"
): ShotType {
  const position = totalScenes > 1 ? sceneIndex / (totalScenes - 1) : 0;

  // Use explicit narrative hint if provided
  const narrative =
    narrativeHint ??
    (position <= 0.15
      ? "opening"
      : position <= 0.7
        ? "development"
        : position <= 0.85
          ? "evidence"
          : "conclusion");

  // Deterministic rotation within each narrative segment
  const segmentIndex = sceneIndex % 4;

  switch (narrative) {
    case "opening":
      return sceneIndex === 0
        ? "establishing"
        : (["medium", "wide", "medium_closeup", "establishing"] as const)[segmentIndex];
    case "development":
      return (["medium", "closeup", "medium_closeup", "wide"] as const)[segmentIndex];
    case "evidence":
      return (["detail", "medium", "closeup", "medium_closeup"] as const)[segmentIndex];
    case "conclusion":
      return sceneIndex === totalScenes - 1
        ? "establishing"
        : (["medium", "wide", "establishing", "medium"] as const)[segmentIndex];
  }
}

/**
 * Recommend a camera angle, ensuring no two consecutive scenes share the same angle.
 * Uses a deterministic rotation with offset to prevent monotony.
 */
export function recommendCameraAngle(
  sceneIndex: number,
  totalScenes: number
): CameraAngle {
  // Angles ordered by visual neutrality (most neutral first)
  const angleRotation: CameraAngle[] = [
    "eye_level",
    "three_quarter",
    "slight_low_angle",
    "eye_level",
    "high_angle",
    "three_quarter",
    "profile",
    "slight_low_angle",
  ];

  return angleRotation[sceneIndex % angleRotation.length];
}

// ---------------------------------------------------------------------------
// Spec Formatters (for prompt injection)
// ---------------------------------------------------------------------------

/**
 * Get camera and lens specification string for a given shot type.
 */
export function getCameraSpec(shotType: ShotType): string {
  const lenses = BROADCAST_PHOTOGRAPHY_SPECS.camera.lenses;
  const apertures = BROADCAST_PHOTOGRAPHY_SPECS.camera.aperture;

  return `shot on ${BROADCAST_PHOTOGRAPHY_SPECS.camera.type} with ${lenses[shotType]} at ${apertures[shotType]}`;
}

/**
 * Get lighting specification for a time-of-day description.
 */
export function getLightingSpec(timeOfDay: string): string {
  const lighting = BROADCAST_PHOTOGRAPHY_SPECS.lighting;
  const lower = timeOfDay.toLowerCase();

  if (lower.includes("golden") || lower.includes("sunset") || lower.includes("sunrise")) {
    return lighting.golden;
  }
  if (lower.includes("overcast") || lower.includes("cloudy")) {
    return lighting.overcast;
  }
  if (lower.includes("night") || lower.includes("evening") || lower.includes("dusk")) {
    return lighting.evening;
  }
  if (lower.includes("indoor") || lower.includes("interior") || lower.includes("studio")) {
    return lighting.indoor;
  }
  return lighting.natural;
}

/**
 * Get composition rules appropriate for a given shot type.
 */
export function getCompositionRules(shotType: ShotType): string {
  const comp = BROADCAST_PHOTOGRAPHY_SPECS.composition;
  const rules: string[] = [comp.ruleOfThirds];

  switch (shotType) {
    case "establishing":
    case "wide":
      rules.push(comp.depth, comp.leadingLines, comp.horizon);
      break;
    case "medium":
    case "medium_closeup":
    case "over_shoulder":
      rules.push(comp.depth, comp.headroom);
      break;
    case "closeup":
      rules.push(comp.headroom, comp.negativeSpace);
      break;
    case "detail":
      rules.push(comp.negativeSpace);
      break;
  }

  return rules.join(". ");
}

/**
 * Get production reality modifiers for photorealistic output.
 */
export function getRealismModifiers(): string {
  const prod = BROADCAST_PHOTOGRAPHY_SPECS.productionReality;
  return [
    prod.lensCharacteristics,
    prod.focus,
    prod.imperfections,
    prod.movement,
  ].join(", ");
}

/**
 * Get the camera angle description string.
 */
export function getCameraAngleDescription(angle: CameraAngle): string {
  return BROADCAST_PHOTOGRAPHY_SPECS.cameraAngles[angle];
}

/**
 * Format the complete broadcast photography specifications as a prompt section.
 * Designed for injection into LLM system prompts.
 */
export function formatPhotographySpecsForPrompt(): string {
  const specs = BROADCAST_PHOTOGRAPHY_SPECS;

  return `
# Professional Broadcast Photography Requirements

## Camera & Lens Specifications
- Camera type: ${specs.camera.type}
- Focal lengths by shot type:
  * Establishing: ${specs.camera.lenses.establishing}
  * Wide: ${specs.camera.lenses.wide}
  * Medium: ${specs.camera.lenses.medium}
  * Closeup: ${specs.camera.lenses.closeup}
  * Detail: ${specs.camera.lenses.detail}
- Aperture ranges:
  * Establishing: ${specs.camera.aperture.establishing}
  * Medium: ${specs.camera.aperture.medium}
  * Closeup: ${specs.camera.aperture.closeup}
  * Detail: ${specs.camera.aperture.detail}

## Lighting & Color
- Natural lighting: ${specs.lighting.natural}
- Indoor lighting: ${specs.lighting.indoor}
- Golden hour: ${specs.lighting.golden}
- Overcast: ${specs.lighting.overcast}
- AVOID: ${specs.lighting.avoid}

## Composition & Framing
- Rule of thirds: ${specs.composition.ruleOfThirds}
- Headroom: ${specs.composition.headroom}
- Leading lines: ${specs.composition.leadingLines}
- Depth cues: ${specs.composition.depth}
- Horizon: ${specs.composition.horizon}

## Production Reality (CRITICAL for avoiding AI look)
- Environments: ${specs.productionReality.environments}
- People: ${specs.productionReality.people}
- Movement: ${specs.productionReality.movement}
- Lens characteristics: ${specs.productionReality.lensCharacteristics}
- Focus: ${specs.productionReality.focus}
- Imperfections: ${specs.productionReality.imperfections}

## Camera Angles
- Eye level: ${specs.cameraAngles.eye_level}
- Slight low angle: ${specs.cameraAngles.slight_low_angle}
- High angle: ${specs.cameraAngles.high_angle}
- Low angle: ${specs.cameraAngles.low_angle}
- Dutch angle: ${specs.cameraAngles.dutch_angle}
- Profile: ${specs.cameraAngles.profile}
- Over-the-shoulder: ${specs.cameraAngles.over_shoulder}
- Three-quarter: ${specs.cameraAngles.three_quarter}

## AVOID These AI Tells
${specs.avoidAITells.map((tell) => `- ${tell}`).join("\n")}

## Reality Checks (include these qualities)
${specs.realityChecks.map((check) => `- ${check}`).join("\n")}
`.trim();
}

/**
 * Format visual guidelines as a compact prompt section.
 */
export function formatVisualGuidelinesForPrompt(): string {
  return `
# Documentary Cinematography Guidelines

## Shot Type Reference
- Establishing: Wide angle showing full context/location (openers, location changes)
- Wide: Broader view with environment context (context-setting, transitions)
- Medium: Subject in environment (main content, explanations, development)
- Medium Closeup: Tighter medium showing subject detail (emphasis, key moments)
- Closeup: Close on key subject or object (emotion, emphasis, highlighting details)
- Detail: Macro/specific object focus (facts, evidence, data, documents)
- Over-shoulder: From behind subject looking forward (context, relationships)

## Shot Distribution (for ${SHOT_TYPES.length} types across N scenes)
- Opening (first 15%): Establishing + Medium (set the stage)
- Development (15-70%): Medium + Closeup + Wide (main content)
- Evidence (70-85%): Detail + Medium + Closeup (facts and data)
- Conclusion (final 15%): Medium + Establishing (wrap up, pull back)

## Visual Continuity
- Maintain consistent visual theme: same setting, mood, color palette, time of day across related scenes
- Vary shot types: never use the same shot type for consecutive scenes
- Vary camera angles: never use the same angle for consecutive scenes
- Create narrative flow: each image should feel connected to the previous one
- Maintain color consistency: use similar color grading across a scene sequence

## Style Consistency
- Photorealistic, modern documentary/broadcast journalism style
- Consistent time of day (unless script implies time change)
- Professional color grading with neutral tones
- Focus on environments, objects, and concepts rather than people
- Avoid cartoonish, artistic, or abstract imagery
`.trim();
}
