import { useEffect, useState } from "react";

/**
 * Whether the browser thinks it has a network.
 *
 * navigator.onLine is only ever trustworthy when it says *false* — a laptop on
 * a captive-portal wifi reports online. That asymmetry is fine here: this drives
 * a banner and disables a few buttons, and being wrong in the optimistic
 * direction just means a request fails the way it would have anyway.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
