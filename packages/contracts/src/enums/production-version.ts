import { z } from "zod";

/**
 * Production Version Enum
 *
 * Controls composition complexity during rendering.
 *
 * - V1: Clean Layout — full-screen Ken Burns + avatar PIP + clean captions only
 * - V2: Parametric Biome-Based — layouts persist in stretches (biomes) with procedural variety
 * - V3: Future — SVG data animations, real footage, advanced generation (not yet implemented)
 */
export const ProductionVersion = z.enum([
  "V1",
  "V2",
  "V3",
]);

export type ProductionVersion = z.infer<typeof ProductionVersion>;
