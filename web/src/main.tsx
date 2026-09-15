import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";

import { App } from "./App";
import { ApiError } from "./api";
import { persister } from "./persist";
import "./styles.css";

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
                root === "shared" ||
                root === "shared-article" ||
                root === "thread")
            );
          },
        },
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
);
