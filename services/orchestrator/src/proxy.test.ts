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
  it("injects the nav reporter + element picker + error reporter at the start of <head>", () => {
    const out = injectPreviewScripts(HTML, "srv_1234abcd");
    expect(out).toContain("__uniqusNavReporterInstalled");
    expect(out).toContain("__uniqusElementPickerInstalled");
    expect(out).toContain("__uniqusErrorReporterInstalled");
    // Scripts land immediately after the opening <head> tag, before app code.
    expect(out.indexOf("<script>")).toBeLessThan(out.indexOf("<title>"));
  });

  it("emits the uniqus:runtime-error contract shape from the error reporter", () => {
    const out = injectPreviewScripts(HTML, "srv_1234abcd");
    for (const key of ["uniqus:runtime-error", "unhandledrejection", "console.error"]) {
      expect(out).toContain(key);
    }
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
    const html = injectPreviewScripts(HTML, "srv_x");
    const bodies = scriptBodies(html);
    expect(bodies.length).toBe(4); // api-rewrite + nav + element-picker + error-reporter
    for (const body of bodies) {
      // new Function only PARSES the body; it never runs (so window/document
      // refs are fine). A SyntaxError here means the stringified JS is broken.
      expect(() => new Function(body)).not.toThrow();
    }
    // The api-rewrite shim prefixes the app's root-relative requests with the
    // preview base, so a plain fetch("/api/...") works behind the proxy.
    expect(html).toContain('"/preview/srv_x"');
  });

  it("api-rewrite shim uses the explicit base prefix (share path)", () => {
    const html = injectPreviewScripts(HTML, "tok", "/preview/share/tok");
    expect(html).toContain('"/preview/share/tok"');
    // Still 4 valid scripts.
    for (const body of scriptBodies(html)) {
      expect(() => new Function(body)).not.toThrow();
    }
  });

  it("escapes a hostile base prefix so it can't break out of the <script>", () => {
    const html = injectPreviewScripts(HTML, "srv_x", '/preview/share/a"</script><x>');
    // `<` is <-escaped, so no premature </script> close and no <x> tag leak.
    expect(html).not.toContain("</script><x>");
    const bodies = scriptBodies(html);
    expect(bodies.length).toBe(4);
    for (const body of bodies) {
      expect(() => new Function(body)).not.toThrow();
    }
  });

  it("falls back to <body> when there is no <head>", () => {
    const out = injectPreviewScripts("<body><p>x</p></body>", "srv_x");
    expect(out.indexOf("<script>")).toBeLessThan(out.indexOf("<p>"));
  });
});
