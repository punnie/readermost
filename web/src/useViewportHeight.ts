import { useEffect } from "react";

/**
 * Publishes the *visible* viewport height as `--app-vh`.
 *
 * On iOS the on-screen keyboard overlays the page without changing `100dvh`,
 * so a bottom-anchored control — a dialog's buttons, a reply box, the tab bar —
 * ends up underneath it and cannot be reached. visualViewport reports the area
 * actually left over, which is what the app should size itself to.
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;

    const apply = () => {
      const height = viewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-vh", `${height}px`);
    };

    apply();

    if (!viewport) {
      window.addEventListener("resize", apply);
      return () => window.removeEventListener("resize", apply);
    }

    viewport.addEventListener("resize", apply);
    // Scrolling the visual viewport happens when the keyboard pans the page.
    viewport.addEventListener("scroll", apply);
    return () => {
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
    };
  }, []);
}
