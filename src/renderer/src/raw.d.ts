// Markdown bundled as text (the user guide and the changelog): Vite's ?raw import.
declare module '*.md?raw' {
  const text: string
  export default text
}
