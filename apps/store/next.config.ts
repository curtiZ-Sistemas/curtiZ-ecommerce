import type { NextConfig } from "next";
import path from "node:path";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self)"
  },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : [])
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: path.resolve(process.cwd(), "../..") },
  transpilePackages: ["@curtiz/domain", "@curtiz/integrations", "@curtiz/security", "@curtiz/config"],
  images: {
    // O runtime OpenNext atual não transforma os bytes em /_next/image. Entregar as
    // variantes já otimizadas evita baixar o original mais de uma vez com URLs distintas.
    unoptimized: true,
    formats: ["image/avif", "image/webp"],
    deviceSizes: [360, 430, 640, 768, 1024, 1280, 1600],
    imageSizes: [32, 48, 64, 96, 128, 256, 384],
    qualities: [75],
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }]
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  }
};

export default nextConfig;
