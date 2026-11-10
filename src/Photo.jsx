import React, { useEffect, useState } from 'react';

// A saved photo (a Blob) shown as an image.
export default function Photo({ blob, ...props }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const value = URL.createObjectURL(blob);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [blob]);
  return url ? <img {...props} src={url} /> : null;
}
