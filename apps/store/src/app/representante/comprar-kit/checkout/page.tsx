import { RepresentativeKitCheckout } from "@/components/representative-kit-checkout";
import { RepresentativePortal } from "@/components/representative-portal";

export const metadata = {
  title: "Finalizar compra do kit",
  robots: { index: false, follow: false }
};
export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function RepresentativeKitCheckoutPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const kit = first(query.kit);
  const template = first(query.ficha);
  const quantity = Number(first(query.qtd) || "1");
  return (
    <RepresentativePortal section="comprar-kit">
      <RepresentativeKitCheckout kitId={uuid.test(kit) ? kit : ""} template={template}
        quantity={Number.isInteger(quantity) && quantity >= 1 ? Math.min(quantity, 99) : 1} />
    </RepresentativePortal>
  );
}
