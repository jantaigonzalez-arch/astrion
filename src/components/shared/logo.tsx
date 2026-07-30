import { cn } from "@/lib/utils";

// Marca Evoelution: monograma "picos de cromatograma" + wordmark.
export function Logo({
  className,
  showWord = true,
}: {
  className?: string;
  showWord?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg
        width="30"
        height="30"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden
        className="shrink-0"
      >
        <rect width="32" height="32" rx="8" fill="url(#evo-g)" />
        <path
          d="M5 22 L11 22 L13 10 L16 26 L19 6 L22 22 L27 22"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <defs>
          <linearGradient id="evo-g" x1="0" y1="0" x2="32" y2="32">
            <stop stopColor="oklch(0.52 0.19 258)" />
            <stop offset="1" stopColor="oklch(0.7 0.15 205)" />
          </linearGradient>
        </defs>
      </svg>
      {showWord && (
        <span className="text-lg font-semibold tracking-tight">
          Evo<span className="text-primary">elution</span>
        </span>
      )}
    </span>
  );
}
