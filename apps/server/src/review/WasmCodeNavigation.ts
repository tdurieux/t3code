import * as NodeWorkerThreads from "node:worker_threads";

export interface WasmProjectFile {
  readonly path: string;
  readonly source: string;
}

export interface WasmNavigationLocation {
  readonly filePath: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface WasmNavigationSymbol {
  readonly name: string;
  readonly fqName: string;
  readonly kind: string;
  readonly filePath: string;
  readonly symbolId: number;
  readonly location: WasmNavigationLocation | null;
}

export interface WasmSymbolUsage extends WasmNavigationSymbol {
  readonly isDefinition: boolean;
}

export interface WasmProjectBuildSummary {
  readonly language: string;
  readonly fileCount: number;
  readonly hasCallGraph: boolean;
  readonly errors: ReadonlyArray<string>;
  readonly timings: Readonly<Record<string, number>>;
}

export interface WasmNavigationQueryResult {
  readonly symbol: WasmNavigationSymbol | null;
  readonly definitionCandidates: ReadonlyArray<WasmNavigationSymbol>;
  readonly references: ReadonlyArray<WasmSymbolUsage>;
  readonly callers: ReadonlyArray<WasmNavigationSymbol>;
  readonly callees: ReadonlyArray<WasmNavigationSymbol>;
}

interface WorkerRequest {
  readonly id: number;
  readonly operation: "has" | "build" | "query" | "dispose";
  readonly projectKey?: string;
  readonly files?: ReadonlyArray<WasmProjectFile>;
  readonly language?: string;
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;
  readonly symbol?: string;
  readonly force?: boolean;
}

interface WorkerResponse {
  readonly id: number;
  readonly result?: unknown;
  readonly error?: string;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
}

const WORKER_SOURCE = String.raw`
const { readFileSync } = require("node:fs");
const { parentPort, workerData } = require("node:worker_threads");
const { pathToFileURL } = require("node:url");
const { gunzipSync } = require("node:zlib");

const projects = new Map();
let projectSequence = 0;
let codeapiPromise;

function codeapi() {
  if (!codeapiPromise) {
    codeapiPromise = import(pathToFileURL(workerData.modulePath).href).then(async (loaded) => {
      const createCodeApi = loaded.default;
      if (typeof createCodeApi !== "function") {
        throw new Error("The Semasmith WASM module has no default factory export");
      }
      const storedBytes = readFileSync(workerData.wasmPath);
      const wasmBytes =
        storedBytes[0] === 0x1f && storedBytes[1] === 0x8b
          ? gunzipSync(storedBytes)
          : storedBytes;
      return createCodeApi({
        locateFile: (name) => name.endsWith(".wasm") ? workerData.wasmPath : name,
        instantiateWasm: (imports, receiveInstance) => {
          const module = new WebAssembly.Module(wasmBytes);
          const instance = new WebAssembly.Instance(module, imports);
          receiveInstance(instance);
          return instance.exports;
        },
      });
    });
  }
  return codeapiPromise;
}

function containsPosition(location, path, line, column) {
  if (!location || location.filePath !== path) return false;
  if (line < location.startLine || line > location.endLine) return false;
  if (line === location.startLine && column < location.startColumn) return false;
  if (line === location.endLine && column > location.endColumn) return false;
  return true;
}

function withoutUsageFlag(usage) {
  if (!usage) return null;
  const { isDefinition: _isDefinition, ...symbol } = usage;
  return symbol;
}

function selectDefinitionForCursor(references, request) {
  const definitions = references.filter((usage) => usage.isDefinition);
  return withoutUsageFlag(
    definitions.find((usage) =>
      containsPosition(usage.location, request.path, request.line, request.column),
    ) ??
      definitions.find((usage) => usage.location?.filePath === request.path) ??
      definitions[0],
  );
}

function isLocallyScopedSymbol(symbol) {
  if (!symbol || symbol.fqName !== symbol.name) return false;
  const kind = String(symbol.kind || "").toLowerCase();
  return kind.includes("variable") || kind.includes("parameter");
}

function isUsageOfLocalSymbol(usage, symbol) {
  return (
    usage?.symbolId === symbol.symbolId &&
    usage.filePath === symbol.filePath
  );
}

function goPackageNames(files) {
  const names = new Map();
  for (const file of files || []) {
    const match = file.source.match(/^\s*package\s+([A-Za-z_]\w*)/m);
    if (match) names.set(file.path, match[1]);
  }
  return names;
}

async function handle(request) {
  if (request.operation === "has") {
    return projects.has(request.projectKey);
  }

  if (request.operation === "build") {
    const existing = projects.get(request.projectKey);
    if (existing && request.force !== true) return existing.summary;
    const module = await codeapi();
    const project = module.createProject(request.files, request.language);
    try {
      const summary = project.build();
      if (existing) existing.project.dispose();
      projects.set(request.projectKey, {
        project,
        summary,
        lastUsed: ++projectSequence,
        goPackageNames: request.language === "go" ? goPackageNames(request.files) : new Map(),
        filePaths: new Set(request.files.map((file) => file.path)),
      });
      while (projects.size > 3) {
        let oldestKey;
        let oldestSequence = Number.POSITIVE_INFINITY;
        for (const [key, candidate] of projects) {
          if (key !== request.projectKey && candidate.lastUsed < oldestSequence) {
            oldestKey = key;
            oldestSequence = candidate.lastUsed;
          }
        }
        if (!oldestKey) break;
        projects.get(oldestKey).project.dispose();
        projects.delete(oldestKey);
      }
      return summary;
    } catch (error) {
      project.dispose();
      throw error;
    }
  }

  if (request.operation === "query") {
    const entry = projects.get(request.projectKey);
    if (!entry) throw new Error("Semasmith project has not been built");
    entry.lastUsed = ++projectSequence;
    let symbol = entry.project.definitionAt(request.path, request.line, request.column);
    let references;
    if (symbol) {
      references = entry.project.referencesOf(symbol);
      if (isLocallyScopedSymbol(symbol)) {
        references = references.filter((usage) => isUsageOfLocalSymbol(usage, symbol));
      }
    } else if (request.symbol) {
      const referenceQueries = [];
      if (!request.symbol.includes(".")) {
        const packageName = entry.goPackageNames.get(request.path);
        if (packageName) referenceQueries.push(packageName + "." + request.symbol);
      }
      referenceQueries.push(request.symbol);
      references = [];
      for (const query of referenceQueries) {
        const queryReferences = entry.project.referencesOf(query);
        if (references.length === 0 && queryReferences.length > 0) {
          references = queryReferences;
        }
        if (queryReferences.some((usage) => usage.isDefinition)) {
          references = queryReferences;
          break;
        }
      }
      symbol = selectDefinitionForCursor(references, request);
    } else {
      references = [];
    }
    const isKnownSymbol = (candidate) =>
      candidate?.location && entry.filePaths.has(candidate.location.filePath);
    if (!isKnownSymbol(symbol)) {
      return {
        symbol: null,
        definitionCandidates: [],
        references: [],
        callers: [],
        callees: [],
      };
    }
    references = references.filter(isKnownSymbol);
    const definitionCandidates = references
      .filter((usage) => usage.isDefinition)
      .map(withoutUsageFlag);
    if (
      !definitionCandidates.some(
        (candidate) =>
          candidate.fqName === symbol.fqName &&
          candidate.location?.filePath === symbol.location.filePath &&
          candidate.location?.startLine === symbol.location.startLine
      )
    ) {
      definitionCandidates.unshift(symbol);
    }
    return {
      symbol,
      definitionCandidates,
      references,
      callers: isLocallyScopedSymbol(symbol)
        ? []
        : entry.project.callersOf(symbol).filter(isKnownSymbol),
      callees: isLocallyScopedSymbol(symbol)
        ? []
        : entry.project.calleesOf(symbol).filter(isKnownSymbol),
    };
  }

  if (request.operation === "dispose") {
    for (const entry of projects.values()) entry.project.dispose();
    projects.clear();
    return null;
  }

  throw new Error("Unknown Semasmith worker operation");
}

parentPort.on("message", async (request) => {
  try {
    parentPort.postMessage({ id: request.id, result: await handle(request) });
  } catch (error) {
    parentPort.postMessage({
      id: request.id,
      error: error instanceof Error ? error.stack || error.message : String(error),
    });
  }
});
`;

class WasmWorkerClient {
  readonly #worker: NodeWorkerThreads.Worker;
  readonly #pending = new Map<number, PendingRequest>();
  #nextRequestId = 1;
  #closed = false;
  readonly #onFailure: () => void;

