/**
 * Where the game runs. On clutchzone.pro the page and the game server share an origin; a portal build
 * (CrazyGames, itch.io) is served by the portal and plays on our server, and must not link players away.
 * The desktop app plays on our server too, and its invite links point at clutchzone.pro.
 */
export const SERVER: string = import.meta.env.VITE_SERVER ?? ""; // "https://clutchzone.pro", or "" for this origin
export const PORTAL: string = import.meta.env.VITE_PORTAL ?? ""; // "crazygames", "itch", "desktop", or ""

export const api = (path: string) => `${SERVER}/api/${path}`;

export function wsUrl(query: URLSearchParams): string {
  const origin = SERVER || `${location.protocol}//${location.host}`;
  return `${origin.replace(/^http/, "ws")}/ws?${query}`;
}
