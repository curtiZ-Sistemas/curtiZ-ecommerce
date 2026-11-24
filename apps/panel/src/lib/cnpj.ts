// CNPJ e CEP: validação e máscaras usadas pela consulta e pela tela de notas de atacado.
export const onlyDigits = (value: string) => value.replace(/\D/gu, "");

export function isValidCnpj(value: string): boolean {
  const digits = onlyDigits(value);
  if (!/^\d{14}$/u.test(digits) || /^(\d)\1{13}$/u.test(digits)) return false;
  const check = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(digits[12]) && check(13) === Number(digits[13]);
}

export function formatCnpj(value: string): string {
  const d = onlyDigits(value).slice(0, 14);
  return d.replace(/^(\d{2})(\d)/u, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/u, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/u, ".$1/$2").replace(/(\d{4})(\d)/u, "$1-$2");
}

export function formatCep(value: string): string {
  const d = onlyDigits(value).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}
