export const CUSTOMER_EMAIL_MAX_LENGTH = 120;
export const CPF_DIGIT_LIMIT = 11;
export const CPF_FORMATTED_MAX_LENGTH = 14;
export const PHONE_DIGIT_LIMIT = 11;
export const PHONE_FORMATTED_MAX_LENGTH = 15;
export const POSTAL_CODE_FORMATTED_MAX_LENGTH = 9;

const validBrazilianAreaCodes = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24", "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99"
]);

export const cpfDigits = (value: string) => value.replace(/\D/gu, "");

export const sanitizeCpf = (value: string) => cpfDigits(value).slice(0, CPF_DIGIT_LIMIT);

export const formatCpf = (value: string) => {
  const digits = sanitizeCpf(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

export const isValidCpf = (value: string) => {
  const digits = cpfDigits(value);
  if (/\p{L}/u.test(value) || digits.length !== CPF_DIGIT_LIMIT || /^(\d)\1{10}$/u.test(digits)) {
    return false;
  }

  const calculateDigit = (length: number) => {
    let total = 0;
    for (let index = 0; index < length; index += 1) {
      total += Number(digits[index]) * (length + 1 - index);
    }
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calculateDigit(9) === Number(digits[9]) && calculateDigit(10) === Number(digits[10]);
};

export const phoneDigits = (value: string) => {
  const digits = value.replace(/\D/gu, "");
  return digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2)
    : digits;
};

export const sanitizeBrazilianPhone = (value: string) =>
  phoneDigits(value).slice(0, PHONE_DIGIT_LIMIT);

export const formatBrazilianPhone = (value: string) => {
  const digits = sanitizeBrazilianPhone(value);
  if (digits.length <= 2) return digits ? `(${digits}` : "";
  const areaCode = digits.slice(0, 2);
  const local = digits.slice(2);
  if (local.length <= 4) return `(${areaCode}) ${local}`;
  if (local.length <= 8) return `(${areaCode}) ${local.slice(0, 4)}-${local.slice(4)}`;
  return `(${areaCode}) ${local.slice(0, 5)}-${local.slice(5)}`;
};

export const formatPostalCode = (value: string) => {
  const digits = value.replace(/\D/gu, "").slice(0, 8);
  return digits.replace(/^(\d{5})(\d)/u, "$1-$2");
};

export const isValidBrazilianPhone = (value: string) => {
  const digits = phoneDigits(value);
  if (/\p{L}/u.test(value) || (digits.length !== 10 && digits.length !== 11)) return false;
  if (!validBrazilianAreaCodes.has(digits.slice(0, 2))) return false;
  return digits.length === 10 || digits[2] === "9";
};

export const normalizeBrazilianPhone = (value: string) => {
  const digits = phoneDigits(value);
  return isValidBrazilianPhone(value) ? `+55${digits}` : null;
};

export const isValidCustomerEmail = (value: string) => {
  const email = value.trim();
  return (
    email.length > 0 &&
    email.length <= CUSTOMER_EMAIL_MAX_LENGTH &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
  );
};
