import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as NodeURL from "node:url";
import * as NodeZlib from "node:zlib";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { WasmCodeNavigation } from "./WasmCodeNavigation.ts";

const fakeModule = `
export default async function createSemasmith(moduleArg) {
  await new Promise((resolve) => moduleArg.instantiateWasm({}, resolve));
  return {
    createProject(_files, language) {
      return {
        build() {
          return {
            language,
            fileCount: 1,
            hasCallGraph: true,
            errors: [],
            timings: {},
          };
        },
        definitionAt(_path, line) {
          if (line === 4) {
            return {
              name: "budget",
              fqName: "budget",
              kind: "variableDecl",
              filePath: "example.go",
              symbolId: 7,
              location: {
                filePath: "example.go",
                startLine: 3,
                startColumn: 1,
                endLine: 3,
                endColumn: 7,
              },
            };
          }
          return line === 2
            ? {
                name: "run",
                fqName: "example.run",
                kind: "functionDecl",
                filePath: "example.go",
                symbolId: 1,
                location: {
                  filePath: "example.go",
                  startLine: 1,
                  startColumn: 1,
                  endLine: 1,
                  endColumn: 30,
                },
              }
            : null;
        },
        referencesOf(symbol) {
          if (symbol === "run") return [];
          if (symbol === "Function") return [];
          if (symbol === "example.Function") {
            return [
              {
                name: "Function",
                fqName: "example.Function",
                kind: "typeDecl",
                filePath: "example.go",
                symbolId: 11,
                location: {
                  filePath: "example.go",
                  startLine: 3,
                  startColumn: 6,
                  endLine: 3,
                  endColumn: 14,
                },
                isDefinition: true,
              },
            ];
          }
          if (symbol?.name === "budget") {
            return [
              {
                ...symbol,
                isDefinition: true,
              },
              {
                ...symbol,
                location: {
                  filePath: "example.go",
                  startLine: 4,
                  startColumn: 8,
                  endLine: 4,
                  endColumn: 14,
                },
                isDefinition: false,
              },
              {
                ...symbol,
                symbolId: 9,
                location: {
                  filePath: "example.go",
                  startLine: 8,
                  startColumn: 1,
                  endLine: 8,
                  endColumn: 7,
                },
                isDefinition: true,
              },
              {
                ...symbol,
                filePath: "other.go",
                location: {
                  filePath: "other.go",
                  startLine: 5,
                  startColumn: 1,
                  endLine: 5,
                  endColumn: 7,
                },
                isDefinition: true,
              },
            ];
          }
          return [
            {
              name: "run",
              fqName: "example.run",
              kind: "functionDecl",
              filePath: "example.go",
              symbolId: 1,
              location: {
                filePath: "example.go",
                startLine: 1,
                startColumn: 1,
                endLine: 1,
                endColumn: 30,
              },
              isDefinition: true,
            },
            {
              name: "run",
              fqName: "example.run",
              kind: "functionDecl",
              filePath: "example.go",
              symbolId: 1,
              location: {
                filePath: "example.go",
                startLine: 2,
                startColumn: 1,
                endLine: 2,
                endColumn: 4,
              },
              isDefinition: false,
            },
          ];
        },
        callersOf() {
          return [];
        },
        calleesOf() {
          return [];
        },
        dispose() {},
      };
    },
  };
}
`;

describe("WasmCodeNavigation", () => {
  it.effect("loads the gzip-compressed bundled engine", () =>
    Effect.gen(function* () {
      const navigation = new WasmCodeNavigation();
      const wasmPath = NodeURL.fileURLToPath(
        new URL("../../assets/semasmith/semasmith.wasm", import.meta.url),
      );

      const summary = yield* Effect.promise(() =>
        navigation.build({
          wasmPath,
          projectKey: "bundled-engine",
          language: "go",
          files: [{ path: "example.go", source: "package example\nfunc run() {}\n" }],
        }),
      );

      assert.strictEqual(summary.language, "go");
      assert.strictEqual(summary.fileCount, 1);
      yield* Effect.promise(() => navigation.dispose());
    }),
  );

  it.effect("keeps a project in a worker and resolves uses and declarations", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-semasmith-wasm-" });
      const wasmPath = `${directory}/semasmith.wasm`;
      yield* fs.writeFile(
        wasmPath,
        NodeZlib.gzipSync(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])),
      );
      yield* fs.writeFileString(`${directory}/semasmith.mjs`, fakeModule);

      const navigation = new WasmCodeNavigation();
      const summary = yield* Effect.promise(() =>
        navigation.build({
          wasmPath,
          projectKey: "revision-1",
          language: "go",
          files: [{ path: "example.go", source: "package example\\nfunc run() {}\\n" }],
        }),
      );
      assert.strictEqual(summary.fileCount, 1);
      assert.isTrue(
        yield* Effect.promise(() => navigation.hasProject({ wasmPath, projectKey: "revision-1" })),
      );
      assert.isFalse(
        yield* Effect.promise(() =>
          navigation.hasProject({ wasmPath, projectKey: "missing-revision" }),
        ),
      );

      const use = yield* Effect.promise(() =>
        navigation.query({
          wasmPath,
          projectKey: "revision-1",
          path: "example.go",
          line: 2,
          column: 2,
          symbol: "run",
        }),
      );
      assert.strictEqual(use.symbol?.fqName, "example.run");

      const declaration = yield* Effect.promise(() =>
        navigation.query({
          wasmPath,
          projectKey: "revision-1",
          path: "example.go",
          line: 1,
          column: 10,
          symbol: "run",
        }),
      );
      assert.strictEqual(declaration.symbol?.kind, "functionDecl");
      assert.strictEqual(declaration.symbol?.location?.startLine, 1);
      assert.lengthOf(declaration.references, 2);

      const localVariable = yield* Effect.promise(() =>
        navigation.query({
          wasmPath,
          projectKey: "revision-1",
          path: "example.go",
          line: 4,
          column: 10,
          symbol: "budget",
        }),
      );
      assert.deepEqual(
        localVariable.references.map((reference) => [
          reference.filePath,
          reference.symbolId,
          reference.location?.startLine,
        ]),
        [
          ["example.go", 7, 3],
          ["example.go", 7, 4],
        ],
      );
      assert.lengthOf(localVariable.definitionCandidates, 1);

      const receiverType = yield* Effect.promise(() =>
        navigation.query({
          wasmPath,
          projectKey: "revision-1",
          path: "example.go",
          line: 5,
          column: 10,
          symbol: "Function",
        }),
      );
      assert.strictEqual(receiverType.symbol?.fqName, "example.Function");
      assert.strictEqual(receiverType.symbol?.kind, "typeDecl");
      assert.strictEqual(receiverType.symbol?.location?.startLine, 3);

      yield* Effect.promise(() => navigation.dispose());
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
