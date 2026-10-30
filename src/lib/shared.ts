export const MAX_TEXT_BYTES = 65_536;
export const MAX_ROOM_BYTES = 2 * 1024 * 1024;
export const MAX_SNIPPETS = 50;
export const EXPIRIES = [
  { seconds: 600, label: "10 minutes", short: "10 min" },
  { seconds: 3600, label: "1 hour", short: "1 hour" },
  { seconds: 86400, label: "24 hours", short: "24 hours" },
  { seconds: 604800, label: "7 days", short: "7 days" },
  { seconds: 2592000, label: "30 days", short: "30 days" },
] as const;
export type Envelope = { v: 1; iv: string; ciphertext: string };
export type EncryptedSnippet = { id: string; envelope: Envelope; createdAt: number };
export type RoomSnapshot = {
  id: string;
  expiresAt: number;
  revision: number;
  padRevision: number;
  pad: Envelope | null;
  snippets: Record<string, EncryptedSnippet>;
  bytes: number;
};
export type RoomRead = RoomSnapshot | { unchanged: true; expiresAt: number; revision: number };
export type RoomSecrets = { key: string; token: string };
export const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;

export function remainingTime(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  if (!seconds) return "Expired";
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h left`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m left`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s left`;
  return `${seconds}s left`;
}
