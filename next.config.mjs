/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // googleapis is server-only; keep it out of the client bundle.
  serverExternalPackages: ["googleapis"],
};

export default nextConfig;
