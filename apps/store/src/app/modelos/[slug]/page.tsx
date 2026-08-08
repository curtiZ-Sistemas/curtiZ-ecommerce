import { notFound } from "next/navigation";
import { ProductCard } from "@/components/product-card";
import { getProductsByModel } from "@/lib/storefront-data";

export const dynamic = "force-dynamic";

export default async function ModelProductsPage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) notFound();
  const products = await getProductsByModel(slug);
  const title = slug.split("-").map((part) => part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : "").join(" ");
  return <main className="section container"><div className="section-heading"><div><p className="eyebrow">Modelo</p><h1>{title}</h1></div></div>{products.length ? <div className="product-grid">{products.map((product, index) => <ProductCard product={product} priority={index < 2} key={product.id} />)}</div> : <div className="empty-state" role="status"><h2>Nenhum produto disponível</h2><p>Este modelo não possui produtos ativos e com estoque no momento.</p></div>}</main>;
}
