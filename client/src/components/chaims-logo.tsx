/**
 * CHAIMS brand mark — Chalwa Integrated Hotel Management System.
 *
 * Independent brand identity from any single licensed hotel (e.g. The Chekata):
 * a deep navy badge with an ascending skyline of three property blocks and an
 * amber beacon atop the tallest, representing the platform connecting many
 * licensed hotel properties under one system.
 */
export function ChaimsMark({ className = "h-16 w-16" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="CHAIMS logo"
    >
      <rect x="0" y="0" width="64" height="64" rx="14" fill="#101B33" />
      <rect
        x="0.75"
        y="0.75"
        width="62.5"
        height="62.5"
        rx="13.25"
        fill="none"
        stroke="#2A3B5C"
        strokeWidth="1.5"
      />
      <line x1="11" y1="45" x2="53" y2="45" stroke="#E7EAF2" strokeWidth="2" strokeLinecap="round" />
      <path d="M13 45 V38 H21 V45 Z" fill="#E7EAF2" />
      <path d="M25 45 V30 L32 25 L39 30 V45 Z" fill="#E7EAF2" />
      <path d="M43 45 V33 H51 V45 Z" fill="#E7EAF2" />
      <circle cx="32" cy="18" r="3.2" fill="#E3A736" />
      <line x1="32" y1="21.2" x2="32" y2="25" stroke="#E3A736" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ChaimsWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-[0.14em] ${className}`}>
      CHAIMS
    </span>
  );
}
