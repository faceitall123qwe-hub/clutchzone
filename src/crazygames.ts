import { PORTAL } from "./config";

/** The parts of the CrazyGames HTML5 SDK v3 we use (docs.crazygames.com/sdk/game, /sdk/user). */
export type CrazySDK = {
  init(): Promise<void>;
  environment: "local" | "crazygames" | "disabled";
  game: {
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
    isInstantMultiplayer: boolean;
    inviteParams: Record<string, string> | null;
    inviteLink(params: Record<string, string>): string;
    updateRoom(room: { roomId?: string; isJoinable?: boolean; inviteParams?: Record<string, string> }): void;
    leftRoom(): void;
    addJoinRoomListener(fn: (params: Record<string, string>) => void): void;
    settings: { muteAudio: boolean };
    addSettingsChangeListener(fn: (settings: { muteAudio: boolean }) => void): void;
  };
  user: { getUser(): Promise<{ username: string } | null> };
};

/**
 * On CrazyGames: loads and starts their SDK. Elsewhere (our own site, itch.io) there is nothing to load,
 * and on a domain the SDK doesn't recognise it is "disabled" and every call would throw.
 */
export async function crazyGames(): Promise<CrazySDK | null> {
  if (PORTAL !== "crazygames") return null;
  try {
    await new Promise<void>((ok, fail) => {
      const s = document.createElement("script");
      s.src = "https://sdk.crazygames.com/crazygames-sdk-v3.js";
      s.onload = () => ok();
      s.onerror = () => fail(new Error("CrazyGames SDK didn't load"));
      document.head.append(s);
    });
    const sdk = (window as unknown as { CrazyGames: { SDK: CrazySDK } }).CrazyGames.SDK;
    await sdk.init();
    return sdk.environment === "disabled" ? null : sdk;
  } catch {
    return null; // an ad blocker can stop the script: the game still works without the platform features
  }
}
