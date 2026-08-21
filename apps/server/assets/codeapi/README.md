# Bundled CodeAPI WASM

These files are the browser/project-navigation build produced by the
`codeapi_ts` repository.

- `codeapi_ir.wasm` SHA-256:
  `20adca915040e1dae2c9c69224e2860b880928d5c6667746cc4065d2c9868596`
- `codeapi_ir.mjs` SHA-256:
  `824b7d2416ed891d5f31fefbe22821c464b41644ef424402f6699bf31e12b812`

To update the embedded engine, rebuild CodeAPI's WASM target and copy
`dist/wasm/codeapi_ir.{mjs,wasm}` here together. The server build copies this
directory to `dist/codeapi`, which is included in the CLI package and desktop
application.
