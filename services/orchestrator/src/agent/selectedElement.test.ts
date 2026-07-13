import { describe, expect, it } from "vitest";
import {
  parseSelectedElement,
  formatSelectedElementBlock,
  SELECTED_ELEMENT_MARKER,
} from "./selectedElement.js";

describe("parseSelectedElement", () => {
  it("rejects non-objects and missing/invalid tags", () => {
    expect(parseSelectedElement(null)).toBeNull();
    expect(parseSelectedElement(undefined)).toBeNull();
    expect(parseSelectedElement("button")).toBeNull();
    expect(parseSelectedElement(42)).toBeNull();
    expect(parseSelectedElement({})).toBeNull();
    expect(parseSelectedElement({ tag: "" })).toBeNull();
    // A non-tag-shaped string (selectors, spaces, leading digit) is rejected.
    expect(parseSelectedElement({ tag: "div > span" })).toBeNull();
    expect(parseSelectedElement({ tag: "123" })).toBeNull();
    expect(parseSelectedElement({ tag: "<button>" })).toBeNull();
  });

  it("normalizes a well-formed payload", () => {
    const el = parseSelectedElement({
      type: "gate15:element",
      server_id: "srv_abc",
      selector: "  #app > button.btn:nth-of-type(2)  ",
      tag: "  BUTTON  ",
      id: "  signup  ",
      classes: ["btn", "btn-primary", "", 7, null],
      rect: { x: 10.4, y: 20.6, width: 100, height: 40, top: 20.6, right: 110, bottom: 60, left: 10.4 },
      text: "  Sign   up\n now  ",
    });
    expect(el).not.toBeNull();
    expect(el!.tag).toBe("button");
    expect(el!.selector).toBe("#app > button.btn:nth-of-type(2)");
    expect(el!.id).toBe("signup");
    expect(el!.classes).toEqual(["btn", "btn-primary"]); // non-strings/empties dropped
    expect(el!.text).toBe("Sign up now"); // whitespace collapsed + trimmed
    expect(el!.rect).toEqual({
      x: 10.4, y: 20.6, width: 100, height: 40, top: 20.6, right: 110, bottom: 60, left: 10.4,
    });
  });

  it("treats web-component dashed tags as valid", () => {
    expect(parseSelectedElement({ tag: "my-widget" })?.tag).toBe("my-widget");
  });

  it("returns null id when absent or blank, and null rect when unusable", () => {
    const el = parseSelectedElement({ tag: "div", id: "   " });
    expect(el!.id).toBeNull();
    expect(el!.rect).toBeNull(); // no rect provided
    expect(el!.classes).toEqual([]);
    expect(el!.selector).toBe("");

    // A rect with no size and no position is noise → null.
    expect(parseSelectedElement({ tag: "div", rect: { width: 0, height: 0 } })!.rect).toBeNull();
    // A zero-size rect that still has a position is kept (e.g. an empty marker).
    expect(parseSelectedElement({ tag: "div", rect: { width: 0, height: 0, top: 5, left: 5 } })!.rect)
      .not.toBeNull();
  });

  it("hard-caps oversized fields so a hostile page can't bloat context", () => {
    const el = parseSelectedElement({
      tag: "span",
      selector: "x".repeat(5000),
      text: "y".repeat(5000),
      classes: Array.from({ length: 200 }, () => "z".repeat(500)),
    });
    expect(el!.selector.length).toBe(1024);
    expect(el!.text.length).toBe(500);
    expect(el!.classes.length).toBe(50);
    expect(el!.classes[0].length).toBe(200);
  });
});

describe("formatSelectedElementBlock", () => {
  it("starts with the replay marker so the user bubble can be stripped", () => {
    const block = formatSelectedElementBlock(parseSelectedElement({ tag: "button" })!);
    expect(block.startsWith(SELECTED_ELEMENT_MARKER)).toBe(true);
  });

  it("renders only the fields that are present", () => {
    const block = formatSelectedElementBlock(
      parseSelectedElement({
        tag: "button",
        id: "go",
        selector: "#go",
        classes: ["btn", "primary"],
        text: "Go",
        rect: { x: 12, y: 34, width: 80, height: 28 },
      })!,
    );
    expect(block).toContain("- selector: #go");
    expect(block).toContain("- tag: <button>");
    expect(block).toContain("- id: #go");
    expect(block).toContain("- classes: btn, primary");
    expect(block).toContain('- text: "Go"');
    expect(block).toContain("- position: 80×28 px at (12, 34)");
  });

  it("omits empty optional fields", () => {
    const block = formatSelectedElementBlock(parseSelectedElement({ tag: "div" })!);
    expect(block).toContain("- tag: <div>");
    expect(block).not.toContain("- id:");
    expect(block).not.toContain("- classes:");
    expect(block).not.toContain("- text:");
    expect(block).not.toContain("- position:");
    expect(block).not.toContain("- selector:");
  });
});
