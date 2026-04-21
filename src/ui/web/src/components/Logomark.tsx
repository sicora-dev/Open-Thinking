type LogomarkProps = {
  size?: number;
};

export function Logomark({ size = 26 }: LogomarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      stroke="var(--cyan-500)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* prompt caret */}
      <path d="M3 16l3 3-3 3" />
      {/* brain outline */}
      <path d="M14 9c-3 0-5 2-5 5 0 1 .3 2 .8 2.8-1 .7-1.8 2-1.8 3.2 0 1.5 1 2.8 2.3 3.2 0 2.3 1.8 4.3 4.2 4.3 1.5 0 2.7-.8 3.5-2V10.5a3.5 3.5 0 0 0-3-1.5z" />
      <path d="M22 9c3 0 5 2 5 5 0 1-.3 2-.8 2.8 1 .7 1.8 2 1.8 3.2 0 1.5-1 2.8-2.3 3.2 0 2.3-1.8 4.3-4.2 4.3-1.5 0-2.7-.8-3.5-2V10.5A3.5 3.5 0 0 1 22 9z" />
      {/* nodes */}
      <circle cx="14" cy="14" r="1.4" fill="var(--cyan-500)" />
      <circle cx="22" cy="19" r="1.4" fill="var(--cyan-500)" />
      <circle cx="14" cy="24" r="1.4" fill="var(--cyan-500)" />
      <path d="M14 14l8 5M22 19l-8 5" strokeWidth="1.3" />
    </svg>
  );
}

type WordmarkProps = {
  size?: number;
  showText?: boolean;
};

export function Wordmark({ size = 26, showText = true }: WordmarkProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Logomark size={size} />
      {showText && (
        <span
          style={{
            fontSize: size * 0.62,
            fontWeight: 600,
            letterSpacing: -0.3,
            color: "var(--fg)",
          }}
        >
          Open
          <span style={{ color: "var(--cyan-500)" }}>Thinking</span>
        </span>
      )}
    </div>
  );
}
