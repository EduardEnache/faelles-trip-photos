/** "øresund." — weight 500 with a Dannebrog-red dot. SCAFFOLD-OWNED. */
export function Wordmark({ size = 21 }: { size?: number }) {
  return (
    <span
      style={{ fontWeight: 500, fontSize: size, letterSpacing: '-0.03em', lineHeight: 1, whiteSpace: 'nowrap' }}
      aria-label="øresund"
    >
      øresund<span style={{ color: 'var(--dannebrog)' }} aria-hidden="true">.</span>
    </span>
  );
}
