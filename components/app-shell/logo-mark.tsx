import { cn } from "@/lib/utils";

/**
 * The المدرسة iwan-tile mark: teal tile, sand doorway, gold khatam star.
 * Tile/doorway follow the theme (primary flips light↔dark); the gold is
 * fixed brand. Master asset: docs/logo.svg (same geometry, fixed colors).
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <rect width="512" height="512" rx="120" fill="var(--primary)" />
      <path
        d="M144 400 V292 A176 176 0 0 1 256 128 A176 176 0 0 1 368 292 V400 Z"
        fill="var(--primary-foreground)"
      />
      <g fill="#dba341">
        <rect x="209" y="205" width="94" height="94" />
        <rect
          x="209"
          y="205"
          width="94"
          height="94"
          transform="rotate(45 256 252)"
        />
      </g>
    </svg>
  );
}
