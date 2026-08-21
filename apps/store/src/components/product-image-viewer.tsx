"use client";

import { ChevronLeft, ChevronRight, RotateCcw, X } from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent
} from "react";

export type ImageTransform = { scale: number; x: number; y: number };

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const INITIAL_TRANSFORM: ImageTransform = { scale: 1, x: 0, y: 0 };

export function clampImageTransform(
  transform: ImageTransform,
  viewport: { width: number; height: number }
): ImageTransform {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, transform.scale));
  const maxX = Math.max(0, (viewport.width * (scale - 1)) / 2);
  const maxY = Math.max(0, (viewport.height * (scale - 1)) / 2);
  return {
    scale,
    x: Math.min(maxX, Math.max(-maxX, transform.x)),
    y: Math.min(maxY, Math.max(-maxY, transform.y))
  };
}

type Gesture =
  | { type: "pan"; pointerId: number; startX: number; startY: number; transform: ImageTransform }
  | {
      type: "pinch";
      distance: number;
      centerX: number;
      centerY: number;
      transform: ImageTransform;
    }
  | null;

export function ProductImageViewer({
  src,
  alt,
  imageIndex,
  imageCount,
  onClose,
  onPrevious,
  onNext,
  returnFocusRef
}: {
  src: string;
  alt: string;
  imageIndex: number;
  imageCount: number;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<Gesture>(null);
  const transformRef = useRef(INITIAL_TRANSFORM);
  const [transform, setTransform] = useState(INITIAL_TRANSFORM);

  const updateTransform = useCallback((next: ImageTransform) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const clamped = clampImageTransform(next, {
      width: rect?.width ?? window.innerWidth,
      height: rect?.height ?? window.innerHeight
    });
    transformRef.current = clamped;
    setTransform(clamped);
  }, []);

  const resetTransform = useCallback(() => {
    transformRef.current = INITIAL_TRANSFORM;
    setTransform(INITIAL_TRANSFORM);
  }, []);

  const changeImage = useCallback(
    (direction: -1 | 1) => {
      resetTransform();
      if (direction === -1) onPrevious();
      else onNext();
    },
    [onNext, onPrevious, resetTransform]
  );

  useEffect(() => {
    resetTransform();
  }, [resetTransform, src]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && imageCount > 1) changeImage(-1);
      if (event.key === "ArrowRight" && imageCount > 1) changeImage(1);
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      window.setTimeout(() => returnFocusRef.current?.focus(), 0);
    };
  }, [changeImage, imageCount, onClose, returnFocusRef]);

  const startGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];
    if (points.length >= 2) {
      const [first, second] = points;
      if (!first || !second) return;
      gestureRef.current = {
        type: "pinch",
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        centerX: (first.x + second.x) / 2,
        centerY: (first.y + second.y) / 2,
        transform: transformRef.current
      };
      return;
    }
    gestureRef.current = {
      type: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      transform: transformRef.current
    };
  };

  const moveGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = gestureRef.current;
    const points = [...pointersRef.current.values()];
    if (points.length >= 2) {
      const [first, second] = points;
      if (!first || !second) return;
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const centerX = (first.x + second.x) / 2;
      const centerY = (first.y + second.y) / 2;
      if (gesture?.type !== "pinch") {
        gestureRef.current = {
          type: "pinch",
          distance,
          centerX,
          centerY,
          transform: transformRef.current
        };
        return;
      }
      const scale = gesture.transform.scale * (distance / Math.max(1, gesture.distance));
      const rect = viewportRef.current?.getBoundingClientRect();
      const ratio = scale / gesture.transform.scale;
      const originX = gesture.centerX - ((rect?.left ?? 0) + (rect?.width ?? 0) / 2);
      const originY = gesture.centerY - ((rect?.top ?? 0) + (rect?.height ?? 0) / 2);
      updateTransform({
        scale,
        x: originX - (originX - gesture.transform.x) * ratio + centerX - gesture.centerX,
        y: originY - (originY - gesture.transform.y) * ratio + centerY - gesture.centerY
      });
      return;
    }
    if (gesture?.type === "pan" && gesture.pointerId === event.pointerId) {
      updateTransform({
        ...gesture.transform,
        x: gesture.transform.x + event.clientX - gesture.startX,
        y: gesture.transform.y + event.clientY - gesture.startY
      });
    }
  };

  const endGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    const point = pointersRef.current.get(event.pointerId);
    if (
      gesture?.type === "pan" &&
      point &&
      transformRef.current.scale === 1 &&
      Math.abs(point.x - gesture.startX) > 54
    ) {
      changeImage(point.x < gesture.startX ? 1 : -1);
    }
    pointersRef.current.delete(event.pointerId);
    gestureRef.current = null;
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const current = transformRef.current;
    const scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, current.scale * Math.exp(-event.deltaY * 0.002))
    );
    const ratio = scale / current.scale;
    const pointerX = event.clientX - (rect.left + rect.width / 2);
    const pointerY = event.clientY - (rect.top + rect.height / 2);
    updateTransform({
      scale,
      x: pointerX - (pointerX - current.x) * ratio,
      y: pointerY - (pointerY - current.y) * ratio
    });
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (transformRef.current.scale > 1) {
      resetTransform();
      return;
    }
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pointerX = event.clientX - (rect.left + rect.width / 2);
    const pointerY = event.clientY - (rect.top + rect.height / 2);
    updateTransform({ scale: 2, x: -pointerX, y: -pointerY });
  };

  return (
    <div
      ref={dialogRef}
      className="product-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Visualização ampliada de ${alt}`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        ref={closeRef}
        className="product-lightbox-close"
        type="button"
        onClick={onClose}
        aria-label="Fechar visualização ampliada"
      >
        <X />
      </button>
      {imageCount > 1 && (
        <button
          className="product-lightbox-navigation previous"
          type="button"
          onClick={() => changeImage(-1)}
          aria-label="Imagem anterior"
        >
          <ChevronLeft />
        </button>
      )}
      <div
        ref={viewportRef}
        className={
          transform.scale > 1 ? "product-lightbox-image is-zoomed" : "product-lightbox-image"
        }
        onWheel={handleWheel}
        onPointerDown={startGesture}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onDoubleClick={handleDoubleClick}
        aria-label="Use a roda do mouse, gesto de pinça ou toque duplo para ampliar e arraste quando necessário"
      >
        <div
          className="product-lightbox-transform"
          style={{
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`
          }}
        >
          <Image
            src={src}
            alt={`${alt}, imagem ${imageIndex + 1} de ${imageCount}`}
            fill
            sizes="96vw"
            draggable={false}
            priority
          />
        </div>
      </div>
      {imageCount > 1 && (
        <button
          className="product-lightbox-navigation next"
          type="button"
          onClick={() => changeImage(1)}
          aria-label="Próxima imagem"
        >
          <ChevronRight />
        </button>
      )}
      <div className="product-lightbox-toolbar">
        <span className="product-lightbox-counter" aria-live="polite">
          {imageIndex + 1} / {imageCount}
        </span>
        <button type="button" onClick={resetTransform} disabled={transform.scale === 1}>
          <RotateCcw /> Redefinir zoom
        </button>
      </div>
    </div>
  );
}