  constructor(wasmPath: string, modulePath: string, onFailure: () => void) {
    this.#onFailure = onFailure;
    this.#worker = new NodeWorkerThreads.Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { wasmPath, modulePath },
    });
    this.#worker.unref();
    this.#worker.on("message", (response: WorkerResponse) => {
      const pending = this.#pending.get(response.id);
      if (!pending) return;
      this.#pending.delete(response.id);
      if (response.error) {
        pending.reject(new Error(response.error));
      } else {
        pending.resolve(response.result);
      }
    });
    this.#worker.on("error", (error) => this.#fail(error));
    this.#worker.on("exit", (code) => {
      if (!this.#closed && code !== 0) {
        this.#fail(new Error(`Semasmith WASM worker exited with status ${code}`));
      }
    });
  }

  #fail(error: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    this.#onFailure();
  }

  request<A>(request: Omit<WorkerRequest, "id">): Promise<A> {
    if (this.#closed) return Promise.reject(new Error("Semasmith WASM worker is closed"));
    const id = this.#nextRequestId++;
    return new Promise<A>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: (value) => resolve(value as A),
        reject,
      });
      this.#worker.postMessage({ ...request, id }, []);
    });
  }

  async dispose(): Promise<void> {
    if (this.#closed) return;
    await this.request({ operation: "dispose" }).catch(() => undefined);
    this.#closed = true;
    await this.#worker.terminate();
  }
}

