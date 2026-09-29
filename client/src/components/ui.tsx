import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { getSkin } from '@biro/shared';
import { renderPenPreview } from '../game/penArt';
import { sfx } from '../lib/audio';

type Variant = 'blue' | 'red' | 'yellow' | 'green' | 'ghost' | 'dark';

export function Button({
  variant = 'blue',
  size = 'md',
  className = '',
  onClick,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} btn-${size} ${className}`}
      onClick={(e) => {
        sfx.unlock();
        sfx.tap();
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function PenPreview({ skin, width = 180, height = 44, angle = 0, className = '' }: { skin: string; width?: number; height?: number; angle?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const draw = () => ref.current && renderPenPreview(ref.current, getSkin(skin), width, height, angle);
    draw();
    // Re-render once web fonts / DPR settle.
    const t = window.setTimeout(draw, 300);
    return () => window.clearTimeout(t);
  }, [skin, width, height, angle]);
  return <canvas ref={ref} className={className} style={{ width, height }} aria-hidden="true" />;
}

export function PaperScreen({ title, onBack, children, className = '' }: { title?: string; onBack?: () => void; children: ReactNode; className?: string }) {
  return (
    <div className={`paper ${className}`}>
      <div className="paper-inner">
        {(title || onBack) && (
          <header className="paper-header">
            {onBack && (
              <button type="button" className="back-btn" onClick={() => { sfx.tap(); onBack(); }} aria-label="Back">
                <svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
            {title && <h1 className="marker">{title}</h1>}
          </header>
        )}
        {children}
        <p className="credit">
          Developed by <b>ma_azi</b>
        </p>
      </div>
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => { sfx.tap(); onChange(o.value); }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={checked} className={`toggle ${checked ? 'on' : ''}`} onClick={() => { sfx.tap(); onChange(!checked); }}>
        <span className="knob" />
      </button>
    </label>
  );
}

export function Modal({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

export function Confetti() {
  const colors = ['#2f5bea', '#e8384f', '#ffd23f', '#22c55e', '#ff3ea5', '#ffffff'];
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 40 }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${Math.random() * 100}%`,
            background: colors[i % colors.length],
            animationDelay: `${Math.random() * 0.8}s`,
            animationDuration: `${1.8 + Math.random() * 1.4}s`,
            transform: `rotate(${Math.random() * 360}deg)`,
          }}
        />
      ))}
    </div>
  );
}
