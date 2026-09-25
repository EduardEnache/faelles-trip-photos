/**
 * Buttons per spec: one filled (Fjord) action per view; secondary outlined;
 * tertiary text. Pills. ≥44px touch targets. SCAFFOLD-OWNED.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import s from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'ink' | 'light' | 'ghostDark';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  /** Leading icon element (aria-hidden is added for you). */
  icon?: ReactNode;
  /** Trailing mono meta, e.g. a size "1.4 GB". */
  meta?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', block, icon, meta, className, children, type = 'button', ...rest },
  ref,
) {
  const cls = [s.btn, s[variant], size !== 'md' && s[size], block && s.block, className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={cls} {...rest}>
      {icon ? <span aria-hidden="true" style={{ display: 'inline-flex' }}>{icon}</span> : null}
      {children}
      {meta != null ? <span className={s.meta}>{meta}</span> : null}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  tone?: 'soft' | 'dark' | 'plain';
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tone = 'soft', className, children, type = 'button', ...rest },
  ref,
) {
  const toneCls = tone === 'soft' ? s.iconSoft : tone === 'dark' ? s.iconDark : s.iconPlain;
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={[s.btn, s.icon, toneCls, className].filter(Boolean).join(' ')}
      {...rest}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex' }}>{children}</span>
    </button>
  );
});
