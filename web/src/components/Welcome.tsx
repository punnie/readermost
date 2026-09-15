import { useRef, useState } from "react";

import { api } from "../api";

interface Props {
  onDone: () => void;
}

/**
 * The optional post-registration step. Provisioning already succeeded — this
 * only offers to fill the new account with feeds, and skipping is a first-class
 * outcome.
 */
export function Welcome({ onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);

  const importFile = async (file: File) => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.importOPML(file);
      // Large imports keep fetching in the background, so say so rather than
      // pretending the tree is already complete.
      setResult(response.message || "Import started. Your feeds will fill in shortly.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    setBusy(true);
    try {
      await api.markOnboarded();
      onDone();
    } catch {
      // Even if recording the skip fails, let them in; the screen reappearing
      // is a far smaller problem than being stuck here.
      onDone();
    }
  };

  return (
    <div className="centered">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Welcome to Readermost</h2>
        <p style={{ color: "var(--text-muted)" }}>
          Your account is ready. Bring your subscriptions with you, or start from
          scratch — you can import later from Settings either way.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".opml,.xml,application/xml,text/xml"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
          }}
        />

        {result ? (
          <>
            <p>{result}</p>
            <button className="btn btn-primary" onClick={onDone}>
              Start reading
            </button>
          </>
        ) : (
          <>
            {error && <div className="error-banner">{error}</div>}
            <div
              style={{
                display: "flex",
                gap: "8px",
                justifyContent: "center",
                marginTop: "16px",
              }}
            >
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                {busy ? "Importing…" : "Import an OPML file"}
              </button>
              <button className="btn" disabled={busy} onClick={() => void skip()}>
                Skip
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
