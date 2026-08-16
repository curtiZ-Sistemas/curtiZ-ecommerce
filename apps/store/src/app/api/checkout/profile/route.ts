import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readQueryResult, readRows, readString } from "@/lib/unknown-data";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "private, no-store" };

export async function GET() {
  const cookieStore = await cookies();
  const demo = verifyDemoSession(cookieStore.get(DEMO_SESSION_COOKIE)?.value);
  if (demo?.roles.includes("customer")) {
    return NextResponse.json({ profile: null, addresses: [] }, { headers: noStore });
  }

  const supabase = await createServerSupabaseClient();
  const userResult = supabase ? await supabase.auth.getUser() : null;
  const user = userResult?.data.user;
  if (!supabase || !user || userResult?.error) {
    return NextResponse.json({ message: "Entre para continuar." }, { status: 401, headers: noStore });
  }

  const [profile, addresses] = await Promise.all([
    supabase.from("profiles").select("full_name,phone").eq("id", user.id).maybeSingle(),
    supabase
      .from("addresses")
      .select("id,label,recipient_name,postal_code,street,number,complement,district,city,state,is_default")
      .eq("user_id", user.id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(20)
  ]);

  const profileResult = readQueryResult(profile);
  const addressesResult = readQueryResult(addresses);
  if (profileResult.error || addressesResult.error) {
    return NextResponse.json(
      { message: "Não foi possível carregar seus dados salvos." },
      { status: 503, headers: noStore }
    );
  }
  const profileRow = isUnknownRecord(profileResult.data) ? profileResult.data : {};

  return NextResponse.json(
    {
      profile: {
        fullName: readString(profileRow, "full_name"),
        phone: readString(profileRow, "phone"),
        email: user.email ?? ""
      },
      addresses: readRows(addressesResult.data).map((address) => ({
        id: readString(address, "id"),
        label: readString(address, "label"),
        recipientName: readString(address, "recipient_name"),
        postalCode: readString(address, "postal_code"),
        street: readString(address, "street"),
        number: readString(address, "number"),
        complement: readString(address, "complement"),
        district: readString(address, "district"),
        city: readString(address, "city"),
        state: readString(address, "state"),
        isDefault: address.is_default === true
      }))
    },
    { headers: noStore }
  );
}
