import { useEffect, useRef, useState } from "react";
import { Music2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { api, desktop } from "./bridge";
import { t } from "./i18n";
import type { Player, TransportRequest } from "./types";
import "./media.css";

export function mediaTime(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—:—";
  const seconds = Math.floor(value);
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    : `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
// Match YouTube Music's total-time label without rounding the actual seek range.
export function mediaDuration(value: number | null | undefined): string {
  return mediaTime(value == null || value < 0 ? value : Math.ceil(value));
}
export function playbackPosition(
  player: Player | null | undefined,
  now: number,
): number | null {
  if (player?.position == null || !Number.isFinite(player.position))
    return null;
  const elapsed =
    player.playing && player.sampledAt
      ? Math.max(0, Math.min(15, now / 1000 - player.sampledAt))
      : 0;
  return Math.min(
    player.duration ?? Infinity,
    Math.max(0, player.position + elapsed),
  );
}

export default function MediaControls({
  player,
  compact = false,
  disabled,
  onMedia,
  onTransport,
}: {
  player: Player | null | undefined;
  compact?: boolean;
  disabled: boolean;
  onMedia: (action: "play" | "pause") => void;
  onTransport: (request: TransportRequest) => void;
}) {
  const [now, setNow] = useState(Date.now);
  const [draft, setDraft] = useState<number | null>(null);
  const [pending, setPending] = useState<{
    playerId: string;
    trackId: string;
    position: number;
    duration: number;
    displayDuration?: number;
    sentAt: number;
  } | null>(null);
  const [failedImage, setFailedImage] = useState("");
  const gesture = useRef<{
    playerId: string;
    trackId: string;
    duration: number;
    displayDuration?: number;
  } | null>(null);
  const valueRef = useRef<number | null>(null);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) void api.observeMedia().catch(() => {});
    };
    refresh();
    const lease = setInterval(refresh, 2500);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(lease);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  useEffect(() => {
    setNow(Date.now());
    if (!player?.playing && !pending) return;
    const clock = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 250);
    return () => clearInterval(clock);
  }, [player?.playing, player?.position, player?.sampledAt, pending]);
  // Keep an in-flight gesture bound to its original track until release.
  useEffect(() => {
    valueRef.current = null;
    setDraft(null);
  }, [player?.id, player?.trackId]);

  useEffect(() => {
    if (!pending) return;
    const same =
      pending.playerId === player?.id && pending.trackId === player.trackId;
    const confirmed =
      player?.sampledAt != null &&
      player.sampledAt >= pending.sentAt / 1000 &&
      player.position != null &&
      Math.abs(player.position - pending.position) < 1.5;
    if (!same || confirmed || now - pending.sentAt > 3000) setPending(null);
  }, [player, pending, now]);
  const samePending =
    pending?.playerId === player?.id && pending?.trackId === player?.trackId
      ? pending
      : null;
  const duration =
    draft != null
      ? gesture.current?.duration
      : (samePending?.duration ?? player?.duration);
  const displayDuration =
    draft != null
      ? (gesture.current?.displayDuration ?? duration)
      : (samePending?.displayDuration ?? player?.displayDuration ?? duration);
  const position =
    draft ??
    (samePending
      ? Math.min(
          samePending.duration,
          samePending.position +
            (player?.playing
              ? Math.max(0, now - samePending.sentAt) / 1000
              : 0),
        )
      : playbackPosition(player, now));
  const timeline =
    duration != null &&
    Number.isFinite(duration) &&
    duration > 0 &&
    position != null;
  const canSeek = !!(
    timeline &&
    player?.canSeek &&
    player.trackId &&
    !disabled &&
    desktop
  );
  const max = timeline ? Math.max(0, duration - 0.05) : 1;
  const image = player?.artwork;
  const showImage =
    image &&
    image !== failedImage &&
    /^data:image\/(png|jpeg|webp);base64,/.test(image);
  const playing = player?.playing === true;
  const begin = () => {
    if (canSeek && player && !gesture.current)
      gesture.current = {
        playerId: player.id,
        trackId: player.trackId!,
        duration: duration!,
        displayDuration: player.displayDuration ?? undefined,
      };
  };
  const cancel = () => {
    gesture.current = null;
    valueRef.current = null;
    setDraft(null);
  };
  const commit = () => {
    const target = gesture.current;
    const value = valueRef.current;
    cancel();
    if (
      canSeek &&
      target &&
      value != null &&
      target.playerId === player?.id &&
      target.trackId === player.trackId
    ) {
      const position = Math.min(max, Math.max(0, value));
      setPending({ ...target, position, sentAt: Date.now() });
      onTransport({
        playerId: target.playerId,
        action: { kind: "seek", trackId: target.trackId, position },
      });
    }
  };
  const skip = (kind: "next" | "previous") => {
    if (player) onTransport({ playerId: player.id, action: { kind } });
  };
  return (
    <div className={`media-player ${compact ? "media-compact" : "media-full"}`}>
      <div className="media-summary">
        <div className="media-cover">
          {showImage ? (
            <img
              src={image}
              alt={t("Albüm kapağı")}
              onError={() => setFailedImage(image)}
            />
          ) : (
            <Music2 aria-hidden="true" />
          )}
        </div>
        <div className="media-details">
          <h3 title={player?.track}>
            {player?.track || t("Oynatıcı bekleniyor")}
          </h3>
          <p title={player?.artist}>
            {player?.artist ||
              (player
                ? t("Parça bilgisi yok")
                : t("Spotify veya YouTube Music’i aç"))}
          </p>
          <span className="media-source">
            {t(player?.name || "Müzik oynatıcı")}
          </span>
        </div>
      </div>
      <div className="media-timeline">
        <input
          type="range"
          aria-label={t("Oynatma konumu")}
          aria-valuetext={`${mediaTime(position)} / ${mediaDuration(displayDuration)}`}
          title={
            canSeek
              ? t("Oynatma konumu")
              : t("Bu parçada konum değiştirme desteklenmiyor")
          }
          min={0}
          max={max}
          step="any"
          value={Math.min(max, position ?? 0)}
          disabled={!canSeek}
          onPointerDown={begin}
          onPointerUp={commit}
          onPointerCancel={cancel}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              cancel();
              e.preventDefault();
            } else if (
              [
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
                "PageUp",
                "PageDown",
              ].includes(e.key)
            )
              begin();
          }}
          onKeyUp={(e) => {
            if (
              [
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
                "PageUp",
                "PageDown",
              ].includes(e.key)
            )
              commit();
          }}
          onChange={(e) => {
            begin();
            const value = Number(e.target.value);
            valueRef.current = value;
            setDraft(value);
          }}
        />
        <div className="media-times" aria-hidden="true">
          <span>{mediaTime(position)}</span>
          <span>{mediaDuration(displayDuration)}</span>
        </div>
      </div>
      <div className="media-buttons">
        <button
          type="button"
          aria-label={t("Önceki parça")}
          title={t("Önceki parça")}
          disabled={disabled || !desktop || !player?.canPrevious}
          onClick={() => skip("previous")}
        >
          <SkipBack size={20} fill="currentColor" />
        </button>
        <button
          type="button"
          className="media-toggle"
          aria-label={t(playing ? "Müziği duraklat" : "Müziği çal")}
          disabled={
            disabled ||
            !desktop ||
            !(playing ? player?.canPause : player?.canPlay)
          }
          onClick={() => onMedia(playing ? "pause" : "play")}
        >
          {playing ? (
            <Pause size={22} fill="currentColor" />
          ) : (
            <Play size={22} fill="currentColor" />
          )}
        </button>
        <button
          type="button"
          aria-label={t("Sonraki parça")}
          title={t("Sonraki parça")}
          disabled={disabled || !desktop || !player?.canNext}
          onClick={() => skip("next")}
        >
          <SkipForward size={20} fill="currentColor" />
        </button>
      </div>
    </div>
  );
}
