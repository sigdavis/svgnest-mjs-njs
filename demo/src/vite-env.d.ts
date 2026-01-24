/// <reference types="vite/client" />

declare module '*?url' {
  const content: string;
  export default content;
}

declare module '*?worker' {
  const content: new () => Worker;
  export default content;
}
