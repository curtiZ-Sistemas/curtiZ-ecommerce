import { z } from "zod";

// PostgreSQL accepts UUIDs with any hexadecimal version nibble. The catalog
// uses deterministic version-0 UUIDs as well as regular generated UUIDs.
export const postgresUuidSchema = z.string().regex(
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu,
  "Identificador UUID inválido."
);
