import type { AppRole } from "./types";

export const permissions = [
  "orders.read_assigned",
  "orders.read_all",
  "orders.update_operational_status",
  "orders.cancel",
  "orders.partial_cancel",
  "orders.split_shipment",
  "orders.manual_review",
  "products.read",
  "products.create",
  "products.update",
  "products.archive",
  "products.manage_cost",
  "inventory.read",
  "inventory.adjust",
  "inventory.approve_adjustment",
  "inventory.suppliers_manage",
  "inventory.purchase_orders_manage",
  "inventory.audit_manage",
  "support.quick_answers.read",
  "support.quick_answers.manage",
  "support.conversations.read",
  "support.conversations.assign",
  "support.conversations.reply",
  "support.conversations.transfer",
  "support.conversations.escalate",
  "support.internal_notes.create",
  "support.close",
  "support.reopen",
  "support.reports.read",
  "support.sla.manage",
  "returns.read",
  "returns.manage",
  "returns.approve",
  "returns.inspect",
  "returns.refund",
  "financial.read_summary",
  "financial.read_full",
  "finance.reconcile",
  "finance.close_period",
  "finance.reopen_period",
  "promotions.advanced_manage",
  "promotions.approve",
  "marketing.manage",
  "marketing.segments",
  "marketing.automations",
  "reviews.reply",
  "reviews.questions_manage",
  "cms.manage",
  "redirects.manage",
  "users.create_internal",
  "users.read",
  "users.access.manage_client",
  "users.access.manage_admin",
  "users.access.manage_operator",
  "users.access.manage_technical",
  "audit.read",
  "technical.health.read",
  "technical.logs.read",
  "technical.integrations.manage",
  "erp.manage",
  "whatsapp.manage",
  "antifraud.read",
  "antifraud.review",
  "antifraud.decide",
  "representatives.application.create",
  "representatives.application.review",
  "representatives.read_own",
  "representatives.read_all",
  "representatives.manage",
  "representatives.network.manage",
  "representatives.rules.manage",
  "representatives.kits.fulfill",
  "representatives.sales.create_own",
  "representatives.commissions.read_own",
  "representatives.commissions.read_all",
  "representatives.commissions.close",
  "creatives.read_published",
  "creatives.manage",
  "creatives.approve",
  "creatives.publish",
  "creatives.metrics.read"
] as const;

export type Permission = (typeof permissions)[number];

const matrix: Record<AppRole, ReadonlySet<Permission>> = {
  customer: new Set(),
  representative: new Set([
    "products.read",
    "representatives.read_own",
    "representatives.sales.create_own",
    "representatives.commissions.read_own",
    "creatives.read_published",
    "support.quick_answers.read",
    "support.conversations.read",
    "support.conversations.reply"
  ]),
  operational: new Set([
    "orders.read_assigned",
    "orders.update_operational_status",
    "inventory.read",
    "returns.read",
    "support.quick_answers.read",
    "support.conversations.read",
    "support.conversations.reply",
    "representatives.kits.fulfill"
  ]),
  admin: new Set(
    permissions.filter(
      (permission) =>
        !permission.startsWith("financial.read_full") &&
        !permission.startsWith("finance.close") &&
        !permission.startsWith("finance.reopen") &&
        !permission.startsWith("technical.") &&
        !permission.startsWith("users.access.") &&
        permission !== "representatives.commissions.close" &&
        permission !== "representatives.commissions.read_all"
    )
  ),
  manager: new Set(
    permissions.filter(
      (permission) =>
        !permission.startsWith("technical.integrations") &&
        permission !== "users.access.manage_technical" &&
        permission !== "whatsapp.manage"
    )
  ),
  technical: new Set(
    permissions.filter(
      (permission) =>
        permission.startsWith("technical.") ||
        permission === "users.read" ||
        permission === "users.access.manage_technical" ||
        permission === "audit.read" ||
        permission === "erp.manage" ||
        permission === "whatsapp.manage" ||
        permission === "support.conversations.read" ||
        permission === "support.conversations.reply" ||
        permission === "representatives.read_all"
    )
  )
};

export const roleHasPermission = (role: AppRole, permission: Permission): boolean =>
  matrix[role].has(permission);
