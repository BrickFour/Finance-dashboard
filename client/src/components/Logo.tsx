import { cx } from '@/lib/format';

/**
 * The BrickFour logo.
 *
 * `brickfour-logo.png` is the supplied lock-up (about 2:1) and is never stretched
 * or recoloured. `brickfour-mark.png` is the same artwork centred on a white
 * square, for the collapsed sidebar rail and the browser tab.
 */
const LOGO_RATIO = 76 / 150;

export function LogoFull({ className, width = 150 }: { className?: string; width?: number }) {
  return (
    <img
      src="/brickfour-logo.png"
      alt="BrickFour — Finance Dashboard"
      width={width}
      height={Math.round(width * LOGO_RATIO)}
      className={cx('object-contain select-none', className)}
      style={{ width, height: Math.round(width * LOGO_RATIO) }}
      draggable={false}
    />
  );
}

export function LogoMark({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <img
      src="/brickfour-mark.png"
      alt="BrickFour"
      width={size}
      height={size}
      className={cx('object-contain select-none', className)}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

/** The mark on a white rounded tile, so the red artwork reads on the dark navigation. */
export function LogoTile({ size = 32 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-[10px] bg-white shadow-sm shrink-0 overflow-hidden"
      style={{ width: size + 6, height: size + 6 }}
    >
      <LogoMark size={size + 2} />
    </span>
  );
}

/**
 * The logo with the product name beside it, for the sidebar header. On dark
 * surfaces the logo sits on a white plate so its red keeps its contrast.
 */
export function LogoHorizontal({
  className,
  markSize = 34,
  onDark = false,
}: {
  className?: string;
  markSize?: number;
  onDark?: boolean;
}) {
  const width = Math.round(markSize * 2.4);
  return (
    <div className={cx('flex items-center gap-2.5 min-w-0', className)}>
      <span className={cx('inline-flex items-center rounded-lg shrink-0', onDark && 'bg-white px-1.5 py-1 shadow-sm')}>
        <LogoFull width={width} />
      </span>
      <div className="min-w-0 leading-tight">
        <div className={cx('text-[13px] font-semibold tracking-tight', onDark ? 'text-white' : 'text-navy-900')}>Finance</div>
        <div className={cx('text-[10px] font-medium uppercase tracking-[0.08em]', onDark ? 'text-navy-300' : 'text-ink-muted')}>
          Dashboard
        </div>
      </div>
    </div>
  );
}
