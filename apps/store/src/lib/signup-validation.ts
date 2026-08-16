import { z } from "zod";
import {
  CUSTOMER_EMAIL_MAX_LENGTH,
  formatBrazilianPhone,
  isValidBrazilianPhone,
  normalizeBrazilianPhone,
  phoneDigits
} from "./personal-data";

export { formatBrazilianPhone, isValidBrazilianPhone, normalizeBrazilianPhone, phoneDigits };

const commonPasswords = new Set([
  "123456",
  "654321",
  "abc123",
  "abcdef",
  "qwerty",
  "111111",
  "aaaaaa",
  "senha1",
  "password1",
  "1234567890"
]);

const nameCharacterPattern = /[^\p{L}\s'-]/gu;

const capitalizeNamePart = (value: string) =>
  value
    .split(/([ '-])/u)
    .map((part) =>
      /^[\p{L}]/u.test(part)
        ? `${part.charAt(0).toLocaleUpperCase("pt-BR")}${part
            .slice(1)
            .toLocaleLowerCase("pt-BR")}`
        : part
    )
    .join("");

export const normalizeFullName = (value: string) =>
  value
    .replace(nameCharacterPattern, "")
    .replace(/\s+/gu, " ")
    .trimStart()
    .split(" ")
    .map(capitalizeNamePart)
    .join(" ");

export const normalizeEmail = (value: string) =>
  value.replace(/\s+/gu, "").trim().toLocaleLowerCase("pt-BR");

const compactIdentityValue = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/giu, "")
    .toLocaleLowerCase("pt-BR");

const containsObviousSequence = (password: string) => {
  const normalized = password.toLocaleLowerCase("pt-BR");
  const sequences = [
    "0123456789",
    "9876543210",
    "abcdefghijklmnopqrstuvwxyz",
    "zyxwvutsrqponmlkjihgfedcba",
    "qwertyuiop",
    "poiuytrewq"
  ];
  return (
    commonPasswords.has(normalized) ||
    /(.)\1{4,}/u.test(normalized) ||
    sequences.some((sequence) => {
      for (let index = 0; index <= normalized.length - 4; index += 1) {
        if (sequence.includes(normalized.slice(index, index + 4))) return true;
      }
      return false;
    })
  );
};

export type PasswordAssessment = {
  minimumLength: boolean;
  hasLetter: boolean;
  hasNumber: boolean;
  noObviousSequence: boolean;
  differsFromPersonalData: boolean;
  valid: boolean;
  score: number;
};

export const assessPassword = (
  password: string,
  personalData: { name?: string; email?: string; phone?: string } = {}
): PasswordAssessment => {
  const compactPassword = compactIdentityValue(password);
  const personalValues = [personalData.name, personalData.email?.split("@")[0], personalData.phone]
    .filter((value): value is string => Boolean(value))
    .map(compactIdentityValue)
    .filter((value) => value.length >= 4);
  const assessment = {
    minimumLength: password.length >= 6,
    hasLetter: /\p{L}/u.test(password),
    hasNumber: /\d/u.test(password),
    noObviousSequence: !containsObviousSequence(password),
    differsFromPersonalData: !personalValues.some(
      (value) => compactPassword === value || compactPassword.includes(value)
    )
  };
  const score = Object.values(assessment).filter(Boolean).length;
  return { ...assessment, valid: score === 5, score };
};

const signupRawSchema = z.object({
  name: z.string().max(120),
  email: z.string().max(CUSTOMER_EMAIL_MAX_LENGTH),
  phone: z.string().max(20),
  password: z.string().min(6).max(256),
  confirmPassword: z.string().max(256),
  terms: z.literal("on"),
  marketing: z.string().optional(),
  next: z.string().max(300).optional(),
  turnstileToken: z.string().max(4_096).optional()
}).strict();

export type NormalizedSignupInput = {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  terms: "on";
  marketing?: string;
  next?: string;
  turnstileToken?: string;
};

export const parseSignupInput = (payload: unknown) => {
  const raw = signupRawSchema.safeParse(payload);
  if (!raw.success) return raw;

  const name = normalizeFullName(raw.data.name).trim();
  const email = normalizeEmail(raw.data.email);
  const phone = normalizeBrazilianPhone(raw.data.phone);
  const nameWords = name.split(/\s+/u).filter(Boolean);
  const password = assessPassword(raw.data.password, {
    name,
    email,
    phone: raw.data.phone
  });

  const issues: Array<{ path: string[]; message: string }> = [];
  if (
    /[^\p{L}\s'-]/u.test(raw.data.name) ||
    nameWords.length < 2 ||
    !/^[\p{L}]+(?:[ '-][\p{L}]+)+(?:[ '-][\p{L}]+)*$/u.test(name)
  ) {
    issues.push({ path: ["name"], message: "Informe nome e sobrenome usando apenas letras." });
  }
  if (!z.string().email().safeParse(email).success) {
    issues.push({ path: ["email"], message: "Informe um e-mail válido." });
  }
  if (!phone || !isValidBrazilianPhone(raw.data.phone)) {
    issues.push({ path: ["phone"], message: "Informe um telefone válido com DDD." });
  }
  if (!password.valid) {
    issues.push({ path: ["password"], message: "A senha não atende aos requisitos de segurança." });
  }
  if (raw.data.password !== raw.data.confirmPassword) {
    issues.push({ path: ["confirmPassword"], message: "As senhas não coincidem." });
  }

  if (issues.length) {
    return {
      success: false as const,
      error: new z.ZodError(
        issues.map((issue) => ({
          code: "custom" as const,
          path: issue.path,
          message: issue.message
        }))
      )
    };
  }

  return {
    success: true as const,
    data: {
      ...raw.data,
      name,
      email,
      phone: phone!
    } satisfies NormalizedSignupInput
  };
};
