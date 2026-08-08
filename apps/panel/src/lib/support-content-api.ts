import type { NextRequest } from "next/server";
import { authorizeAdminRequest } from "./admin-api";

export type SupportContentPermission =
  | "support_content.view"
  | "support_content.create"
  | "support_content.edit"
  | "support_content.review"
  | "support_content.publish"
  | "support_settings.manage";

export const supportContentPermissions: readonly SupportContentPermission[] = [
  "support_content.view",
  "support_content.create",
  "support_content.edit",
  "support_content.review",
  "support_content.publish",
  "support_settings.manage"
];

export async function authorizeSupportContentRequest(
  request: NextRequest,
  permission: SupportContentPermission
) {
  const authorization = await authorizeAdminRequest(request, ["admin", "manager", "operational"]);
  if (!authorization) return null;
  const permissionResult = await authorization.supabase.rpc("has_support_permission", {
    p_permission: permission
  });
  return !permissionResult.error && permissionResult.data === true ? authorization : null;
}
