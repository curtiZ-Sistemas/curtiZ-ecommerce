const privateConcept = /secret|password|private|accesstoken|refreshtoken|servicerole|encryption|credential/iu;

export const prohibitedPublicName = (name: string): boolean => name.startsWith("NEXT_PUBLIC_")
  && (privateConcept.test(name.slice(12).replace(/[^a-z0-9]/giu, "")) || name.startsWith("NEXT_PUBLIC_SUPABASE_"));

export const publicEnvironmentErrors = (environment: Readonly<Record<string, string | undefined>>): string[] =>
  Object.keys(environment).filter(prohibitedPublicName).map((name) => `${name}: configuração proibida no navegador`);
