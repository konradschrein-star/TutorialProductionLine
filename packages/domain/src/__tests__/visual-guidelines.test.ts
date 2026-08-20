import { describe, it, expect } from "vitest";
import {
  SHOT_TYPES,
  CAMERA_ANGLES,
  BROADCAST_PHOTOGRAPHY_SPECS,
  recommendShotType,
  recommendCameraAngle,
  getCameraSpec,
  getLightingSpec,
  getCompositionRules,
  getRealismModifiers,
  getCameraAngleDescription,
  formatPhotographySpecsForPrompt,
  formatVisualGuidelinesForPrompt,
  type ShotType,
  type CameraAngle,
} from "../visual-guidelines.js";

// ---------------------------------------------------------------------------
// SHOT_TYPES constant
// ---------------------------------------------------------------------------

describe("SHOT_TYPES", () => {
  it("contains all seven expected shot type values", () => {
    expect(SHOT_TYPES).toContain("establishing");
    expect(SHOT_TYPES).toContain("wide");
    expect(SHOT_TYPES).toContain("medium");
    expect(SHOT_TYPES).toContain("medium_closeup");
    expect(SHOT_TYPES).toContain("closeup");
    expect(SHOT_TYPES).toContain("detail");
    expect(SHOT_TYPES).toContain("over_shoulder");
  });

  it("has exactly 7 entries", () => {
    expect(SHOT_TYPES.length).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// CAMERA_ANGLES constant
// ---------------------------------------------------------------------------

describe("CAMERA_ANGLES", () => {
  it("contains all eight expected camera angle values", () => {
    expect(CAMERA_ANGLES).toContain("eye_level");
    expect(CAMERA_ANGLES).toContain("slight_low_angle");
    expect(CAMERA_ANGLES).toContain("high_angle");
    expect(CAMERA_ANGLES).toContain("low_angle");
    expect(CAMERA_ANGLES).toContain("dutch_angle");
    expect(CAMERA_ANGLES).toContain("profile");
    expect(CAMERA_ANGLES).toContain("over_shoulder");
    expect(CAMERA_ANGLES).toContain("three_quarter");
  });

  it("has exactly 8 entries", () => {
    expect(CAMERA_ANGLES.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// BROADCAST_PHOTOGRAPHY_SPECS shape regression
// ---------------------------------------------------------------------------

describe("BROADCAST_PHOTOGRAPHY_SPECS", () => {
  it("camera.lenses has an entry for every ShotType", () => {
    for (const shot of SHOT_TYPES) {
      expect(BROADCAST_PHOTOGRAPHY_SPECS.camera.lenses).toHaveProperty(shot);
      expect(
        (BROADCAST_PHOTOGRAPHY_SPECS.camera.lenses as Record<string, string>)[shot],
      ).toBeTruthy();
    }
  });

  it("camera.aperture has an entry for every ShotType", () => {
    for (const shot of SHOT_TYPES) {
      expect(BROADCAST_PHOTOGRAPHY_SPECS.camera.aperture).toHaveProperty(shot);
      expect(
        (BROADCAST_PHOTOGRAPHY_SPECS.camera.aperture as Record<string, string>)[shot],
      ).toBeTruthy();
    }
  });

  it("cameraAngles has an entry for every CameraAngle", () => {
    for (const angle of CAMERA_ANGLES) {
      expect(BROADCAST_PHOTOGRAPHY_SPECS.cameraAngles).toHaveProperty(angle);
      expect(
        (BROADCAST_PHOTOGRAPHY_SPECS.cameraAngles as Record<string, string>)[angle],
      ).toBeTruthy();
    }
  });

  it("lighting has avoid, natural, indoor, golden, overcast, studio, and evening", () => {
    const { lighting } = BROADCAST_PHOTOGRAPHY_SPECS;
    expect(lighting.avoid).toBeTruthy();
    expect(lighting.natural).toBeTruthy();
    expect(lighting.indoor).toBeTruthy();
    expect(lighting.golden).toBeTruthy();
    expect(lighting.overcast).toBeTruthy();
    expect(lighting.studio).toBeTruthy();
    expect(lighting.evening).toBeTruthy();
  });

  it("avoidAITells is a non-empty array of strings", () => {
    expect(Array.isArray(BROADCAST_PHOTOGRAPHY_SPECS.avoidAITells)).toBe(true);
    expect(BROADCAST_PHOTOGRAPHY_SPECS.avoidAITells.length).toBeGreaterThan(0);
    for (const tell of BROADCAST_PHOTOGRAPHY_SPECS.avoidAITells) {
      expect(typeof tell).toBe("string");
    }
  });

  it("realityChecks is a non-empty array of strings", () => {
    expect(Array.isArray(BROADCAST_PHOTOGRAPHY_SPECS.realityChecks)).toBe(true);
    expect(BROADCAST_PHOTOGRAPHY_SPECS.realityChecks.length).toBeGreaterThan(0);
    for (const check of BROADCAST_PHOTOGRAPHY_SPECS.realityChecks) {
      expect(typeof check).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// recommendShotType
// ---------------------------------------------------------------------------

describe("recommendShotType", () => {
  // Single-scene edge case
  it("returns 'establishing' for scene 0 of 1 total scenes", () => {
    expect(recommendShotType(0, 1)).toBe("establishing");
  });

  // Opening segment — first scene is always establishing
  it("returns 'establishing' for scene 0 regardless of total when no hint", () => {
    expect(recommendShotType(0, 10)).toBe("establishing");
    expect(recommendShotType(0, 100)).toBe("establishing");
  });

  // Narrative hint overrides positional inference
  it("respects explicit 'opening' hint: first scene is establishing", () => {
    expect(recommendShotType(0, 20, "opening")).toBe("establishing");
  });

  it("respects explicit 'opening' hint for non-zero scene (uses rotation)", () => {
    const result = recommendShotType(1, 20, "opening");
    // sceneIndex=1, segmentIndex=1%4=1 → ["medium","wide","medium_closeup","establishing"][1] = "wide"
    expect(result).toBe("wide");
  });

  it("respects explicit 'development' hint", () => {
    // sceneIndex=0, segmentIndex=0%4=0 → ["medium","closeup","medium_closeup","wide"][0] = "medium"
    expect(recommendShotType(0, 20, "development")).toBe("medium");
    // sceneIndex=1, segmentIndex=1 → "closeup"
    expect(recommendShotType(1, 20, "development")).toBe("closeup");
    // sceneIndex=2, segmentIndex=2 → "medium_closeup"
    expect(recommendShotType(2, 20, "development")).toBe("medium_closeup");
    // sceneIndex=3, segmentIndex=3 → "wide"
    expect(recommendShotType(3, 20, "development")).toBe("wide");
  });

  it("respects explicit 'evidence' hint", () => {
    // sceneIndex=0 → segmentIndex=0 → ["detail","medium","closeup","medium_closeup"][0] = "detail"
    expect(recommendShotType(0, 20, "evidence")).toBe("detail");
    expect(recommendShotType(1, 20, "evidence")).toBe("medium");
    expect(recommendShotType(2, 20, "evidence")).toBe("closeup");
    expect(recommendShotType(3, 20, "evidence")).toBe("medium_closeup");
  });

  it("respects explicit 'conclusion' hint: last scene is establishing", () => {
    expect(recommendShotType(19, 20, "conclusion")).toBe("establishing");
  });

  it("respects explicit 'conclusion' hint for non-last scene (uses rotation)", () => {
    // sceneIndex=0, totalScenes=20, not last → segmentIndex=0%4=0 → ["medium","wide","establishing","medium"][0] = "medium"
    expect(recommendShotType(0, 20, "conclusion")).toBe("medium");
    expect(recommendShotType(1, 20, "conclusion")).toBe("wide");
    expect(recommendShotType(2, 20, "conclusion")).toBe("establishing");
  });

  // Positional inference (no hint)
  it("infers 'development' for mid-range positions and returns valid shot types", () => {
    // position = 5 / (20-1) ≈ 0.263, which is in development (0.15-0.70)
    const result = recommendShotType(5, 20);
    const developmentShots: ShotType[] = ["medium", "closeup", "medium_closeup", "wide"];
    expect(developmentShots).toContain(result);
  });

  it("infers 'evidence' for positions 70-85% and returns valid shot types", () => {
    // position = 15 / (20-1) ≈ 0.789, which is in evidence (0.70-0.85)
    const result = recommendShotType(15, 20);
    const evidenceShots: ShotType[] = ["detail", "medium", "closeup", "medium_closeup"];
    expect(evidenceShots).toContain(result);
  });

  it("infers 'conclusion' for the last scene and returns 'establishing'", () => {
    // position = 19 / (20-1) = 1.0 → conclusion, and it IS the last scene
    expect(recommendShotType(19, 20)).toBe("establishing");
  });

  // Return type is always a valid ShotType
  it("always returns a valid ShotType for a range of inputs", () => {
    const totalScenes = 30;
    for (let i = 0; i < totalScenes; i++) {
      const result = recommendShotType(i, totalScenes);
      expect(SHOT_TYPES).toContain(result);
    }
  });

  // Boundary: exactly at 15% threshold
  it("treats position exactly 0.15 as opening (boundary inclusive)", () => {
    // 3 / (20-1) ≈ 0.1578 which is ≤ 0.15? No — let's pick a case at the boundary.
    // With 21 scenes: sceneIndex=3, position=3/20=0.15 exactly → opening
    // opening, sceneIndex=3, segmentIndex=3%4=3 → ["medium","wide","medium_closeup","establishing"][3] = "establishing"
    expect(recommendShotType(3, 21)).toBe("establishing");
  });

  // Deterministic rotation (segmentIndex wraps at 4)
  it("rotation wraps every 4 scenes for development", () => {
    // sceneIndex=4 → segmentIndex=4%4=0 → same as sceneIndex=0 for development
    expect(recommendShotType(4, 20, "development")).toBe(
      recommendShotType(0, 20, "development"),
    );
    expect(recommendShotType(5, 20, "development")).toBe(
      recommendShotType(1, 20, "development"),
    );
  });
});

// ---------------------------------------------------------------------------
// recommendCameraAngle
// ---------------------------------------------------------------------------

describe("recommendCameraAngle", () => {
  it("returns a valid CameraAngle for every scene index", () => {
    const totalScenes = 20;
    for (let i = 0; i < totalScenes; i++) {
      const result = recommendCameraAngle(i, totalScenes);
      expect(CAMERA_ANGLES).toContain(result);
    }
  });

  it("is deterministic — same inputs always produce same output", () => {
    expect(recommendCameraAngle(0, 10)).toBe(recommendCameraAngle(0, 10));
    expect(recommendCameraAngle(7, 10)).toBe(recommendCameraAngle(7, 10));
  });

  it("rotates through the 8-entry angleRotation array", () => {
    // The rotation array has 8 entries; index 0 and index 8 should produce the same angle
    expect(recommendCameraAngle(0, 20)).toBe(recommendCameraAngle(8, 20));
    expect(recommendCameraAngle(1, 20)).toBe(recommendCameraAngle(9, 20));
  });

  it("returns 'eye_level' for sceneIndex 0", () => {
    expect(recommendCameraAngle(0, 10)).toBe("eye_level");
  });

  it("returns 'three_quarter' for sceneIndex 1", () => {
    expect(recommendCameraAngle(1, 10)).toBe("three_quarter");
  });

  it("returns 'slight_low_angle' for sceneIndex 2", () => {
    expect(recommendCameraAngle(2, 10)).toBe("slight_low_angle");
  });

  it("returns 'eye_level' for sceneIndex 3", () => {
    expect(recommendCameraAngle(3, 10)).toBe("eye_level");
  });

  it("returns 'high_angle' for sceneIndex 4", () => {
    expect(recommendCameraAngle(4, 10)).toBe("high_angle");
  });

  it("returns 'three_quarter' for sceneIndex 5", () => {
    expect(recommendCameraAngle(5, 10)).toBe("three_quarter");
  });

  it("returns 'profile' for sceneIndex 6", () => {
    expect(recommendCameraAngle(6, 10)).toBe("profile");
  });

  it("returns 'slight_low_angle' for sceneIndex 7", () => {
    expect(recommendCameraAngle(7, 10)).toBe("slight_low_angle");
  });
});

// ---------------------------------------------------------------------------
// getCameraSpec
// ---------------------------------------------------------------------------

describe("getCameraSpec", () => {
  it("includes the camera type in the returned string", () => {
    for (const shot of SHOT_TYPES) {
      const spec = getCameraSpec(shot);
      expect(spec).toContain(BROADCAST_PHOTOGRAPHY_SPECS.camera.type);
    }
  });

  it("includes the correct lens for each shot type", () => {
    const lenses = BROADCAST_PHOTOGRAPHY_SPECS.camera.lenses;
    expect(getCameraSpec("establishing")).toContain(lenses.establishing);
    expect(getCameraSpec("wide")).toContain(lenses.wide);
    expect(getCameraSpec("medium")).toContain(lenses.medium);
    expect(getCameraSpec("medium_closeup")).toContain(lenses.medium_closeup);
    expect(getCameraSpec("closeup")).toContain(lenses.closeup);
    expect(getCameraSpec("detail")).toContain(lenses.detail);
    expect(getCameraSpec("over_shoulder")).toContain(lenses.over_shoulder);
  });

  it("includes the correct aperture for each shot type", () => {
    const apertures = BROADCAST_PHOTOGRAPHY_SPECS.camera.aperture;
    expect(getCameraSpec("establishing")).toContain(apertures.establishing);
    expect(getCameraSpec("wide")).toContain(apertures.wide);
    expect(getCameraSpec("medium")).toContain(apertures.medium);
    expect(getCameraSpec("medium_closeup")).toContain(apertures.medium_closeup);
    expect(getCameraSpec("closeup")).toContain(apertures.closeup);
    expect(getCameraSpec("detail")).toContain(apertures.detail);
    expect(getCameraSpec("over_shoulder")).toContain(apertures.over_shoulder);
  });

  it("returns a non-empty string for every ShotType", () => {
    for (const shot of SHOT_TYPES) {
      expect(getCameraSpec(shot)).toBeTruthy();
    }
  });

  // Specific string format regression
  it("uses 'shot on ... with ... at ...' format", () => {
    const spec = getCameraSpec("medium");
    expect(spec).toMatch(/^shot on .+ with .+ at .+$/);
  });
});

// ---------------------------------------------------------------------------
// getLightingSpec
// ---------------------------------------------------------------------------

describe("getLightingSpec", () => {
  const { lighting } = BROADCAST_PHOTOGRAPHY_SPECS;

  it("returns golden lighting for 'golden hour'", () => {
    expect(getLightingSpec("golden hour")).toBe(lighting.golden);
  });

  it("returns golden lighting for 'sunset'", () => {
    expect(getLightingSpec("sunset")).toBe(lighting.golden);
  });

  it("returns golden lighting for 'sunrise'", () => {
    expect(getLightingSpec("sunrise")).toBe(lighting.golden);
  });

  it("returns overcast lighting for 'overcast'", () => {
    expect(getLightingSpec("overcast")).toBe(lighting.overcast);
  });

  it("returns overcast lighting for 'cloudy'", () => {
    expect(getLightingSpec("cloudy day")).toBe(lighting.overcast);
  });

  it("returns evening lighting for 'night'", () => {
    expect(getLightingSpec("night")).toBe(lighting.evening);
  });

  it("returns evening lighting for 'evening'", () => {
    expect(getLightingSpec("evening")).toBe(lighting.evening);
  });

  it("returns evening lighting for 'dusk'", () => {
    expect(getLightingSpec("dusk")).toBe(lighting.evening);
  });

  it("returns indoor lighting for 'indoor'", () => {
    expect(getLightingSpec("indoor")).toBe(lighting.indoor);
  });

  it("returns indoor lighting for 'interior'", () => {
    expect(getLightingSpec("interior shot")).toBe(lighting.indoor);
  });

  it("returns indoor lighting for 'studio'", () => {
    expect(getLightingSpec("studio environment")).toBe(lighting.indoor);
  });

  it("returns natural lighting as fallback for unrecognized description", () => {
    expect(getLightingSpec("midday")).toBe(lighting.natural);
    expect(getLightingSpec("bright day")).toBe(lighting.natural);
    expect(getLightingSpec("")).toBe(lighting.natural);
    expect(getLightingSpec("some random description")).toBe(lighting.natural);
  });

  it("is case-insensitive (uppercase input)", () => {
    expect(getLightingSpec("GOLDEN HOUR")).toBe(lighting.golden);
    expect(getLightingSpec("OVERCAST")).toBe(lighting.overcast);
    expect(getLightingSpec("NIGHT")).toBe(lighting.evening);
    expect(getLightingSpec("INDOOR")).toBe(lighting.indoor);
  });

  it("matches 'SUNSET' in mixed case", () => {
    expect(getLightingSpec("Late Sunset Scene")).toBe(lighting.golden);
  });
});

// ---------------------------------------------------------------------------
// getCompositionRules
// ---------------------------------------------------------------------------

describe("getCompositionRules", () => {
  const { composition } = BROADCAST_PHOTOGRAPHY_SPECS;

  // All shot types include ruleOfThirds
  it("always includes the rule-of-thirds principle", () => {
    for (const shot of SHOT_TYPES) {
      expect(getCompositionRules(shot)).toContain(composition.ruleOfThirds);
    }
  });

  // establishing and wide
  it("includes depth, leadingLines, and horizon for 'establishing'", () => {
    const result = getCompositionRules("establishing");
    expect(result).toContain(composition.depth);
    expect(result).toContain(composition.leadingLines);
    expect(result).toContain(composition.horizon);
  });

  it("includes depth, leadingLines, and horizon for 'wide'", () => {
    const result = getCompositionRules("wide");
    expect(result).toContain(composition.depth);
    expect(result).toContain(composition.leadingLines);
    expect(result).toContain(composition.horizon);
  });

  it("does NOT include headroom for 'establishing'", () => {
    expect(getCompositionRules("establishing")).not.toContain(composition.headroom);
  });

  // medium, medium_closeup, over_shoulder
  it("includes depth and headroom for 'medium'", () => {
    const result = getCompositionRules("medium");
    expect(result).toContain(composition.depth);
    expect(result).toContain(composition.headroom);
  });

  it("includes depth and headroom for 'medium_closeup'", () => {
    const result = getCompositionRules("medium_closeup");
    expect(result).toContain(composition.depth);
    expect(result).toContain(composition.headroom);
  });

  it("includes depth and headroom for 'over_shoulder'", () => {
    const result = getCompositionRules("over_shoulder");
    expect(result).toContain(composition.depth);
    expect(result).toContain(composition.headroom);
  });

  it("does NOT include leadingLines for 'medium'", () => {
    expect(getCompositionRules("medium")).not.toContain(composition.leadingLines);
  });

  // closeup
  it("includes headroom and negativeSpace for 'closeup'", () => {
    const result = getCompositionRules("closeup");
    expect(result).toContain(composition.headroom);
    expect(result).toContain(composition.negativeSpace);
  });

  it("does NOT include depth for 'closeup'", () => {
    expect(getCompositionRules("closeup")).not.toContain(composition.depth);
  });

  // detail
  it("includes negativeSpace for 'detail'", () => {
    expect(getCompositionRules("detail")).toContain(composition.negativeSpace);
  });

  it("does NOT include depth or headroom for 'detail'", () => {
    const result = getCompositionRules("detail");
    expect(result).not.toContain(composition.depth);
    expect(result).not.toContain(composition.headroom);
  });

  // Separator
  it("joins rules with '. ' separator", () => {
    // ruleOfThirds alone for detail plus negativeSpace — two items joined with ". "
    const result = getCompositionRules("detail");
    expect(result).toContain(". ");
  });

  it("returns a non-empty string for every ShotType", () => {
    for (const shot of SHOT_TYPES) {
      expect(getCompositionRules(shot)).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// getRealismModifiers
// ---------------------------------------------------------------------------

describe("getRealismModifiers", () => {
  const { productionReality } = BROADCAST_PHOTOGRAPHY_SPECS;

  it("returns a non-empty string", () => {
    expect(getRealismModifiers()).toBeTruthy();
  });

  it("includes lensCharacteristics", () => {
    expect(getRealismModifiers()).toContain(productionReality.lensCharacteristics);
  });

  it("includes focus description", () => {
    expect(getRealismModifiers()).toContain(productionReality.focus);
  });

  it("includes imperfections description", () => {
    expect(getRealismModifiers()).toContain(productionReality.imperfections);
  });

  it("includes movement description", () => {
    expect(getRealismModifiers()).toContain(productionReality.movement);
  });

  it("joins items with ', ' separator (result contains the separator)", () => {
    const result = getRealismModifiers();
    // The four spec strings are joined with ", " so at least one separator must be present
    expect(result).toContain(", ");
  });

  it("is deterministic — repeated calls return the same string", () => {
    expect(getRealismModifiers()).toBe(getRealismModifiers());
  });
});

// ---------------------------------------------------------------------------
// getCameraAngleDescription
// ---------------------------------------------------------------------------

describe("getCameraAngleDescription", () => {
  it("returns the description for every CameraAngle", () => {
    for (const angle of CAMERA_ANGLES) {
      expect(getCameraAngleDescription(angle)).toBeTruthy();
    }
  });

  it("returns the exact spec string for 'eye_level'", () => {
    expect(getCameraAngleDescription("eye_level")).toBe(
      BROADCAST_PHOTOGRAPHY_SPECS.cameraAngles.eye_level,
    );
  });

  it("returns the exact spec string for 'slight_low_angle'", () => {
    expect(getCameraAngleDescription("slight_low_angle")).toBe(
      BROADCAST_PHOTOGRAPHY_SPECS.cameraAngles.slight_low_angle,
    );
  });

  it("returns the exact spec string for 'high_angle'", () => {
    expect(getCameraAngleDescription("high_angle")).toBe(
      BROADCAST_PHOTOGRAPHY_SPECS.cameraAngles.high_angle,
    );
  });

  it("returns the exact spec string for 'low_angle'", () => {
    expect(getCameraAngleDescription("low_angle")).toBe(
      BROADCAST_PHOTOGRAPHY_SPECS.cameraAngles.low_angle,
    );
  });

  it("returns the exact spec string for 'dutch_angle'", () => {
    expect(getCameraAngleDescription("dutch_angle")).toBe(
      BROADCAST_PHOTOGRAPHY_SPECS.cameraAngles.dutch_angle,
    );
  });

  it("returns the exact spec string for 'profile'", () => {
    expect(getCameraAngleDescription("profile")).toBe(
      BROADCAST_PHOTOGRAPHY_SPECS.cameraAngles.profile,
    );
  });

  it("returns the exact spec string for 'over_shoulder'", () => {
    expect(getCameraAngleDescription("over_shoulder")).toBe(
      BROADCAST_PHOTOGRAPHY_SPECS.cameraAngles.over_shoulder,
    );
  });

  it("returns the exact spec string for 'three_quarter'", () => {
    expect(getCameraAngleDescription("three_quarter")).toBe(
      BROADCAST_PHOTOGRAPHY_SPECS.cameraAngles.three_quarter,
    );
  });
});

// ---------------------------------------------------------------------------
// formatPhotographySpecsForPrompt — composed output
// ---------------------------------------------------------------------------

describe("formatPhotographySpecsForPrompt", () => {
  let result: string;

  beforeEach(() => {
    result = formatPhotographySpecsForPrompt();
  });

  it("returns a non-empty string", () => {
    expect(result).toBeTruthy();
  });

  it("starts with the section heading", () => {
    expect(result.startsWith("# Professional Broadcast Photography Requirements")).toBe(true);
  });

  it("includes the camera type", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.camera.type);
  });

  // All shot-type lens values are present
  it("includes lens spec for 'establishing'", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.camera.lenses.establishing);
  });

  it("includes lens spec for 'wide'", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.camera.lenses.wide);
  });

  it("includes lens spec for 'medium'", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.camera.lenses.medium);
  });

  it("includes lens spec for 'closeup'", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.camera.lenses.closeup);
  });

  it("includes lens spec for 'detail'", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.camera.lenses.detail);
  });

  // Aperture values
  it("includes aperture spec for 'establishing'", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.camera.aperture.establishing);
  });

  it("includes aperture spec for 'medium'", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.camera.aperture.medium);
  });

  it("includes aperture spec for 'closeup'", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.camera.aperture.closeup);
  });

  it("includes aperture spec for 'detail'", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.camera.aperture.detail);
  });

  // Lighting values
  it("includes natural lighting spec", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.lighting.natural);
  });

  it("includes indoor lighting spec", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.lighting.indoor);
  });

  it("includes golden hour lighting spec", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.lighting.golden);
  });

  it("includes overcast lighting spec", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.lighting.overcast);
  });

  it("includes lighting avoid spec", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.lighting.avoid);
  });

  // Composition values
  it("includes rule-of-thirds composition spec", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.composition.ruleOfThirds);
  });

  it("includes headroom composition spec", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.composition.headroom);
  });

  it("includes leading lines composition spec", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.composition.leadingLines);
  });

  it("includes depth composition spec", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.composition.depth);
  });

  it("includes horizon composition spec", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.composition.horizon);
  });

  // Production reality values
  it("includes production reality environment spec", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.productionReality.environments);
  });

  it("includes production reality people spec", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.productionReality.people);
  });

  it("includes production reality movement spec", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.productionReality.movement);
  });

  it("includes production reality lens characteristics spec", () => {
    expect(result).toContain(
      BROADCAST_PHOTOGRAPHY_SPECS.productionReality.lensCharacteristics,
    );
  });

  it("includes production reality focus spec", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.productionReality.focus);
  });

  it("includes production reality imperfections spec", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.productionReality.imperfections);
  });

  // Camera angle descriptions
  it("includes eye_level camera angle description", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.cameraAngles.eye_level);
  });

  it("includes dutch_angle camera angle description", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.cameraAngles.dutch_angle);
  });

  it("includes over_shoulder camera angle description", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.cameraAngles.over_shoulder);
  });

  it("includes three_quarter camera angle description", () => {
    expect(result).toContain(BROADCAST_PHOTOGRAPHY_SPECS.cameraAngles.three_quarter);
  });

  // Avoid AI tells (all entries must appear as list items)
  it("includes every avoidAITells entry as a list item", () => {
    for (const tell of BROADCAST_PHOTOGRAPHY_SPECS.avoidAITells) {
      expect(result).toContain(`- ${tell}`);
    }
  });

  // Reality checks
  it("includes every realityChecks entry as a list item", () => {
    for (const check of BROADCAST_PHOTOGRAPHY_SPECS.realityChecks) {
      expect(result).toContain(`- ${check}`);
    }
  });

  // No trailing whitespace / leading/trailing newlines (trimmed)
  it("does not start or end with whitespace", () => {
    expect(result).toBe(result.trim());
  });

  it("is deterministic — repeated calls return the same string", () => {
    expect(formatPhotographySpecsForPrompt()).toBe(formatPhotographySpecsForPrompt());
  });

  // Section headings
  it("contains the Lighting & Color section heading", () => {
    expect(result).toContain("## Lighting & Color");
  });

  it("contains the Composition & Framing section heading", () => {
    expect(result).toContain("## Composition & Framing");
  });

  it("contains the Production Reality section heading", () => {
    expect(result).toContain("## Production Reality");
  });

  it("contains the Camera Angles section heading", () => {
    expect(result).toContain("## Camera Angles");
  });

  it("contains the AVOID These AI Tells section heading", () => {
    expect(result).toContain("## AVOID These AI Tells");
  });

  it("contains the Reality Checks section heading", () => {
    expect(result).toContain("## Reality Checks");
  });
});

