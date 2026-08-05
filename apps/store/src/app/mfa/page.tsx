import { redirect } from "next/navigation";
import { MfaForm } from "@/components/mfa-form";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const allowedDestination = (value: string | undefined): string => {
  const fallback = process.env.NEXT_PUBLIC_PANEL_URL ?? "http://localhost:3001";
  if (!value) return fallback;
  try {
    const candidate = new URL(value);
    const allowed = [process.env.NEXT_PUBLIC_STORE_URL, process.env.NEXT_PUBLIC_PANEL_URL]
      .filter((item): item is string => Boolean(item))
      .map((item) => new URL(item).origin);
    return allowed.includes(candidate.origin) ? candidate.toString() : fallback;
  } catch {
    return fallback;
  }
};

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const supabase = await createServerSupabaseClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!user) redirect("/login");
  const destination = allowedDestination((await searchParams).next);
  return (
    <main className="container page-shell auth-page-shell">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Segurança do acesso</p>
          <h1>Confirme sua identidade</h1>
          <p>Use um código temporário antes de entrar em uma área interna da curti Z.</p>
        </div>
      </div>
      <MfaForm destination={destination} />
    </main>
  );
}

