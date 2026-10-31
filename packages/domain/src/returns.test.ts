import { describe, expect, it } from "vitest";
import { validateReturnPhotos } from "./returns";
const photo = { type: "image/jpeg", size: 1000 };
describe("return evidence limits", () => {
  it("allows zero to three photos", () => {
    expect(validateReturnPhotos([])).toBe("");
    expect(validateReturnPhotos([photo, photo, photo])).toBe("");
  });
  it("counts already attached photos", () => {
    expect(validateReturnPhotos([photo, photo], 2)).toContain("3 fotos");
    expect(validateReturnPhotos([photo], 2)).toBe("");
  });
  it.each([{ type: "image/svg+xml", size: 100 }, { type: "video/mp4", size: 100 }, { type: "image/png", size: 0 }, { type: "image/png", size: 5242881 }])("rejects unsupported or oversized evidence %j", invalid => {
    expect(validateReturnPhotos([invalid])).toContain("5 MB");
  });
});
