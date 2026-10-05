import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";

import { App } from "./App";
import { ApiError } from "./api";
import { persister } from "./persist";
import { applyReadingPrefs, readCachedReadingPrefs } from "./reading";
import "./styles.css";

// OpenDyslexic ships with the app rather than from a font CDN, so it works
// offline and the service worker precaches it with everything else. Browsers
// only download a face once something on the page uses it.
import "@fontsource/opendyslexic/latin-400.css";
import "@fontsource/opendyslexic/latin-400-italic.css";
import "@fontsource/opendyslexic/latin-700.css";
import "@fontsource/opendyslexic/latin-700-italic.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Long enough that a restored cache is worth having, short enough that
      // it does not grow without bound.
      gcTime: 7 * 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Retrying a 401 just burns requests on a dead session.
        if (error instanceof ApiError && error.isUnauthorized) return false;
        return failureCount < 2;
      },
    },
  },
});

// Before the first paint, so a reload does not flash the default typeface.
applyReadingPrefs(readCachedReadingPrefs());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        dehydrateOptions: {
          // Persist only what is worth reading offline. Lookups and
          // short-lived queries would just bloat the stored blob.
          shouldDehydrateQuery: (query) => {
            const root = query.queryKey[0];
            return (
              query.state.status === "success" &&
              (root === "me" ||
                root === "tree" ||
                root === "entries" ||
                root === "entry" ||
                root === "shared" ||
                root === "shared-article" ||
                root === "thread" ||
                root === "reading-prefs")
            );
          },
        },
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
);
