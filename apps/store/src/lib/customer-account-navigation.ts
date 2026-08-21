import {
  Bell,
  CircleUserRound,
  ClipboardCheck,
  Heart,
  MapPin,
  PackageCheck,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Star,
  Tag,
  UserRoundCheck,
  type LucideIcon
} from "lucide-react";

export const customerAccountNavigation = [
  { label: "Visão geral", slug: "visao-geral", Icon: ShoppingBag },
  { label: "Perfil", slug: "perfil", Icon: CircleUserRound },
  { label: "Pedidos", slug: "pedidos", Icon: PackageCheck },
  { label: "Favoritos", slug: "favoritos", Icon: Heart },
  { label: "Avaliações", slug: "avaliacoes", Icon: Star },
  { label: "Cupons", slug: "cupons", Icon: Tag },
  { label: "Endereços", slug: "enderecos", Icon: MapPin },
  { label: "Segurança", slug: "seguranca", Icon: ShieldCheck },
  { label: "Trocas", slug: "trocas", Icon: RotateCcw },
  { label: "Representante", slug: "representante", Icon: UserRoundCheck },
  { label: "Notificações", slug: "notificacoes", Icon: Bell },
  { label: "Atendimento", slug: "atendimento", Icon: ClipboardCheck }
] as const satisfies ReadonlyArray<{
  label: string;
  slug: string;
  Icon: LucideIcon;
}>;

export type CustomerAccountSection =
  (typeof customerAccountNavigation)[number]["slug"];

export function isCustomerAccountSection(
  value: string
): value is CustomerAccountSection {
  return customerAccountNavigation.some(({ slug }) => slug === value);
}

export const customerAccountHref = (section: CustomerAccountSection) =>
  section === "visao-geral" ? "/minha-conta" : `/minha-conta/${section}`;

export const customerAccountSectionTitle = (
  section: CustomerAccountSection
) =>
  customerAccountNavigation.find(({ slug }) => slug === section)?.label ??
  "Minha conta";
