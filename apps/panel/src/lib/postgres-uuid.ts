import { z } from "zod";

// PostgreSQL accepts UUIDs with any hexadecimal version nibble. The initial
// catalog intentionally uses deterministic version-0 values for stable data.
export const postgresUuidSchema = z.string().regex(
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu,
  "Identificador UUID inv\u00e1lido."
);
