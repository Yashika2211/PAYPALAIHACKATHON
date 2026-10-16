import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Keeps screen recordings and demos clean.
  devIndicators: false,
  partialPrefetching: true,
  experimental: {
    // Haggle's app screens are live, per-request views (negotiations, settlement), so we only
    // validate instant navigation on segments that explicitly export `instant`.
    instantInsights: { validationLevel: "manual-warning" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
