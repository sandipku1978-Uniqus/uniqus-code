import { describe, expect, it } from "vitest";
import { injectPreviewScripts } from "./proxy.js";

// Pull every <script>…</script> body out of an injected HTML document.
function scriptBodies(html: string): string[] {
  const bodies: string[] = [];
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) bodies.push(m[1]);
  return bodies;
}

const HTML = "<html><head><title>x</title></head><body><h1>hi</h1></body></html>";

describe("injectPreviewScripts", () => {
  it("injects the nav reporter + element picker at the start of <head>", () => {
    const out = injectPreviewScripts(HTML, "srv_1234abcd");
    expect(out).toContain("__uniqusNavReporterInstalled");
    expect(out).toContain("__uniqusElementPickerInstalled");
    // Scripts land immediately after the opening <head> tag, before app code.
    expect(out.indexOf("<script>")).toBeLessThan(out.indexOf("<title>"));
  });

  it("emits the uniqus:element contract shape from the picker", () => {
    const out = injectPreviewScripts(HTML, "srv_1234abcd");
    for (const key of ["uniqus:element", "selector", "tag", "classes", "id", "rect", "text"]) {
      expect(out).toContain(key);
    }
    // serverId is interpolated as a JSON string literal, not left as a token.
    expect(out).toContain('"srv_1234abcd"');
  });

  it("emits JS that actually parses (guards against escape/quote breakage)", () => {
    const bodies = scriptBodies(injectPreviewScripts(HTML, "srv_x"));
    expect(bodies.length).toBe(2);
    for (const body of bodies) {
      // new Function only PARSES the body; it never runs (so window/document
      // refs are fine). A SyntaxError here means the stringified JS is broken.
      expect(() => new Function(body)).not.toThrow();
    }
  });

  it("falls back to <body> when there is no <head>", () => {
    const out = injectPreviewScripts("<body><p>x</p></body>", "srv_x");
    expect(out.indexOf("<script>")).toBeLessThan(out.indexOf("<p>"));
  });
});
