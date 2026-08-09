import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routes = [
  "apps/panel/src/app/api/admin/banner-media/route.ts",
  "apps/panel/src/app/api/homepage-builder/media/route.ts",
  "apps/panel/src/app/api/catalog/products/media/route.ts"
].map((path) => readFileSync(path, "utf8"));

describe("admin upload request limits", () => {
  it.each(routes)("rejects an oversized declared body before parsing multipart", (route) => {
    expect(route.indexOf('headers.get("content-length")')).toBeGreaterThan(-1);
    expect(route.indexOf('headers.get("content-length")')).toBeLessThan(route.indexOf("request.formData()"));
    expect(route).toContain("status: 413");
  });
});
