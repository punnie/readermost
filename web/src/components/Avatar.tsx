interface Props {
  userId: string;
  name: string;
  size?: number;
}

/**
 * A Mattermost profile picture, proxied through the server because the image
 * endpoint needs a token the browser never sees.
 *
 * Mattermost renders a coloured initial when someone has no picture set, so
 * there is no empty state to design for — but the image can still fail (a
 * deactivated user, a dropped request), and an alt-text-only box looks broken,
 * so a failure falls back to a plain initial.
 */
export function Avatar({ userId, name, size = 24 }: Props) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();

  return (
    <span className="avatar" style={{ width: size, height: size }} aria-hidden="true">
      <span className="avatar-initial">{initial}</span>
      <img
        src={`/api/users/${userId}/avatar`}
        alt=""
        loading="lazy"
        width={size}
        height={size}
        onError={(event) => {
          // Reveal the initial underneath rather than a broken-image icon.
          event.currentTarget.style.display = "none";
        }}
      />
    </span>
  );
}
