// pdf-parse ships no type declarations, and we import its inner lib file
// directly (the package index runs a debug block that reads a bundled test PDF
// when module.parent is falsy — true under ESM). Declare the subpath so tsc is
// happy; the call site casts to the precise shape it needs.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  function pdfParse(
    data: Buffer | Uint8Array,
    options?: Record<string, unknown>,
  ): Promise<PdfParseResult>;
  export default pdfParse;
}
