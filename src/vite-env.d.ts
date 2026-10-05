/// <reference types="vite/client" />

// eslint-disable-next-line no-var -- Ambient globals require var for globalThis typing.
declare var __TWIN_CONFIG__:
  | {
      apiBaseUrl?: string;
      grafanaBaseUrl?: string;
      allowLocalApiFallback?: boolean;
    }
  | undefined;
