/**
 * O painel e a loja rodam em Workers distintos. Revalidar dados comerciais em
 * toda requisição impede que o edge sirva preço, estoque ou publicação antigos
 * depois que a fonte de verdade no Supabase for alterada.
 */
export const storefrontFreshnessHeaders = {
  "cache-control": "public, max-age=0, s-maxage=0, must-revalidate"
} as const;
