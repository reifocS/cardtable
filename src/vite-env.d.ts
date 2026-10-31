/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TURN_CREDENTIALS_URL?: string;
  readonly VITE_ICE_SERVERS?: string;
}

/** This build's name (see vite.config.ts); 'dev' under `npm run dev`. */
declare const __BUILD__: string;
