import { useState } from "react";

interface Props {
  feedId: number;
  hasIcon: boolean;
}

/**
 * A feed's favicon, falling back to a neutral placeholder.
 *
 * Two things go wrong here and both look identical to the user — a broken-image
 * pictogram in the sidebar. A feed Miniflux has not fetched yet has no icon at
 * all, and an icon can disappear later. So the placeholder is the default and
 * the image only replaces it once it has actually loaded.
 */
export function FeedIcon({ feedId, hasIcon }: Props) {
  const [failed, setFailed] = useState(false);

  if (!hasIcon || failed) {
    return <span className="favicon favicon-blank" aria-hidden="true" />;
  }

  return (
    <img
      className="favicon"
      src={`/api/feeds/${feedId}/icon`}
      alt=""
      loading="lazy"
      width={14}
      height={14}
      onError={() => setFailed(true)}
    />
  );
}
