export function categoryDeletionMessage(productCount: number, subcategoryCount: number) {
  if (productCount > 0) {
    return `Esta categoria está sendo usada por ${productCount} ${productCount === 1 ? "produto" : "produtos"}. Mova os produtos para outra categoria antes de excluí-la.`;
  }
  if (subcategoryCount > 0) {
    return `Esta categoria possui ${subcategoryCount} ${subcategoryCount === 1 ? "subcategoria vinculada" : "subcategorias vinculadas"}. Reorganize-as antes de excluir.`;
  }
  return null;
}
