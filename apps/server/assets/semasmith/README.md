# Bundled Semasmith WASM

These files contain the Semasmith project-navigation engine.
`semasmith.wasm` stores the raw WebAssembly build as deterministic gzip data. The review worker
decompresses it before compilation, which keeps the checked-in and packaged asset small without
moving decompression work onto the server's main thread.

- `semasmith.wasm` compressed SHA-256:
  `b7c5a13d238ef96d4684e46ea03608bb99f3020f9118f0ea50adbab95853ce29`
- `semasmith.wasm` decompressed SHA-256:
  `20adca915040e1dae2c9c69224e2860b880928d5c6667746cc4065d2c9868596`
- `semasmith.mjs` SHA-256:
  `bdd2036578f05bd39b349344e4b0faf6130404a1b280e688d10ec12fd84964df`

To update the embedded engine, rebuild Semasmith's WASM target and copy `semasmith.mjs` here. Then
compress the raw `semasmith.wasm` with `gzip -9 -n` and save those bytes as `semasmith.wasm`. The
server build copies this directory to `dist/semasmith`, which the CLI package and desktop
application include.
