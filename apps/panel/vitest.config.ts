import { fileURLToPath } from "node:url";
import { mergeConfig } from "vitest/config";
import base from "../../vitest.config";

export default mergeConfig(base, {
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }
  }
});
