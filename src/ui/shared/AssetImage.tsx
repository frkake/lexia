/**
 * L4 — AssetImage: the display-side resolver for stored illustrations (F-5 第3段 / design decision D7).
 *
 * Illustration bytes live as Blobs in the `images` table, referenced from records by
 * `lexia-image:<imageId>`. This component (and its `useImageSource` hook) turns such a reference into a
 * displayable object URL — reading the blob from the app container and managing the object URL's
 * lifecycle (revoked on unmount / src change). Anything that is NOT a ref (a legacy inline `data:` URL,
 * an `http(s):` URL, an object URL) passes straight through, so old records and container-less renders
 * (the gallery / isolated component tests) keep working unchanged.
 */

import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { imageIdFromRef } from '../../infra/persistence/imageStore';
import { useOptionalContainer } from '../app/AppContext';

/**
 * Resolve a possibly-referenced image source to a displayable URL. Plain URLs are returned as-is
 * (synchronously); a `lexia-image:` ref resolves to an object URL once its blob loads (undefined until
 * then), and the object URL is revoked when the src changes or the component unmounts.
 */
export function useImageSource(src: string | null | undefined): string | undefined {
  const container = useOptionalContainer();
  const imageId = imageIdFromRef(src);
  const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!imageId || !container || typeof URL.createObjectURL !== 'function') {
      setObjectUrl(undefined);
      return;
    }
    let cancelled = false;
    let created: string | undefined;
    void container.repos.images
      .get(imageId)
      .then((record) => {
        if (cancelled || !record) return;
        created = URL.createObjectURL(record.blob);
        setObjectUrl(created);
      })
      .catch(() => {
        /* missing/unreadable image — leave unresolved (caller shows its placeholder) */
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [imageId, container]);

  if (!src) return undefined;
  if (!imageId) return src; // already a displayable URL (data / http / blob)
  return objectUrl;
}

export type AssetImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | null | undefined;
};

/** `<img>` that resolves a `lexia-image:` reference to an object URL; identical for plain URLs. */
export function AssetImage({ src, ...rest }: AssetImageProps): React.ReactElement {
  const resolved = useImageSource(src);
  return <img src={resolved} {...rest} />;
}
