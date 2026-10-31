import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import RemovedAuthenticatorPage from "../app/mfa/page";

describe("removed authenticator", () => {
  it("redirects old bookmarks to login without rendering enrollment", () => {
    expect(() => RemovedAuthenticatorPage()).toThrow("redirect:/login");
  });
});