export class WasmCodeNavigation {
  readonly #clients = new Map<string, WasmWorkerClient>();

  static isWasmPath(configuredPath: string): boolean {
    return configuredPath.toLowerCase().endsWith(".wasm");
  }

  #client(wasmPath: string): WasmWorkerClient {
    const existing = this.#clients.get(wasmPath);
    if (existing) return existing;
    const modulePath = wasmPath.replace(/\.wasm$/i, ".mjs");
    const client = new WasmWorkerClient(wasmPath, modulePath, () => {
      if (this.#clients.get(wasmPath) === client) this.#clients.delete(wasmPath);
    });
    this.#clients.set(wasmPath, client);
    return client;
  }

  hasProject(input: { readonly wasmPath: string; readonly projectKey: string }): Promise<boolean> {
    return this.#client(input.wasmPath).request({
      operation: "has",
      projectKey: input.projectKey,
    });
  }

  build(input: {
    readonly wasmPath: string;
    readonly projectKey: string;
    readonly files: ReadonlyArray<WasmProjectFile>;
    readonly language: string;
    readonly force?: boolean;
  }): Promise<WasmProjectBuildSummary> {
    return this.#client(input.wasmPath).request({
      operation: "build",
      projectKey: input.projectKey,
      files: input.files,
      language: input.language,
      ...(input.force === undefined ? {} : { force: input.force }),
    });
  }

  query(input: {
    readonly wasmPath: string;
    readonly projectKey: string;
    readonly path: string;
    readonly line: number;
    readonly column: number;
    readonly symbol?: string;
  }): Promise<WasmNavigationQueryResult> {
    return this.#client(input.wasmPath).request({
      operation: "query",
      projectKey: input.projectKey,
      path: input.path,
      line: input.line,
      column: input.column,
      ...(input.symbol === undefined ? {} : { symbol: input.symbol }),
    });
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.#clients.values()].map((client) => client.dispose()));
    this.#clients.clear();
  }
}
