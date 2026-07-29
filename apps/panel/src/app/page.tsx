import { redirect } from "next/navigation";

export default function PanelEntry() {
  const storeUrl = process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000";
  redirect(`${storeUrl}/login`);
}
