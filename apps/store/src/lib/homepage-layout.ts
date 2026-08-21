import type { HomepageSection } from "@curtiz/domain";

const keepSinglePrimaryHero = (
  sections: HomepageSection[]
): HomepageSection[] => {
  if (
    sections.filter((section) => section.sectionType === "banner_hero").length <= 1
  ) {
    return sections;
  }

  let primaryHeroFound = false;
  return sections.filter((section) => {
    if (section.sectionType !== "banner_hero") return true;
    if (primaryHeroFound) return false;
    primaryHeroFound = true;
    return true;
  });
};

export function selectHomepageSections(
  publishedSections: HomepageSection[],
  defaultSections: HomepageSection[],
  hasPublicContent: boolean,
  allowPresentationDefaults: boolean
): HomepageSection[] {
  const selected =
    publishedSections.length > 0
      ? publishedSections
      : hasPublicContent || allowPresentationDefaults
        ? defaultSections
        : [];
  return keepSinglePrimaryHero(selected);
}
