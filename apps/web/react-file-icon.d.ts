// react-file-icon@1.6.0 ships no .d.ts and has no DefinitelyTyped package, so we
// declare the slice of its surface we use. This lives in a STANDALONE ambient
// .d.ts (no top-level import/export) so TS treats it as the module's type
// definition rather than an (illegal) augmentation of the untyped JS module.
declare module "react-file-icon" {
  /** Visual archetype react-file-icon draws for a given file. */
  export type FileIconType =
    | "3d"
    | "acrobat"
    | "android"
    | "audio"
    | "binary"
    | "code"
    | "compressed"
    | "document"
    | "drive"
    | "font"
    | "image"
    | "presentation"
    | "settings"
    | "spreadsheet"
    | "vector"
    | "video";

  export interface FileIconProps {
    /** Short label drawn on the fold (defaults to `extension`, uppercased). */
    extension?: string;
    type?: FileIconType;
    color?: string;
    foldColor?: string;
    glyphColor?: string;
    labelColor?: string;
    labelTextColor?: string;
    labelUppercase?: boolean;
    gradientColor?: string;
    gradientOpacity?: number;
    /** Corner radius of the page, in the 40×48 viewBox's units. */
    radius?: number;
  }

  export const FileIcon: (props: FileIconProps) => import("react").ReactElement;

  /** Curated per-extension style presets. Not every extension is present. */
  export const defaultStyles: Record<string, FileIconProps>;
}
