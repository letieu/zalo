/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3', 'zca-js'],
  turbopack: {},
};

export default nextConfig;
