/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [],
  async rewrites() {
    const gateway = process.env.NEXUS_GATEWAY_URL ?? 'http://localhost:8787';
    return [
      { source: '/api/:path*', destination: `${gateway}/:path*` },
    ];
  },
};

export default nextConfig;
