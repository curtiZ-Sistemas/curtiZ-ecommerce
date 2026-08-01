export const representativeApplicationStatuses = [
  "draft",
  "submitted",
  "under_review",
  "documents_pending",
  "approved",
  "rejected",
  "suspended",
  "cancelled"
] as const;

export type RepresentativeApplicationStatus = (typeof representativeApplicationStatuses)[number];

export const representativeStatuses = [
  "approved_waiting_kit",
  "active",
  "inactive",
  "unqualified",
  "suspended",
  "cancelled"
] as const;

export type RepresentativeStatus = (typeof representativeStatuses)[number];

export const creativeStatuses = [
  "draft",
  "pending_review",
  "approved",
  "scheduled",
  "published",
  "expired",
  "archived",
  "rejected"
] as const;

export type CreativeStatus = (typeof creativeStatuses)[number];

const applicationTransitions: Record<
  RepresentativeApplicationStatus,
  ReadonlySet<RepresentativeApplicationStatus>
> = {
  draft: new Set(["submitted", "cancelled"]),
  submitted: new Set(["under_review", "cancelled"]),
  under_review: new Set(["documents_pending", "approved", "rejected"]),
  documents_pending: new Set(["submitted", "cancelled"]),
  approved: new Set(["suspended", "cancelled"]),
  rejected: new Set(),
  suspended: new Set(["approved", "cancelled"]),
  cancelled: new Set()
};

export const canTransitionRepresentativeApplication = (
  from: RepresentativeApplicationStatus,
  to: RepresentativeApplicationStatus
): boolean => applicationTransitions[from].has(to);

export type ReferralEdge = { representativeId: string; sponsorId: string };

export const wouldCreateReferralCycle = (
  representativeId: string,
  sponsorId: string,
  relationships: readonly ReferralEdge[]
): boolean => {
  if (representativeId === sponsorId) return true;
  let current: string | undefined = sponsorId;
  const visited = new Set<string>();
  while (current) {
    if (current === representativeId || visited.has(current)) return true;
    visited.add(current);
    current = relationships.find((edge) => edge.representativeId === current)?.sponsorId;
  }
  return false;
};

export type CommissionRuleSnapshot = {
  id: string;
  version: number;
  basisPoints: number;
  maximumInCents?: number;
};

export const calculateCommissionInCents = (
  eligibleAmountInCents: number,
  rule: CommissionRuleSnapshot
): number => {
  if (!Number.isSafeInteger(eligibleAmountInCents) || eligibleAmountInCents < 0) {
    throw new Error("eligible amount must be a non-negative integer");
  }
  if (!Number.isInteger(rule.basisPoints) || rule.basisPoints < 0 || rule.basisPoints > 10_000) {
    throw new Error("basis points must be an integer between 0 and 10000");
  }
  const calculated = Math.floor((eligibleAmountInCents * rule.basisPoints) / 10_000);
  return rule.maximumInCents === undefined ? calculated : Math.min(calculated, rule.maximumInCents);
};

export type RepresentativeArea = "customer" | "representative" | "internal";

export const availableAreasForRoles = (roles: readonly string[]): RepresentativeArea[] => {
  const areas: RepresentativeArea[] = [];
  if (roles.includes("customer") || roles.includes("representative")) areas.push("customer");
  if (roles.includes("representative")) areas.push("representative");
  if (roles.some((role) => ["operational", "admin", "manager", "technical"].includes(role))) {
    areas.push("internal");
  }
  return areas;
};
