import { RepresentativePortal } from "@/components/representative-portal";

export const metadata = {
  title: "Portal da representante",
  robots: { index: false, follow: false }
};
export const dynamic = "force-dynamic";

export default async function RepresentativePortalPage({
  params
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const section = (await params).section?.[0] ?? "";
  return <RepresentativePortal section={section} />;
}
