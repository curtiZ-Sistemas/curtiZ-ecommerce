import type { HomepageSection } from "@curtiz/domain";

export function selectHomepageSections(
  publishedSections: HomepageSection[],
  defaultSections: HomepageSection[],
  hasPublicContent: boolean,
  allowPresentationDefaults: boolean
): HomepageSection[] {
  if (publishedSections.length > 0) return publishedSections;
  return hasPublicContent || allowPresentationDefaults ? defaultSections : [];
}
