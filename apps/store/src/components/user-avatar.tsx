import Image from "next/image";

type UserAvatarProps = {
  name: string;
  src?: string;
  size?: "small" | "medium" | "large";
  className?: string;
};

export function UserAvatar({
  name,
  src = "",
  size = "medium",
  className = ""
}: UserAvatarProps) {
  const initial = name.trim().slice(0, 1).toUpperCase() || "U";

  return (
    <span
      className={`user-avatar user-avatar-${size} ${className}`.trim()}
      aria-label={`Foto de perfil de ${name}`}
      role="img"
    >
      {src ? (
        <Image
          src={src}
          alt=""
          fill
          sizes={size === "large" ? "80px" : size === "small" ? "36px" : "56px"}
          unoptimized
        />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </span>
  );
}
