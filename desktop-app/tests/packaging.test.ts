import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("cross-platform desktop packaging", () => {
  it("pins the embedded player and configures Windows and unsigned macOS artifacts", async () => {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as Record<string, any>;
    expect(pkg.packageManager).toMatch(/^npm@/);
    expect(pkg.dependencies).toMatchObject({ "@vidstack/react": "1.15.6", "hls.js": "1.7.2" });
    expect(pkg.build.win).toMatchObject({ target: "nsis", icon: "build/icons/icon.ico" });
    expect(pkg.build.mac).toMatchObject({ target: "dmg", icon: "build/icons/icon.icns", identity: null });
    expect(pkg.scripts["dist:mac"]).toContain("--x64 --arm64");
  });

  it("generates a macOS icon and publishes both platforms from matching version tags", async () => {
    const icons = await readFile(new URL("../scripts/generate-icons.mjs", import.meta.url), "utf8");
    const workflow = await readFile(new URL("../../.github/workflows/desktop-release.yml", import.meta.url), "utf8");
    expect(icons).toContain('new URL("icon.icns", output)');
    expect(workflow).toContain("runs-on: windows-latest");
    expect(workflow).toContain("runs-on: macos-latest");
    expect(workflow).toContain("GITHUB_REF_NAME !== 'v'+p.version");
    expect(workflow).toContain("gh release create");
  });
});
