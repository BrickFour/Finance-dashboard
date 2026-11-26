import { cx } from '@/lib/format';

/**
 * The ArthSetu logo lock-up.
 *
 * Both assets are rendered at their native 1:1 aspect ratio and never stretched,
 * cropped in CSS or recoloured. `arthsetu-logo.png` is the supplied lock-up, used
 * wherever the wordmark has room to be read. `arthsetu-mark.png` is the compass
 * cropped from it for the places a square mark is needed — the collapsed sidebar
 * rail and the browser tab — rather than squeezing the full lock-up into a space
 * where its wordmark would be illegible.
 */

export function LogoFull({ className, width = 150 }: { className?: string; width?: number }) {
  return (
    <img
      src="/arthsetu-logo.png"
      alt="ArthSetu — CEO Finance Dashboard"
      width={width}
      height={width}
      className={cx('object-contain select-none', className)}
      style={{ width, height: width, aspectRatio: '1 / 1' }}
      draggable={false}
    />
  );
}

export function LogoMark({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <img
      src="/arthsetu-mark.png"
      alt="ArthSetu"
      width={size}
      height={size}
      className={cx('object-contain select-none', className)}
      style={{ width: size, height: size, aspectRatio: '1 / 1' }}
      draggable={false}
    />
  );
}

/** The mark on a white rounded tile, so it keeps its colours on the dark navigation. */
export function LogoTile({ size = 32 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-[10px] bg-white shadow-sm shrink-0"
      style={{ width: size + 6, height: size + 6 }}
    >
      <LogoMark size={size - 2} />
    </span>
  );
}

/**
 * The mark beside the product name, for headers where a square lock-up would be
 * too tall. The wordmark is set in Inter rather than cut out of the logo image, so
 * the supplied asset is never altered.
 */
export function LogoHorizontal({
  className,
  markSize = 34,
  onDark = false,
}: {
  className?: string;
  markSize?: number;
  /** Light wordmark and a white tile behind the mark, for dark surfaces. */
  onDark?: boolean;
}) {
  return (
    <div className={cx('flex items-center gap-2.5 min-w-0', className)}>
      {onDark ? <LogoTile size={markSize} /> : <LogoMark size={markSize} />}
      <div className="min-w-0 leading-none">
        <div className={cx('text-base font-bold tracking-tight', onDark ? 'text-white' : 'text-navy-900')}>ArthSetu</div>
        <div
          className={cx(
            'text-[7.5px] font-medium tracking-[0.09em] uppercase mt-1 whitespace-nowrap',
            onDark ? 'text-navy-300' : 'text-ink-muted',
          )}
        >
          CEO Finance Dashboard
        </div>
      </div>
    </div>
  );
}
