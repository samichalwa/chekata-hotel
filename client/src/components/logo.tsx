export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="The Chekata logo"
      role="img"
    >
      <path
        d="M7 23 L24 8 L41 23"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6 35 H18" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M30 35 H42" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}
