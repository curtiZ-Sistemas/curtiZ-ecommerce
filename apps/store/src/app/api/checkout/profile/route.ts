import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CheckoutIdentityError, readCustomerCheckoutCpf } from "../../../../lib/checkout-identity";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
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

  const profileResult = readQueryResult(
    await supabase.from("profiles").select("full_name,phone,status,account_closed_at")
      .eq("id", user.id).maybeSingle()
  );
  if (profileResult.error) {
    return NextResponse.json(
      { message: "Não foi possível carregar seus dados salvos." },
      { status: 503, headers: noStore }
    );
  }
  const profileRow = profileResult.data;
  if (!isUnknownRecord(profileRow) || profileRow.status !== "active" || profileRow.account_closed_at !== null) {
    return NextResponse.json({ message: "Conta indisponível." }, { status: 403, headers: noStore });
  }

  const identityDb = createServiceSupabaseClient();
  if (!identityDb) {
    return NextResponse.json(
      { message: "Não foi possível carregar seus dados salvos." },
      { status: 503, headers: noStore }
    );
  }
  let verifiedCpfLastFour = "";
  try {
    verifiedCpfLastFour = (await readCustomerCheckoutCpf(identityDb, user.id)).slice(-4);
  } catch (error) {
    if (!(error instanceof CheckoutIdentityError) || error.code !== "CUSTOMER_IDENTITY_REQUIRED") {
      return NextResponse.json(
        { message: "Não foi possível carregar seus dados salvos." },
        { status: 503, headers: noStore }
      );
    }
  }

  const addressesResult = readQueryResult(
    await supabase
      .from("addresses")
      .select("id,label,recipient_name,postal_code,street,number,complement,district,city,state,is_default")
      .eq("user_id", user.id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(3)
  );
  if (addressesResult.error) {
    return NextResponse.json(
      { message: "Não foi possível carregar seus dados salvos." },
      { status: 503, headers: noStore }
    );
  }
  return NextResponse.json(
    {
      profile: {
        fullName: readString(profileRow, "full_name"),
        phone: readString(profileRow, "phone"),
        cpfConfigured: Boolean(verifiedCpfLastFour),
        cpfLastFour: verifiedCpfLastFour,
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
