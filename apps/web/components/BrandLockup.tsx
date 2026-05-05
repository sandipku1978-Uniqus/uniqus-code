import type { CSSProperties } from "react";

type BrandLockupProps = {
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
};

export default function BrandLockup({
  compact = false,
  className,
  style,
}: BrandLockupProps) {
  return (
    <span className={["lockup", className].filter(Boolean).join(" ")} style={style}>
      <span className="mark">
        <img src="/brand/uniqus-small-logo-color.png" alt="" />
      </span>
      {!compact && (
        <>
          <span>uniqus</span>
          <span className="slash">/</span>
          <span className="code">code</span>
        </>
      )}
    </span>
  );
}
