import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../../supabase/migrations/202609010003_product_video_media.sql", import.meta.url),
  "utf8"
);

describe("product video media migration", () => {
  it("keeps public media bounded and requires a poster for videos", () => {
    expect(sql).toContain("file_size_limit = 83886080");
    expect(sql).toContain("'video/mp4', 'video/webm'");
    expect(sql).toContain("product_media_video_poster_check");
    expect(sql).toContain("thumbnail_path");
  });

  it("migrates existing images and validates variant ownership", () => {
    expect(sql).toContain("from public.product_images image");
    expect(sql).toContain("validate_product_media_variant");
    expect(sql).toContain("variant.product_id = new.product_id");
  });
});
