import { redirect } from "next/navigation";

// Old bookmarks no longer open an authenticator enrollment screen.
export default function RemovedAuthenticatorPage() {
  redirect("/login");
}
