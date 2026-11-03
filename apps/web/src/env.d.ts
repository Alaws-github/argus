// Type hints so TypeScript understands .vue files and Vite.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const c: DefineComponent<object, object, any>;
  export default c;
}
