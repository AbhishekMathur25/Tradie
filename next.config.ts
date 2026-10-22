import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a WebAssembly build of Postgres; it must be loaded from
  // node_modules at runtime rather than bundled by webpack.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
