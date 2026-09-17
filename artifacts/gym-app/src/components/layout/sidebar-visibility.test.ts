import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("sidebar desktop visibility", () => {
  it("keeps an unconditional desktop translate reset outside the mobile state branch", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "sidebar.tsx"), "utf8");
    expect(source).toContain('mobileOpen ? "translate-x-0" : "ltr:-translate-x-full rtl:translate-x-full"');
    expect(source).toContain('"md:translate-x-0"');
  });
});
