// Type hints so TypeScript understands .vue files and Vite.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const c: DefineComponent<object, object, any>;
  export default c;
}

// Set at build time in vite.config.ts.
declare const __ARGUS_VERSION__: string;
declare const __ARGUS_COMMIT__: string;
