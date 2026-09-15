import { Fragment } from "react";

interface Props {
  onClose: () => void;
}

const BINDINGS: [string, string][] = [
  ["j", "Next article"],
  ["k", "Previous article"],
  ["o / Enter", "Open selected article"],
  ["m", "Toggle read / unread"],
  ["s", "Star"],
  ["S", "Share to Mattermost"],
  ["v", "Open original in a new tab"],
  ["r", "Refresh all feeds"],
  ["A", "Mark everything read"],
  ["g then u", "Go to unread"],
  ["g then a", "Go to all items"],
  ["?", "This list"],
];

export function Shortcuts({ onClose }: Props) {
  return (
    <div
      className="backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true">
        <h3>Keyboard shortcuts</h3>
        <div className="shortcuts">
          {BINDINGS.map(([key, description]) => (
            <Fragment key={key}>
              <kbd>{key}</kbd>
              <span>{description}</span>
            </Fragment>
          ))}
        </div>
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
