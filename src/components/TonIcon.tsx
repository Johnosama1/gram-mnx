export default function TonIcon({ className = '', size = 16 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 2 2.6 7.2 12 22l9.4-14.8L12 2Zm0 2.9 6.6 3.6L12 18.4 5.4 8.5 12 4.9Z" />
    </svg>
  );
}
