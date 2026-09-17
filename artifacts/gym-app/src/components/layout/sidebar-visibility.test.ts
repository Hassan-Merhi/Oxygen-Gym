import { describe, expect, it } from "vitest";
import {
  SIDEBAR_MOBILE_CLOSED_TRANSFORM,
  SIDEBAR_MOBILE_OPEN_TRANSFORM,
} from "./sidebar-visibility";

describe("sidebar desktop visibility", () => {
  it("limits drawer translations to mobile widths so desktop cannot stay off-screen", () => {
    expect(SIDEBAR_MOBILE_OPEN_TRANSFORM).toBe("max-md:translate-x-0");
    expect(SIDEBAR_MOBILE_CLOSED_TRANSFORM).toBe(
      "max-md:ltr:-translate-x-full max-md:rtl:translate-x-full",
    );
    expect(SIDEBAR_MOBILE_CLOSED_TRANSFORM).not.toContain("md:translate-x-0");
  });
});
