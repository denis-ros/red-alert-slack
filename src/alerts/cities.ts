import { normalizeAreaName } from "../config.js";
import { Logger } from "../util/log.js";

interface ListsVersionsResponse {
  cities?: number;
}

interface CitiesJsonEntry {
  id?: number;
}

interface CitiesJsonResponse {
  cities?: Record<string, CitiesJsonEntry>;
}

export class CityCatalog {
  private constructor(
    private readonly nameById: Map<string, string>,
    private readonly idByNormalizedName: Map<string, string>
  ) {}

  static async load(logger: Logger, fetchImpl: typeof fetch = fetch): Promise<CityCatalog | null> {
    try {
      const versionsResponse = await fetchImpl("https://api.tzevaadom.co.il/lists-versions");
      if (!versionsResponse.ok) {
        logger.warn("Failed to fetch city list versions", { status: versionsResponse.status });
        return null;
      }

      const versions = (await versionsResponse.json()) as ListsVersionsResponse;
      const citiesVersion = versions.cities ?? 9;
      const citiesResponse = await fetchImpl(
        `https://www.tzevaadom.co.il/static/cities.json?v=${citiesVersion}`
      );

      if (!citiesResponse.ok) {
        logger.warn("Failed to fetch cities catalog", { status: citiesResponse.status, citiesVersion });
        return null;
      }

      const citiesJson = (await citiesResponse.json()) as CitiesJsonResponse;
      const cities = citiesJson.cities;
      if (!cities) {
        logger.warn("Cities catalog response did not include cities");
        return null;
      }

      const nameById = new Map<string, string>();
      const idByNormalizedName = new Map<string, string>();

      for (const [cityName, cityInfo] of Object.entries(cities)) {
        if (!Number.isInteger(cityInfo.id)) {
          continue;
        }

        const id = String(cityInfo.id);
        nameById.set(id, cityName);
        idByNormalizedName.set(normalizeAreaName(cityName), id);
      }

      logger.info("Loaded cities catalog", { count: nameById.size, citiesVersion });
      return new CityCatalog(nameById, idByNormalizedName);
    } catch (error) {
      logger.warn("Failed to load cities catalog", {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  resolveArea(area: string): string {
    return this.nameById.get(area) ?? area;
  }

  resolveAreas(areas: string[]): string[] {
    const seen = new Set<string>();
    const resolved: string[] = [];

    for (const area of areas) {
      const mapped = this.resolveArea(area);
      const normalized = normalizeAreaName(mapped);
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      resolved.push(mapped);
    }

    return resolved;
  }

  resolveConfiguredAreaIds(alertAreas: string[]): Set<string> {
    const ids = new Set<string>();
    for (const area of alertAreas) {
      const normalized = normalizeAreaName(area);
      const id = this.idByNormalizedName.get(normalized);
      if (id) {
        ids.add(id);
      }
    }

    return ids;
  }
}

