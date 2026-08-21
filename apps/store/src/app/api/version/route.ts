import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      app: "store",
      environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown",
      commit: process.env.GIT_COMMIT_SHA ?? "unknown",
      build: process.env.BUILD_ID ?? "unknown",
      builtAt: process.env.BUILD_TIMESTAMP ?? null
    },
    { headers: { "cache-control": "no-store" } }
  );
}
