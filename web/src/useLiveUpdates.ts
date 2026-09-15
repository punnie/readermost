import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface LiveEvent {
  type: "posted" | "post_edited" | "post_deleted";
  post_id?: string;
  root_id?: string;
}

/**
 * Keeps the shared river and open threads current without polling.
 *
 * The server relays Mattermost events for the shared channel; we translate them
 * into cache invalidations rather than trying to patch posts in by hand, which
 * keeps one source of truth for what a post looks like.
 */
export function useLiveUpdates(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let attempt = 0;
    let closed = false;

    const connect = () => {
      if (closed) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/api/ws`);

      socket.onopen = () => {
        attempt = 0;
      };

      socket.onmessage = (message) => {
        let event: LiveEvent;
        try {
          event = JSON.parse(message.data as string);
        } catch {
          return;
        }

        void queryClient.invalidateQueries({ queryKey: ["shared"] });

        // A reply invalidates its thread; a new root post has no thread yet.
        if (event.root_id) {
          void queryClient.invalidateQueries({ queryKey: ["thread", event.root_id] });
        } else if (event.post_id) {
          void queryClient.invalidateQueries({ queryKey: ["thread", event.post_id] });
        }
      };

      socket.onclose = () => {
        if (closed) return;
        // Back off, capped, so a server restart does not become a hot loop.
        const delay = Math.min(1000 * 2 ** attempt, 30_000);
        attempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [enabled, queryClient]);
}
