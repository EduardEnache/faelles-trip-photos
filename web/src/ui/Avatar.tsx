/** Person avatar: colour disc + initial (Instrument Sans 500). SCAFFOLD-OWNED. */
import type { CSSProperties } from 'react';
import { personOf, type PersonId } from '@shared/trip';

export interface AvatarProps {
  person: PersonId;
  /** Diameter in px. Prototype sizes: 20 (likers), 24 (chips), 26, 30–34, 56 (who). */
  size?: number;
  /** Ring colour for stacked avatars (e.g. var(--nat) on the viewer). */
  ring?: string;
  className?: string;
  style?: CSSProperties;
  /** Hide from AT when the name is already next to it (default true). */
  decorative?: boolean;
}

export function Avatar({ person, size = 30, ring, className, style, decorative = true }: AvatarProps) {
  const p = personOf(person);
  return (
    <span
      className={className}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : p.name}
      role={decorative ? undefined : 'img'}
      style={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: '50%',
        background: p.color,
        color: 'var(--on-person)',
        display: 'inline-grid',
        placeItems: 'center',
        fontSize: Math.round(size * 0.42),
        fontWeight: 500,
        lineHeight: 1,
        boxShadow: ring ? `0 0 0 1.5px ${ring}` : undefined,
        ...style,
      }}
    >
      {p.name[0]}
    </span>
  );
}
