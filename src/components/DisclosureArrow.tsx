export default function DisclosureArrow({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`disclosure-arrow h-4 w-4 shrink-0 text-t3 transition-transform duration-150 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
