import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("sidebar desktop visibility", () => {
  it("limits drawer translations to mobile widths so desktop cannot stay off-screen", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "sidebar.tsx"), "utf8");

    expect(source).toContain('? "max-md:translate-x-0"');
    expect(source).toContain(': "max-md:ltr:-translate-x-full max-md:rtl:translate-x-full"');
    expect(source).not.toContain('"ltr:-translate-x-full rtl:translate-x-full"');
    expect(source).not.toContain('"md:translate-x-0"');
  });
});
