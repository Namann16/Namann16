/// <reference types="vite/client" />

/**
 * Client-side environment variables.
 *
 * Only VITE_-prefixed values reach the browser bundle, and none of them is a secret:
 * the API base URL is public by definition. Server-side keys live in the API process alone.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
