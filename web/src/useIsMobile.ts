import { useEffect, useState } from "react";

/** Below this the app switches to the phone layout. */
export const MOBILE_BREAKPOINT = 860;

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * Whether to show the phone layout.
 *
 * Subscribes to the query rather than reading the width once, so rotating a
 * tablet or dragging a desktop window narrow re-lays out immediately.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const update = (event: MediaQueryListEvent) => setIsMobile(event.matches);

    setIsMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return isMobile;
}
