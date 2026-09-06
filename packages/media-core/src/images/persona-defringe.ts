export interface PersonaDefringeOptions {
  /** Number of foreground pixels treated as part of the keyed edge. */
  edgeRadius?: number;
  /** Alpha values at or below this number are treated as transparent noise. */
  transparentAlpha?: number;
  /** Upper portion where keyed hair spill may extend farther than the edge. */
  hairRegionRatio?: number;
}

function foregroundDistance(
  rgba: Uint8Array,
  width: number,
  height: number,
  transparentAlpha: number,
  limit: number,
): Uint8Array {
  const count = width * height;
  const distance = new Uint8Array(count);
  distance.fill(limit);
  for (let index = 0; index < count; index += 1) {
    if (rgba[index * 4 + 3]! <= transparentAlpha) distance[index] = 0;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      let value = distance[index]!;
      if (x > 0) value = Math.min(value, distance[index - 1]! + 1);
      if (y > 0) value = Math.min(value, distance[index - width]! + 1);
      distance[index] = Math.min(limit, value);
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      let value = distance[index]!;
      if (x + 1 < width) value = Math.min(value, distance[index + 1]! + 1);
      if (y + 1 < height) value = Math.min(value, distance[index + width]! + 1);
      distance[index] = Math.min(limit, value);
    }
  }
  return distance;
}

/**
 * Remove the green/cyan matte left by keyed persona PNGs without globally
 * desaturating green clothes. Contaminated edge colours are replaced by the
 * nearest real foreground colours; this preserves hair texture and skin tone
 * much better than turning every green-dominant pixel transparent.
 */
export function defringePersonaRgba(
  input: Uint8Array,
  width: number,
  height: number,
  options: PersonaDefringeOptions = {},
): Uint8Array {
  if (width <= 0 || height <= 0 || input.length !== width * height * 4) {
    throw new Error("Persona RGBA dimensions do not match the supplied buffer");
  }

  const edgeRadius = Math.max(1, Math.min(16, options.edgeRadius ?? 7));
  const transparentAlpha = Math.max(
    0,
    Math.min(32, options.transparentAlpha ?? 8),
  );
  const hairRegionRatio = Math.max(
    0.2,
    Math.min(0.75, options.hairRegionRatio ?? 0.36),
  );
  const output = new Uint8Array(input);
  const count = width * height;
  const distance = foregroundDistance(
    output,
    width,
    height,
    transparentAlpha,
    edgeRadius + 1,
  );
  const contaminated = new Uint8Array(count);
  const resolved = new Uint8Array(count);
  const exteriorHairMatte = new Uint8Array(count);

  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    const alpha = output[offset + 3]!;
    if (alpha <= transparentAlpha) {
      output[offset + 3] = 0;
      continue;
    }
    const red = output[offset]!;
    const green = output[offset + 1]!;
    const blue = output[offset + 2]!;
    const row = Math.floor(index / width);
    const keyedGreen =
      green >= 38 &&
      (green - Math.max(red, blue) >= 10 ||
        (Math.min(green, blue) - red >= 16 && green >= blue * 0.72));
    const inHairRegion = row < height * hairRegionRatio;
    const onKeyedEdge = distance[index]! <= edgeRadius;
    if (keyedGreen && (inHairRegion || onKeyedEdge)) {
      contaminated[index] = 1;
    } else {
      resolved[index] = 1;
    }
  }

  // Green-screen patches caught between hair strands are often fully opaque,
  // so alpha-distance alone cannot identify them. Flood keyed pixels inward
  // from the transparent boundary, but only inside the head/hair region.
  const queue: number[] = [];
  const hairLimit = Math.floor(height * hairRegionRatio);
  for (let y = 0; y < hairLimit; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (contaminated[index] && distance[index]! <= edgeRadius) {
        exteriorHairMatte[index] = 1;
        queue.push(index);
      }
    }
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor]!;
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = y + dy;
      if (ny < 0 || ny >= hairLimit) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        const neighbor = ny * width + nx;
        if (contaminated[neighbor] && !exteriorHairMatte[neighbor]) {
          exteriorHairMatte[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
  }
  for (let index = 0; index < count; index += 1) {
    if (!exteriorHairMatte[index]) continue;
    output[index * 4 + 3] = 0;
    contaminated[index] = 0;
  }

  // Grow real foreground colours into the contaminated matte. Reading the
  // previous pass and applying changes afterwards keeps propagation symmetric.
  for (let pass = 0; pass < 24; pass += 1) {
    const updates: Array<[number, number, number, number]> = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!contaminated[index] || resolved[index]) continue;
        let red = 0;
        let green = 0;
        let blue = 0;
        let weight = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const neighbor = ny * width + nx;
            if (!resolved[neighbor]) continue;
            const neighborOffset = neighbor * 4;
            const alpha = output[neighborOffset + 3]!;
            if (alpha <= transparentAlpha) continue;
            const sampleWeight = alpha / 255;
            red += output[neighborOffset]! * sampleWeight;
            green += output[neighborOffset + 1]! * sampleWeight;
            blue += output[neighborOffset + 2]! * sampleWeight;
            weight += sampleWeight;
          }
        }
        if (weight > 0) {
          updates.push([
            index,
            Math.round(red / weight),
            Math.round(green / weight),
            Math.round(blue / weight),
          ]);
        }
      }
    }
    if (updates.length === 0) break;
    for (const [index, red, green, blue] of updates) {
      const offset = index * 4;
      output[offset] = red;
      output[offset + 1] = green;
      output[offset + 2] = blue;
      resolved[index] = 1;
    }
  }

  // Very thick keyed patches may not reach a valid neighbour in 24 passes.
  // Neutralise those rare leftovers instead of leaving a visible green island.
  for (let index = 0; index < count; index += 1) {
    if (!contaminated[index] || resolved[index]) continue;
    const offset = index * 4;
    const red = output[offset]!;
    const blue = output[offset + 2]!;
    const neutral = Math.round((red + blue) / 2);
    output[offset + 1] = neutral;
    output[offset + 2] = Math.round((blue + neutral) / 2);
  }

  // The outer keyed pixels are background, not hair detail. Feather them out
  // after their colour has been repaired so no cyan one-pixel contour survives
  // against a bright office photograph.
  for (let index = 0; index < count; index += 1) {
    if (!contaminated[index]) continue;
    const edgeDistance = distance[index]!;
    const offset = index * 4;
    if (edgeDistance <= 1) output[offset + 3] = 0;
    else if (edgeDistance === 2)
      output[offset + 3] = Math.round(output[offset + 3]! * 0.35);
    else if (edgeDistance === 3)
      output[offset + 3] = Math.round(output[offset + 3]! * 0.7);
  }

  return output;
}
