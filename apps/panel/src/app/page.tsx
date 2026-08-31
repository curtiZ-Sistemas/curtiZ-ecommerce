import { redirect } from "next/navigation";
import { requestPublicAppUrls } from "@/lib/request-public-urls";

export default async function PanelEntry() {
  const { storeUrl } = await requestPublicAppUrls();
  redirect(`${storeUrl}/login`);
}
