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

const placeOccasionsAfterBenefits = (
  sections: HomepageSection[]
): HomepageSection[] => {
  const benefitsIndex = sections.findIndex(
    (section) => section.sectionType === "benefits"
  );
  const occasionsIndex = sections.findIndex(
    (section) =>
      section.sectionType === "categories_grid" &&
      (section.id === "default-categories" ||
        section.title?.trim().toLocaleLowerCase("pt-BR") ===
          "para todos os momentos")
  );

  if (
    benefitsIndex < 0 ||
    occasionsIndex < 0 ||
    occasionsIndex === benefitsIndex + 1
  ) {
    return sections;
  }

  const reordered = [...sections];
  const [occasions] = reordered.splice(occasionsIndex, 1);
  if (!occasions) return sections;

  const updatedBenefitsIndex = reordered.findIndex(
    (section) => section.sectionType === "benefits"
  );
  reordered.splice(updatedBenefitsIndex + 1, 0, occasions);
  return reordered;
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
  return placeOccasionsAfterBenefits(keepSinglePrimaryHero(selected));
}
