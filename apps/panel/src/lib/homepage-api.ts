import type { NextRequest } from "next/server";
import { authorizeAdminRequest } from "./admin-api";

export type HomepagePermission =
  | "homepage.view"
  | "homepage.create"
  | "homepage.edit"
  | "homepage.review"
  | "homepage.publish"
  | "homepage.lock"
  | "homepage.media.manage"
  | "homepage.metrics.read"
  | "homepage.audit.read";

export const homepagePermissions: readonly HomepagePermission[] = [
  "homepage.view",
  "homepage.create",
  "homepage.edit",
  "homepage.review",
  "homepage.publish",
  "homepage.lock",
  "homepage.media.manage",
  "homepage.metrics.read",
  "homepage.audit.read"
];

export async function authorizeHomepageRequest(
  request: NextRequest,
  permission: HomepagePermission
) {
  const authorization = await authorizeAdminRequest(request, ["admin", "manager", "operational"]);
  if (!authorization) return null;
  const result = await authorization.supabase.rpc("has_homepage_permission", {
    p_permission: permission
  });
  return !result.error && result.data === true ? authorization : null;
}
