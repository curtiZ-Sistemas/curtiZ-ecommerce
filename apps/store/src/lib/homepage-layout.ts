import type { HomepageSection } from "@curtiz/domain";

const keepSinglePrimaryHero = (sections: HomepageSection[]): HomepageSection[] => {
  if (sections.filter((section) => section.sectionType === "banner_hero").length <= 1) {
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

export const orderHomepageSections = (sections: HomepageSection[]): HomepageSection[] => {
  const rank = (section: HomepageSection) => {
    if (section.sectionType === "banner_hero") return 0;
    if (section.sectionType === "categories_grid") return 2;
    if (["image_text", "image_links", "image_mosaic", "video", "banner_secondary"].includes(section.sectionType)) return 3;
    if (section.sectionType === "launches") return 4;
    if (section.sectionType === "reviews_carousel") return 5;
    if (section.sectionType === "benefits") return 6;
    if (section.sectionType === "recommended_products") return 7;
    return 1;
  };
  const ordered = [...sections].sort((left, right) => rank(left) - rank(right));
  return ordered.every((section, index) => section === sections[index]) ? sections : ordered;
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
  return orderHomepageSections(keepSinglePrimaryHero(selected));
}
