import type { NextConfig } from "next";
import path from "node:path";

const developmentScriptPolicy = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self)"
  },
  {
    key: "Content-Security-Policy",
    value:
      `default-src 'self'; img-src 'self' data: blob: https://*.supabase.co; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'${developmentScriptPolicy}; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.mercadopago.com; frame-src https://www.mercadopago.com.br; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
  }
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: path.resolve(process.cwd(), "../..") },
  transpilePackages: ["@curtiz/domain", "@curtiz/integrations", "@curtiz/security", "@curtiz/config"],
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }]
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  }
};

export default nextConfig;
