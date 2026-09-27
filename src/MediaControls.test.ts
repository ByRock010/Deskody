import { expect, it } from "vitest";
import { mediaTime, playbackPosition } from "./MediaControls";
import type { Player } from "./types";
it("formats missing and long timelines, extrapolates playing only and caps stale samples", () => {
  expect(mediaTime(null)).toBe("—:—");
  expect(mediaTime(3661)).toBe("1:01:01");
  const player = { position: 30, duration: 60, sampledAt: 100, playing: true } as Player;
  expect(playbackPosition(player, 105000)).toBe(35);
  expect(playbackPosition({ ...player, playing: false }, 105000)).toBe(30);
  expect(playbackPosition(player, 200000)).toBe(45);
  expect(playbackPosition({ ...player, position: 59 }, 105000)).toBe(60);
});