// ---------------------------------------------------------------------------
// formatVisualGuidelinesForPrompt
// ---------------------------------------------------------------------------

describe("formatVisualGuidelinesForPrompt", () => {
  let result: string;

  beforeEach(() => {
    result = formatVisualGuidelinesForPrompt();
  });

  it("returns a non-empty string", () => {
    expect(result).toBeTruthy();
  });

  it("starts with the documentary cinematography heading", () => {
    expect(result.startsWith("# Documentary Cinematography Guidelines")).toBe(true);
  });

  it("does not start or end with whitespace (trimmed)", () => {
    expect(result).toBe(result.trim());
  });

  it("is deterministic — repeated calls return the same string", () => {
    expect(formatVisualGuidelinesForPrompt()).toBe(formatVisualGuidelinesForPrompt());
  });

  // Shot type descriptions present
  it("contains 'Establishing' shot description", () => {
    expect(result).toContain("Establishing:");
  });

  it("contains 'Wide' shot description", () => {
    expect(result).toContain("Wide:");
  });

  it("contains 'Medium' shot description", () => {
    expect(result).toContain("Medium:");
  });

  it("contains 'Medium Closeup' shot description", () => {
    expect(result).toContain("Medium Closeup:");
  });

  it("contains 'Closeup' shot description", () => {
    expect(result).toContain("Closeup:");
  });

  it("contains 'Detail' shot description", () => {
    expect(result).toContain("Detail:");
  });

  it("contains 'Over-shoulder' shot description", () => {
    expect(result).toContain("Over-shoulder:");
  });

  // Shot distribution section
  it("contains the Shot Distribution section heading", () => {
    expect(result).toContain("## Shot Distribution");
  });

  it("embeds the SHOT_TYPES length in the shot distribution heading", () => {
    expect(result).toContain(`${SHOT_TYPES.length} types`);
  });

  it("describes the opening distribution (first 15%)", () => {
    expect(result).toContain("Opening (first 15%)");
  });

  it("describes the development distribution (15-70%)", () => {
    expect(result).toContain("Development (15-70%)");
  });

  it("describes the evidence distribution (70-85%)", () => {
    expect(result).toContain("Evidence (70-85%)");
  });

  it("describes the conclusion distribution (final 15%)", () => {
    expect(result).toContain("Conclusion (final 15%)");
  });

  // Visual continuity section
  it("contains the Visual Continuity section heading", () => {
    expect(result).toContain("## Visual Continuity");
  });

  // Style consistency section
  it("contains the Style Consistency section heading", () => {
    expect(result).toContain("## Style Consistency");
  });
});
