import { createRequire } from "node:module";
import path from "node:path";
import { config as loadEnv } from "dotenv";
// Load .env from monorepo root at BUILD TIME.
// Next.js bakes process.env.X references into the Edge Runtime middleware bundle
// at compile time. Without this, vars only loaded by the custom server at runtime
// (src/server/index.ts) are absent in the built middleware, causing JWT verification
// to use an empty secret and redirect every request to /login.
loadEnv({ path: "../../.env" });

// ---------------------------------------------------------------------------
// SINGLE `remotion` INSTANCE (subtitle previews depend on this).
//
// pnpm gives every package its own peer-resolved copy of `remotion`. hub-web
// (React 19) resolves `remotion@…_react@19`, but `@repo/media-core` dev-depends
// on React 18 and therefore ships `packages/media-core/node_modules/remotion`
// (the `…_react@18` copy). Webpack resolves bare `remotion` imports relative to
// the importing FILE, so <Captions>/<CaptionOverlay> (shipped from media-core's
// dist) were binding to a DIFFERENT remotion module instance than the
// <Player> that renders them. Remotion's TimelineContext lives inside the
// module instance, so `useCurrentFrame()` found no provider and threw
// "useCurrentFrame can only be called inside a component that was passed to
// <Player>" — every subtitle preview on /subtitles and /subtitles/[id] was dead.
//
// Forcing one physical copy fixes it for the whole browser bundle.
const requireFromHere = createRequire(import.meta.url);
const remotionDir = path.dirname(
  requireFromHere.resolve("remotion/package.json"),
);
// NOTE ON `react`/`react-dom`: do NOT add them to resolve.alias. A blanket alias
// to one physical directory bypasses the export CONDITIONS Next 15 relies on for
// React Server Components (server components resolve `react` under the
// `react-server` condition, client components under the default one). Forcing a
// single dir hands server components the client React and throws
// "Invalid hook call … more than one copy of React" on every page. The single
// React copy is instead kept correct by media-core peering React (optional) and
// pnpm hoisting; the dedupe that actually broke previews is `remotion`, whose
// TimelineContext lives in the module instance — that one is safe to pin.

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    // NOTE: resolve.alias is WEBPACK-ONLY. Adding `--turbopack` to the dev/build
    // script silently ignores this and the duplicate-remotion bug returns with
    // no error. The single-instance guard test asserts this alias stays set.
    config.resolve.alias = { ...config.resolve.alias, remotion: remotionDir };
    return config;
  },

  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },

  // Transpile workspace packages
  transpilePackages: [
    "@repo/cf-api",
    "@repo/contracts",
    "@repo/config",
    "@repo/db",
    "@repo/domain",
    "@repo/media-core",
    "@repo/queue",
  ],

  // Disable x-powered-by header for security
  poweredByHeader: false,

  // Exclude native modules from webpack bundling
  serverExternalPackages: ["pg", "pg-listen"],

  // Enable server actions and allow large file uploads
  experimental: {
    // Route Handler body limit (recording uploads can be 500MB+)
    middlewareClientMaxBodySize: 2 * 1024 * 1024 * 1024,
    serverActions: {
      allowedOrigins: ["localhost:3000", "65.108.6.149:3000"],
      bodySizeLimit: "10gb", // Video stitcher needs large uploads (tutorial videos can be very long)
    },
  },

  // Image optimization configuration
  images: {
    domains: [],
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
