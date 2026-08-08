import type { NextRequest } from "next/server";
import { authorizeAdminRequest } from "./admin-api";

export type LegalPermission =
  | "legal_content.view"
  | "legal_content.create"
  | "legal_content.edit"
  | "legal_content.review"
  | "legal_content.publish"
  | "legal_content.archive"
  | "legal_acceptance.view"
  | "privacy_request.manage"
  | "cookie_settings.manage";

export const legalPermissions: readonly LegalPermission[] = [
  "legal_content.view",
  "legal_content.create",
  "legal_content.edit",
  "legal_content.review",
  "legal_content.publish",
  "legal_content.archive",
  "legal_acceptance.view",
  "privacy_request.manage",
  "cookie_settings.manage"
];

export async function authorizeLegalRequest(request: NextRequest, permission: LegalPermission) {
  const authorization = await authorizeAdminRequest(request, ["admin", "manager"]);
  if (!authorization) return null;
  const permissionResult = await authorization.supabase.rpc("has_legal_permission", {
    p_permission: permission
  });
  return !permissionResult.error && permissionResult.data === true ? authorization : null;
}
