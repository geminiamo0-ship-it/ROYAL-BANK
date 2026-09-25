'use client';

import React, {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  Expand,
  Maximize2,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

type MedicalImageItem = {
  src: string;
  alt: string;
  caption: string;
};

type Point = { x: number; y: number };

const MIN_SCALE = 0.5;
const MAX_SCALE = 6;

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function distance(
  a: { clientX: number; clientY: number },
  b: { clientX: number; clientY: number },
) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function imageCaption(img: HTMLImageElement) {
  const anchor = img.closest('a[data-caption]');
  const figure = img.closest('figure');
  const figureCaption = figure?.querySelector('figcaption')?.textContent?.trim();
  return (
    anchor?.getAttribute('data-caption')?.trim()
    || figureCaption
    || img.getAttribute('alt')?.trim()
    || img.getAttribute('title')?.trim()
    || ''
  );
}

function collectImages(root: HTMLElement): MedicalImageItem[] {
  return Array.from(root.querySelectorAll<HTMLImageElement>('img'))
    .filter((img) => img.dataset.noPreview !== 'true')
    .map((img) => ({
      src: img.currentSrc || img.src || img.getAttribute('src') || '',
      alt: img.getAttribute('alt')?.trim() || '',
      caption: imageCaption(img),
    }))
    .filter((item) => item.src.length > 0);
}

function MedicalImageViewer({
  images,
  initialIndex,
  onClose,
}: {
  images: MedicalImageItem[];
  initialIndex: number;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragStartRef = useRef<Point | null>(null);
  const offsetStartRef = useRef<Point>({ x: 0, y: 0 });
  const pinchDistanceRef = useRef<number | null>(null);
  const pinchScaleRef = useRef(1);
  const swipeStartRef = useRef<Point | null>(null);

  const [index, setIndex] = useState(initialIndex);
  const [mode, setMode] = useState<'fit' | 'actual'>('fit');
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [magnifier, setMagnifier] = useState(false);
  const [lens, setLens] = useState<{
    x: number;
    y: number;
    px: number;
    py: number;
    width: number;
    height: number;
  } | null>(null);
  const [broken, setBroken] = useState(false);

  const current = images[index] || images[0];
  const hasMultiple = images.length > 1;

  const resetView = useCallback((nextMode: 'fit' | 'actual' = 'fit') => {
    setMode(nextMode);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setLens(null);
    setBroken(false);
  }, []);

  const changeImage = useCallback((nextIndex: number) => {
    if (images.length < 2) return;
    const normalized = (nextIndex + images.length) % images.length;
    setIndex(normalized);
    resetView('fit');
  }, [images.length, resetView]);

  const zoomBy = useCallback((factor: number) => {
    setScale((value) => clampScale(value * factor));
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft') changeImage(index - 1);
      else if (event.key === 'ArrowRight') changeImage(index + 1);
      else if (event.key === '+' || event.key === '=') zoomBy(1.2);
      else if (event.key === '-') zoomBy(1 / 1.2);
      else if (event.key === '0') resetView('fit');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [changeImage, index, onClose, resetView, zoomBy]);

  const updateLens = (clientX: number, clientY: number) => {
    if (!magnifier || !imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    if (
      clientX < rect.left
      || clientX > rect.right
      || clientY < rect.top
      || clientY > rect.bottom
    ) {
      setLens(null);
      return;
    }

    setLens({
      x: clientX - rect.left,
      y: clientY - rect.top,
      px: ((clientX - rect.left) / Math.max(1, rect.width)) * 100,
      py: ((clientY - rect.top) / Math.max(1, rect.height)) * 100,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (magnifier) {
      updateLens(event.clientX, event.clientY);
      return;
    }
    if (event.pointerType === 'touch') return;
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    offsetStartRef.current = offset;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (magnifier) {
      updateLens(event.clientX, event.clientY);
      return;
    }
    const start = dragStartRef.current;
    if (!start) return;
    setOffset({
      x: offsetStartRef.current.x + event.clientX - start.x,
      y: offsetStartRef.current.y + event.clientY - start.y,
    });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      pinchDistanceRef.current = distance(event.touches[0], event.touches[1]);
      pinchScaleRef.current = scale;
      swipeStartRef.current = null;
      return;
    }
    if (event.touches.length === 1) {
      swipeStartRef.current = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
      };
      offsetStartRef.current = offset;
    }
  };

  const onTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2 && pinchDistanceRef.current) {
      event.preventDefault();
      const nextDistance = distance(event.touches[0], event.touches[1]);
      setScale(clampScale(pinchScaleRef.current * (nextDistance / pinchDistanceRef.current)));
      return;
    }

    if (event.touches.length === 1 && swipeStartRef.current && (scale > 1 || mode === 'actual')) {
      event.preventDefault();
      setOffset({
        x: offsetStartRef.current.x + event.touches[0].clientX - swipeStartRef.current.x,
        y: offsetStartRef.current.y + event.touches[0].clientY - swipeStartRef.current.y,
      });
    }
  };

  const onTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length > 0) return;
    pinchDistanceRef.current = null;

    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || scale > 1 || mode === 'actual') return;

    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      changeImage(index + (dx < 0 ? 1 : -1));
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await overlayRef.current?.requestFullscreen();
      }
    } catch {
      // Fullscreen is a progressive enhancement; the viewer remains usable without it.
    }
  };

  const lensStyle = useMemo(() => {
    if (!lens || !current) return null;
    return {
      left: lens.x - 82,
      top: lens.y - 82,
      backgroundImage: `url("${current.src.replace(/"/g, '%22')}")`,
      backgroundSize: `${lens.width * 2.35}px ${lens.height * 2.35}px`,
      backgroundPosition: `${lens.px}% ${lens.py}%`,
    } as React.CSSProperties;
  }, [current, lens]);

  if (!current) return null;

  const imageClass = mode === 'fit'
    ? 'max-h-[78dvh] max-w-[92vw] object-contain'
    : 'max-h-none max-w-none object-none';

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[1000] flex flex-col bg-[#080b0f]/[0.985] text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Medical image viewer"
    >
      <header className="relative z-20 flex min-h-[58px] shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-black/30 px-3 sm:px-5">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-white/85">
            {current.caption || current.alt || 'Medical image'}
          </div>
          {hasMultiple ? (
            <div className="mt-0.5 text-[10px] font-semibold tracking-wide text-[#d7b25f]">
              {index + 1} / {images.length}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => resetView('fit')}
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-[11px] text-white/80 hover:bg-white/10 hover:text-white"
            title="Fit image to screen (0)"
          >
            <Expand className="h-4 w-4" /> <span className="hidden sm:inline">Fit</span>
          </button>
          <button
            type="button"
            onClick={() => resetView('actual')}
            className="h-9 rounded-md px-2.5 text-[11px] font-semibold text-white/80 hover:bg-white/10 hover:text-white"
            title="Show at actual pixel size"
          >
            100%
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.2)}
            className="grid h-9 w-9 place-items-center rounded-md text-white/80 hover:bg-white/10 hover:text-white"
            title="Zoom out (-)"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1.2)}
            className="grid h-9 w-9 place-items-center rounded-md text-white/80 hover:bg-white/10 hover:text-white"
            title="Zoom in (+)"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setMagnifier((value) => !value);
              setLens(null);
            }}
            className={`grid h-9 w-9 place-items-center rounded-md transition-colors ${
              magnifier ? 'bg-[#b88a32] text-white' : 'text-white/80 hover:bg-white/10 hover:text-white'
            }`}
            title="Magnifier"
            aria-pressed={magnifier}
          >
            <Search className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="grid h-9 w-9 place-items-center rounded-md text-white/80 hover:bg-white/10 hover:text-white"
            title="Full screen"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-1 grid h-9 w-9 place-items-center rounded-md border border-white/15 text-white/90 hover:bg-white/10"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div
        className="relative min-h-0 flex-1 overflow-hidden touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => magnifier && setLens(null)}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onDoubleClick={() => {
          if (scale > 1) resetView('fit');
          else setScale(2);
        }}
        onWheel={(event) => {
          event.preventDefault();
          zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);
        }}
      >
        {hasMultiple ? (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                changeImage(index - 1);
              }}
              className="absolute left-2 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/45 text-white/85 backdrop-blur hover:bg-black/70 sm:left-4"
              aria-label="Previous image"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                changeImage(index + 1);
              }}
              className="absolute right-2 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/45 text-white/85 backdrop-blur hover:bg-black/70 sm:right-4"
              aria-label="Next image"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        ) : null}

        <div className="absolute inset-0 flex items-center justify-center px-4 py-5 sm:px-16">
          {broken ? (
            <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-5 text-center">
              <p className="text-sm font-semibold text-white">Image unavailable</p>
              <p className="mt-1 max-w-[420px] break-all text-[11px] text-white/50">{current.src}</p>
            </div>
          ) : (
            <div
              className="relative select-none"
              style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})` }}
            >
              <img
                ref={imageRef}
                src={current.src}
                alt={current.alt || current.caption || 'Medical image'}
                draggable={false}
                className={`${imageClass} block select-none`}
                onError={() => setBroken(true)}
                onLoad={() => setBroken(false)}
              />
              {magnifier && lensStyle ? (
                <div
                  className="pointer-events-none absolute z-30 h-[164px] w-[164px] rounded-full border-2 border-[#d7b25f] bg-no-repeat shadow-[0_12px_36px_rgba(0,0,0,0.55)]"
                  style={lensStyle}
                />
              ) : null}
            </div>
          )}
        </div>
      </div>

      <footer className="relative z-20 flex min-h-[46px] shrink-0 items-center justify-center gap-3 border-t border-white/10 bg-black/25 px-3 text-[10px] text-white/45">
        <span>Wheel, pinch or +/- to zoom</span>
        <span aria-hidden="true">•</span>
        <span>Drag to pan</span>
        {hasMultiple ? (
          <>
            <span aria-hidden="true">•</span>
            <span>Swipe or ← → for images</span>
          </>
        ) : null}
      </footer>
    </div>,
    document.body,
  );
}

export function MedicalImageGallery({
  children,
  className = 'contents',
}: {
  children: ReactNode;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [images, setImages] = useState<MedicalImageItem[]>([]);
  const [initialIndex, setInitialIndex] = useState(0);

  const close = useCallback(() => setImages([]), []);

  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    if (target.dataset.noPreview === 'true') return;
    const root = rootRef.current;
    if (!root) return;

    const imageElements = Array.from(root.querySelectorAll<HTMLImageElement>('img'))
      .filter((img) => img.dataset.noPreview !== 'true');
    const targetIndex = imageElements.indexOf(target);
    const nextImages = collectImages(root);
    if (nextImages.length === 0) return;

    event.preventDefault();
    event.stopPropagation();
    setInitialIndex(targetIndex >= 0 ? targetIndex : 0);
    setImages(nextImages);
  };

  return (
    <>
      <div
        ref={rootRef}
        className={className}
        onClickCapture={onClickCapture}
        data-medical-image-gallery="true"
      >
        {children}
      </div>
      {images.length > 0 ? (
        <MedicalImageViewer images={images} initialIndex={initialIndex} onClose={close} />
      ) : null}
    </>
  );
}
