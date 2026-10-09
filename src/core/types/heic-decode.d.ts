declare module 'heic-decode' {
  function decode(opts: { buffer: Buffer | Uint8Array }): Promise<{ width: number; height: number; data: Uint8ClampedArray }>
  export default decode
}
