// Markdown bundled as text (the user guide and the changelog): Vite's ?raw import.
declare module '*.md?raw' {
  const text: string
  export default text
}

// An asset's URL (the app icon shown in the window): Vite's ?url import.
declare module '*.svg?url' {
  const url: string
  export default url
}
