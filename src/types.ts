export type Language = "en" | "tr";
export type Provider = "spotify" | "system";
export interface InstalledApplication {
  id: string;
  name: string;
  aliases: string[];
}
export type Matcher =
  | {
      kind: "app" | "domain" | "title" | "fileExtension";
      value: string;
    }
  | { kind: "apps"; value: InstalledApplication[] };
export type Action =
  { kind: "pause" } | { kind: "play"; playlist: string | null };
export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  matcher: Matcher;
  action: Action;
}
export interface Settings {
  language: Language;
  notchEnabled: boolean;
  notchNowPlaying: boolean;
  notchFullscreen: boolean;
  version: number;
  enabled: boolean;
  provider: Provider;
  spotifyWeb: boolean;
  spotifyClientId: string;
  targetPlayer: string;
  pollMs: number;
  settleMs: number;
  fadeMs: number;
  pauseOnOtherAudio: boolean;
  browserBridge: boolean;
  rules: Rule[];
}
export interface Context {
  app: string;
  appId: string;
  title: string;
  url: string | null;
  document: string | null;
  isBrowser: boolean;
  otherAudio: boolean | null;
  source: string;
}
export interface Player {
  id: string;
  name: string;
  playing: boolean | null;
  volume: number | null;
  track: string;
  artist: string;
  canPlay: boolean;
  canPause: boolean;
  canOpenUri: boolean;
  trackId?: string;
  artwork?: string | null;
  duration?: number | null;
  displayDuration?: number | null;
  position?: number | null;
  sampledAt?: number | null;
  canSeek?: boolean;
  canNext?: boolean;
  canPrevious?: boolean;
}
export interface Permissions {
  accessibility: boolean;
  automation: string;
  platform: string;
  capabilities: { name: string; available: boolean; detail: string }[];
}
export interface Status {
  enabled: boolean;
  context: Context;
  lastContext?: Context | null;
  player: Player | null;
  decision: string;
  activeRule: string | null;
  error: string | null;
  manualOverride: boolean;
  bridgeConnected: boolean;
  activity: ActivityEntry[];
}
export interface Snapshot {
  settings: Settings;
  status: Status;
  permissions: Permissions;
  players: Player[];
}

export interface ActivityEntry {
  time: number;
  message: string;
  level: string;
  playback?: {
    app: string;
    reason: string;
    ruleName: boolean;
    player: string;
    action: string;
  };
}

export type TransportAction =
  | { kind: "next" | "previous" }
  | { kind: "seek"; position: number; trackId: string };
export interface TransportRequest {
  playerId: string;
  action: TransportAction;
}
