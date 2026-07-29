import { randomBytes } from "node:crypto";

if (process.env.NODE_ENV === "production") {
  throw new Error("O seed de demonstração é bloqueado em produção.");
}

const password = process.env.DEMO_USERS_PASSWORD ?? randomBytes(18).toString("base64url");
const users = ["cliente", "operacional", "admin", "gerencia", "tecnico"];

console.log("Contas que serão criadas pelo seed local:");
for (const role of users) console.log(`- ${role}.demo@curtiz.local`);
if (!process.env.DEMO_USERS_PASSWORD) {
  console.log(`Senha gerada (exibida somente nesta execução): ${password}`);
}
console.log("Execute o seed com o Supabase local ativo; nenhuma credencial foi gravada.");
