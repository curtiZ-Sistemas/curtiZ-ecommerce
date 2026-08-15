"use client";

import { LoaderCircle, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { UserAvatar } from "./user-avatar";

type ProfileAvatarManagerProps = {
  fullName: string;
  avatarUrl?: string;
  compact?: boolean;
};

const maximumBytes = 5 * 1024 * 1024;
const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function ProfileAvatarManager({
  fullName,
  avatarUrl = "",
  compact = false
}: ProfileAvatarManagerProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const upload = async (file: File) => {
    if (busy) return;
    setMessage("");
    setError("");
    if (!acceptedTypes.has(file.type) || file.size < 1 || file.size > maximumBytes) {
      setError("Envie JPG, PNG ou WebP com até 5 MB.");
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.set("file", file);
    try {
      const response = await fetch("/api/customer/avatar", { method: "POST", body: form });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setError(result.message ?? "Não foi possível atualizar a foto.");
        return;
      }
      setMessage(result.message ?? "Foto atualizada com sucesso.");
      router.refresh();
    } catch {
      setError("Não foi possível enviar a foto agora. Tente novamente.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    if (busy || !avatarUrl) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/customer/avatar", { method: "DELETE" });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setError(result.message ?? "Não foi possível remover a foto.");
        return;
      }
      setMessage(result.message ?? "Foto removida.");
      router.refresh();
    } catch {
      setError("Não foi possível remover a foto agora. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`profile-avatar-manager ${compact ? "is-compact" : ""}`.trim()}>
      <UserAvatar name={fullName} src={avatarUrl} size={compact ? "medium" : "large"} />
      <div className="profile-avatar-actions">
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <button
          className="secondary-button compact-button"
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
          {avatarUrl ? "Alterar foto" : "Adicionar foto"}
        </button>
        {avatarUrl && (
          <button
            className="customer-link-button profile-avatar-remove"
            type="button"
            disabled={busy}
            onClick={() => void remove()}
          >
            <Trash2 aria-hidden="true" /> Remover
          </button>
        )}
        <small>JPG, PNG ou WebP · até 5 MB</small>
        {(message || error) && (
          <span className={error ? "profile-avatar-error" : "profile-avatar-success"} role={error ? "alert" : "status"}>
            {error || message}
          </span>
        )}
      </div>
    </div>
  );
}
