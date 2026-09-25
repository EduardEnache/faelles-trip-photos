/** full-bleed memory player overlay. Stub from the scaffold; replace entirely. */
import type { MemoryPlayerProps } from '@/slots';

export default function MemoryPlayer({ memoryId, onClose }: MemoryPlayerProps) {
  return (
    <div role="dialog" aria-label="Memory" style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'var(--nat)', color: 'var(--on-dark)' }}>
      <button type="button" onClick={onClose}>Close {memoryId}</button>
    </div>
  );
}
