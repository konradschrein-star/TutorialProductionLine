/**
 * Asset Metadata Utilities
 *
 * Fetches metadata from database assets and generates suggestions
 * for auto-population of job fields.
 */

export interface AssetMetadata {
  name: string;
  description?: string;
}

/**
 * Fetch character metadata by ID
 */
export async function fetchCharacterMetadata(id: string): Promise<AssetMetadata | null> {
  try {
    const response = await fetch(`/api/assets/characters?ids=${id}`);
    if (!response.ok) return null;

    const data = await response.json();
    const character = data.assets?.find((a: any) => a.id === id);

    if (!character) return null;

    return {
      name: character.name,
      description: character.description,
    };
  } catch (err) {
    console.warn('Failed to fetch character metadata:', err);
    return null;
  }
}

/**
 * Fetch environment metadata by ID
 */
export async function fetchEnvironmentMetadata(id: string): Promise<AssetMetadata | null> {
  try {
    const response = await fetch(`/api/assets/environments?ids=${id}`);
    if (!response.ok) return null;

    const data = await response.json();
    const environment = data.assets?.find((a: any) => a.id === id);

    if (!environment) return null;

    return {
      name: environment.name,
      description: environment.description,
    };
  } catch (err) {
    console.warn('Failed to fetch environment metadata:', err);
    return null;
  }
}

/**
 * Suggest a topic based on attached assets
 *
 * Rules:
 * - Single character: use character name
 * - Character + environment: "CharacterName in EnvironmentName"
 * - Multiple characters: "CharacterName1 and CharacterName2"
 * - Environment only: use environment name
 */
export function suggestTopicFromAssets(
  characterNames: string[],
  environmentName?: string
): string {
  if (characterNames.length === 0 && !environmentName) {
    return '';
  }

  // Single character
  if (characterNames.length === 1 && !environmentName) {
    return characterNames[0];
  }

  // Character(s) + environment
  if (characterNames.length > 0 && environmentName) {
    const charPart = characterNames.length === 1
      ? characterNames[0]
      : `${characterNames[0]} and ${characterNames[1]}${characterNames.length > 2 ? ' & others' : ''}`;
    return `${charPart} in ${environmentName}`;
  }

  // Multiple characters only
  if (characterNames.length > 1 && !environmentName) {
    return `${characterNames[0]} and ${characterNames[1]}${characterNames.length > 2 ? ' & others' : ''}`;
  }

  // Environment only
  if (environmentName) {
    return environmentName;
  }

  return '';
}
