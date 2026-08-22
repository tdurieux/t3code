# Bundled Semasmith WASM

These files contain the project-navigation engine produced by the `codeapi_ts` repository.
`semasmith.wasm` stores the raw WebAssembly build as deterministic gzip data. The review worker
decompresses it before compilation, which keeps the checked-in and packaged asset small without
moving decompression work onto the server's main thread.

- `semasmith.wasm` compressed SHA-256:
  `b7c5a13d238ef96d4684e46ea03608bb99f3020f9118f0ea50adbab95853ce29`
- `semasmith.wasm` decompressed SHA-256:
  `20adca915040e1dae2c9c69224e2860b880928d5c6667746cc4065d2c9868596`
- `semasmith.mjs` SHA-256:
  `a9301effcb0a75c8e63dabbfc2d7f48cd62834232e11f59624b4a11758d2c858`

To update the embedded engine, rebuild CodeAPI's WASM target, copy `codeapi_ir.mjs` here as
`semasmith.mjs`, then compress the raw `codeapi_ir.wasm` with `gzip -9 -n` and save those bytes as
`semasmith.wasm`. The server build copies this directory to `dist/codeapi`, which the CLI package
and desktop application include.
