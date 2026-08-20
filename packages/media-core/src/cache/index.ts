/**
 * Content-addressed caching primitives.
 *
 * Directory-local barrel. The package barrel (`src/index.ts`) is owned by
 * another task and re-exports from here.
 */

export {
  canonicalStringify,
  isJsonValue,
  CanonicalJsonError,
  type JsonPrimitive,
  type JsonValue,
} from "./canonical-json.js";

export {
  computeCacheKey,
  createSegmentCache,
  getSegmentCache,
  selectEvictions,
  SegmentCache,
  SegmentCacheError,
  SegmentCacheIntegrityError,
  type EvictionPlan,
  type ProducedSegment,
  type SegmentCacheEntry,
  type SegmentCacheListing,
  type SegmentCacheOptions,
  type SegmentCacheOrphans,
  type SegmentCacheResult,
  type SegmentCacheSpec,
  type SegmentCacheStats,
  type SegmentProduceContext,
  type SegmentSidecar,
  type SegmentStoreMeta,
} from "./segment-cache.js";
