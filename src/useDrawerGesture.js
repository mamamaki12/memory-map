import { useRef, useState } from 'react';

// The handle owns its drag; the list keeps native scrolling until pulled down at its top.
export default function useDrawerGesture(open, setOpen) {
  const pointer = useRef(null);
  const touch = useRef(null);
  const suppressClickUntil = useRef(0);
  const [dragOffset, setDragOffset] = useState(null);
  const mobile = () => window.matchMedia('(max-width:700px)').matches;
  const finish = (event, cancelled = false) => {
    const start = pointer.current;
    if (!start || start.id !== event.pointerId) return;
    const delta = event.clientY - start.y;
    if (Math.abs(delta) > 8 || cancelled) suppressClickUntil.current = performance.now() + 500;
    if (!cancelled && Math.abs(delta) >= 40) setOpen(delta < 0);
    pointer.current = null;
    setDragOffset(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return {
    dragOffset,
    handleProps: {
      onPointerDown(event) {
        if (!mobile() || !event.isPrimary || event.button !== 0) return;
        const panel = event.currentTarget.closest('aside');
        pointer.current = {
          id: event.pointerId, y: event.clientY,
          travel: Math.max(0, panel.clientHeight - event.currentTarget.offsetHeight - parseFloat(getComputedStyle(panel).paddingBottom)),
        };
        suppressClickUntil.current = 0;
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event) {
        const start = pointer.current;
        if (!start || start.id !== event.pointerId) return;
        const delta = event.clientY - start.y;
        setDragOffset(open ? Math.min(start.travel, Math.max(0, delta)) : Math.max(-start.travel, Math.min(0, delta)));
      },
      onPointerUp: event => finish(event),
      onPointerCancel: event => finish(event, true),
      onClick(event) {
        if (event.detail !== 0 && performance.now() < suppressClickUntil.current) return;
        setOpen(value => !value);
      },
      onWheel(event) {
        if (mobile() && Math.abs(event.deltaY) > 8) setOpen(event.deltaY < 0);
      },
    },
    listProps: {
      onTouchStart(event) {
        if (!mobile() || event.touches.length !== 1) { touch.current = null; return; }
        const point = event.touches[0];
        touch.current = { x: point.clientX, y: point.clientY, atTop: event.currentTarget.scrollTop <= 0 };
      },
      onTouchEnd(event) {
        const start = touch.current;
        touch.current = null;
        if (!start?.atTop || !event.changedTouches.length) return;
        const point = event.changedTouches[0];
        const dy = point.clientY - start.y;
        if (dy > 60 && dy > Math.abs(point.clientX - start.x)) {
          suppressClickUntil.current = performance.now() + 500;
          setOpen(false);
        }
      },
      onTouchCancel() { touch.current = null; },
      onClickCapture(event) {
        if (performance.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); }
      },
    },
  };
}
