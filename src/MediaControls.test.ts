import { expect, it } from "vitest";
import { mediaTime, mediaDuration, playbackPosition } from "./MediaControls";
import type { Player } from "./types";
it("formats missing and long timelines, extrapolates playing only and caps stale samples", () => {
  expect(mediaTime(null)).toBe("—:—");
  expect(mediaTime(3661)).toBe("1:01:01");
  const player = {
    position: 30,
    duration: 60,
    sampledAt: 100,
    playing: true,
  } as Player;
  expect(playbackPosition(player, 105000)).toBe(35);
  expect(playbackPosition({ ...player, playing: false }, 105000)).toBe(30);
  expect(playbackPosition(player, 200000)).toBe(45);
  expect(playbackPosition({ ...player, position: 59 }, 105000)).toBe(60);
});

it("rounds total duration up like YouTube Music while preserving fractional seek limits", () => {
  expect(mediaDuration(171.237097)).toBe("2:52");
  expect(mediaTime(171.237097)).toBe("2:51");
  expect(mediaDuration(null)).toBe("—:—");
  expect(mediaDuration(-0.2)).toBe("—:—");
  const player = {
    position: 170,
    duration: 171.237097,
    sampledAt: 100,
    playing: true,
  } as Player;
  expect(playbackPosition(player, 105000)).toBe(171.237097);
});
