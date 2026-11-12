import React, { useEffect, useRef, useState } from 'react';

// Small copies for lists, made once per photo and only when they come near the screen.
const thumbs = new WeakMap();
function thumbnail(blob, size) {
  if (!thumbs.has(blob)) thumbs.set(blob, (async () => {
    try {
      const bitmap = await createImageBitmap(blob, { resizeWidth: size, resizeQuality: 'medium' });
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close?.();
      const small = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .82));
      return URL.createObjectURL(small || blob);
    } catch { return URL.createObjectURL(blob); }
  })());
  return thumbs.get(blob);
}

// A saved photo (a Blob) shown as an image. With `thumb`, a small copy is drawn instead, and only once the
// picture is within 400px of being seen in its list; until then an empty box of the same size keeps its place.
export default function Photo({ blob, thumb, ...props }) {
  const [url, setUrl] = useState('');
  const box = useRef(null);
  useEffect(() => {
    if (thumb) return;
    const value = URL.createObjectURL(blob);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [blob, thumb]);
  useEffect(() => {
    if (!thumb) return;
    let live = true;
    const show = () => thumbnail(blob, thumb).then(value => { if (live) setUrl(value); });
    if (typeof IntersectionObserver === 'undefined' || !box.current) { show(); return () => { live = false; }; }
    const watcher = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { watcher.disconnect(); show(); }
    }, { root: box.current.closest('.list, dialog'), rootMargin: '400px' });
    watcher.observe(box.current);
    return () => { live = false; watcher.disconnect(); };
  }, [blob, thumb]);
  if (url) return <img {...props} src={url} />;
  if (!thumb) return null;
  return <span ref={box} className={'photo-placeholder' + (props.className ? ' ' + props.className : '')} {...(props.alt ? { role: 'img', 'aria-label': props.alt } : { 'aria-hidden': 'true' })} />;
}
