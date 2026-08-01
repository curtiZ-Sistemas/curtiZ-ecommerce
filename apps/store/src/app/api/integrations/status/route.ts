import { getPublicIntegrationStatus } from "@curtiz/config";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getPublicIntegrationStatus(), {
    headers: { "cache-control": "private, no-store" }
  });
}
