/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Performance: reduce bundle size by tree-shaking heavy libraries
  experimental: {
    optimizePackageImports: ["lucide-react", "@xyflow/react", "framer-motion"],
  },
  // Headers: Origin-Agent-Cluster forces Chrome to use separate processes per tab
  // This prevents one heavy tab from blocking others
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Origin-Agent-Cluster", value: "?1" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
