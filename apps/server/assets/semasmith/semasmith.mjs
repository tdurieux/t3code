async function createSemasmith(moduleArg = {}) {
  var Module = moduleArg;
  var ENVIRONMENT_IS_WEB = !!globalThis.window;
  var ENVIRONMENT_IS_WORKER = !!globalThis.WorkerGlobalScope;
  var ENVIRONMENT_IS_NODE =
    globalThis.process?.versions?.node && globalThis.process?.type != "renderer";
  if (ENVIRONMENT_IS_NODE) {
    const { createRequire } = await import("node:module");
    var require = createRequire(import.meta.url);
  }
  var programArgs = [];
  var thisProgram = "./this.program";
  var quit_ = (status, toThrow) => {
    throw toThrow;
  };
  var _scriptName = import.meta.url;
  var scriptDirectory = "";
  function locateFile(path) {
    if (Module["locateFile"]) {
      return Module["locateFile"](path, scriptDirectory);
    }
    return scriptDirectory + path;
  }
  var readAsync, readBinary;
  if (ENVIRONMENT_IS_NODE) {
    var fs = require("node:fs");
    if (_scriptName.startsWith("file:")) {
      scriptDirectory =
        require("node:path").dirname(require("node:url").fileURLToPath(_scriptName)) + "/";
    }
    readBinary = (filename) => {
      filename = isFileURI(filename) ? new URL(filename) : filename;
      var ret = fs.readFileSync(filename);
      return ret;
    };
    readAsync = async (filename, binary = true) => {
      filename = isFileURI(filename) ? new URL(filename) : filename;
      var ret = fs.readFileSync(filename, binary ? undefined : "utf8");
      return ret;
    };
    if (process.argv.length > 1) {
      thisProgram = process.argv[1].replace(/\\/g, "/");
    }
    programArgs = process.argv.slice(2);
    quit_ = (status, toThrow) => {
      process.exitCode = status;
      throw toThrow;
    };
  } else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
    try {
      scriptDirectory = new URL(".", _scriptName).href;
    } catch {}
    {
      if (ENVIRONMENT_IS_WORKER) {
        readBinary = (url) => {
          var xhr = new XMLHttpRequest();
          xhr.open("GET", url, false);
          xhr.responseType = "arraybuffer";
          xhr.send(null);
          return new Uint8Array(xhr.response);
        };
      }
      readAsync = async (url) => {
        var response = await fetch(url, { credentials: "same-origin" });
        if (response.ok) {
          return response.arrayBuffer();
        }
        throw new Error(response.status + " : " + response.url);
      };
    }
  } else {
  }
  var out = console.log.bind(console);
  var err = console.error.bind(console);
  var wasmBinary;
  var ABORT = false;
  var isFileURI = (filename) => filename.startsWith("file://");
  var runtimeInitialized = false;
  function getMemoryBuffer() {
    return wasmMemory.buffer;
  }
  function updateMemoryViews() {
    if (HEAP8?.buffer?.resizable) return;
    var b = getMemoryBuffer();
    HEAP8 = new Int8Array(b);
    HEAPU8 = new Uint8Array(b);
    HEAPU32 = new Uint32Array(b);
    HEAP64 = new BigInt64Array(b);
  }
  function preRun() {
    var preRun = Module["preRun"];
    if (preRun) {
      if (typeof preRun == "function") preRun = [preRun];
      onPreRuns.push(...preRun);
    }
    callRuntimeCallbacks(onPreRuns);
  }
  function initRuntime() {
    runtimeInitialized = true;
    wasmExports["v"]();
  }
  function postRun() {
    var postRun = Module["postRun"];
    if (postRun) {
      if (typeof postRun == "function") postRun = [postRun];
      onPostRuns.push(...postRun);
    }
    callRuntimeCallbacks(onPostRuns);
  }
  function abort(what) {
    Module["onAbort"]?.(what);
    what = `Aborted(${what})`;
    err(what);
    ABORT = true;
    what += ". Build with -sASSERTIONS for more info.";
    if (runtimeInitialized) {
      ___trap();
    }
    var e = new WebAssembly.RuntimeError(what);
    throw e;
  }
  var wasmBinaryFile;
  function findWasmBinary() {
    if (Module["locateFile"]) {
      return locateFile("semasmith.wasm");
    }
    return new URL("semasmith.wasm", import.meta.url).href;
  }
  function getBinarySync(file) {
    if (readBinary) {
      return readBinary(file);
    }
    throw "both async and sync fetching of the wasm failed";
  }
  async function getWasmBinary(binaryFile) {
    if (!wasmBinary) {
      try {
        var response = await readAsync(binaryFile);
        return new Uint8Array(response);
      } catch {}
    }
    return getBinarySync(binaryFile);
  }
  async function instantiateArrayBuffer(binaryFile, imports) {
    try {
      var binary = await getWasmBinary(binaryFile);
      var instance = await WebAssembly.instantiate(binary, imports);
      return instance;
    } catch (reason) {
      err(`failed to asynchronously prepare wasm: ${reason}`);
      abort(reason);
    }
  }
  async function instantiateAsync(binary, binaryFile, imports) {
    if (!binary && !ENVIRONMENT_IS_NODE) {
      try {
        var response = fetch(binaryFile, { credentials: "same-origin" });
        var instantiationResult = await WebAssembly.instantiateStreaming(response, imports);
        return instantiationResult;
      } catch (reason) {
        err(`wasm streaming compile failed: ${reason}`);
        err("falling back to ArrayBuffer instantiation");
      }
    }
    return instantiateArrayBuffer(binaryFile, imports);
  }
  function getWasmImports() {
    var imports = { a: wasmImports };
    return imports;
  }
  async function createWasm() {
    function receiveInstance(instance) {
      wasmExports = instance.exports;
      assignWasmExports(wasmExports);
      updateMemoryViews();
      return wasmExports;
    }
    function receiveInstantiationResult(result) {
      return receiveInstance(result["instance"]);
    }
    var info = getWasmImports();
    var instantiateWasm = Module["instantiateWasm"];
    if (instantiateWasm) {
      return new Promise((resolve) => {
        instantiateWasm(info, (inst) => resolve(receiveInstance(inst)));
      });
    }
    wasmBinaryFile ??= findWasmBinary();
    var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info);
    var exports = receiveInstantiationResult(result);
    return exports;
  }
  class ExitStatus {
    name = "ExitStatus";
    constructor(status) {
      this.message = `Program terminated with exit(${status})`;
      this.status = status;
    }
  }
  var HEAP8;
  var callRuntimeCallbacks = (callbacks) => {
    while (callbacks.length > 0) {
      callbacks.shift()(Module);
    }
  };
  var onPostRuns = [];
  var onPreRuns = [];
  var noExitRuntime = true;
  var UTF8Decoder = globalThis.TextDecoder && new TextDecoder();
  var findStringEnd = (heapOrArray, idx, maxBytesToRead, ignoreNul) => {
    var maxIdx = idx + maxBytesToRead;
    if (ignoreNul) return maxIdx;
    while (heapOrArray[idx] && !(idx >= maxIdx)) ++idx;
    return idx;
  };
  var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead, ignoreNul) => {
    var endPtr = findStringEnd(heapOrArray, idx, maxBytesToRead, ignoreNul);
    if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
      return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
    }
    var str = "";
    while (idx < endPtr) {
      var u0 = heapOrArray[idx++];
      if (!(u0 & 128)) {
        str += String.fromCharCode(u0);
        continue;
      }
      var u1 = heapOrArray[idx++] & 63;
      if ((u0 & 224) == 192) {
        str += String.fromCharCode(((u0 & 31) << 6) | u1);
        continue;
      }
      var u2 = heapOrArray[idx++] & 63;
      if ((u0 & 240) == 224) {
        u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
      } else {
        u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (heapOrArray[idx++] & 63);
      }
      if (u0 < 65536) {
        str += String.fromCharCode(u0);
      } else {
        var ch = u0 - 65536;
        str += String.fromCharCode(55296 | (ch >> 10), 56320 | (ch & 1023));
      }
    }
    return str;
  };
  var HEAPU8;
  var UTF8ToString = (ptr, maxBytesToRead, ignoreNul) =>
    ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead, ignoreNul) : "";
  var ___assert_fail = (condition, filename, line, func) =>
    abort(
      `Assertion failed: ${UTF8ToString(condition)}, at: ` +
        [
          filename ? UTF8ToString(filename) : "unknown filename",
          line,
          func ? UTF8ToString(func) : "unknown function",
        ],
    );
  var SYSCALLS = {
    varargs: undefined,
    getStr(ptr) {
      var ret = UTF8ToString(ptr);
      return ret;
    },
  };
  var ___syscall_fstat64 = (fd, buf) => {};
  var ___syscall_getcwd = (buf, size) => {};
  var ___syscall_getdents64 = (fd, dirp, count) => {};
  var ___syscall_lstat64 = (path, buf) => {};
  var ___syscall_newfstatat = (dirfd, path, buf, flags) => {};
  function ___syscall_openat(dirfd, path, flags, varargs) {
    SYSCALLS.varargs = varargs;
  }
  var ___syscall_readlinkat = (dirfd, path, buf, bufsize) => {};
  var ___syscall_stat64 = (path, buf) => {};
  var __abort_js = () => abort("");
  var _emscripten_get_now = () => performance.now();
  var _emscripten_date_now = () => Date.now();
  var nowIsMonotonic = 1;
  var checkWasiClock = (clock_id) => clock_id >= 0 && clock_id <= 3;
  var INT53_MAX = 9007199254740992;
  var INT53_MIN = -9007199254740992;
  var bigintToI53Checked = (num) => (num < INT53_MIN || num > INT53_MAX ? NaN : Number(num));
  var HEAP64;
  function _clock_time_get(clk_id, ignored_precision, ptime) {
    ignored_precision = bigintToI53Checked(ignored_precision);
    if (!checkWasiClock(clk_id)) {
      return 28;
    }
    var now;
    if (clk_id === 0) {
      now = _emscripten_date_now();
    } else if (nowIsMonotonic) {
      now = _emscripten_get_now();
    } else {
      return 52;
    }
    var nsec = Math.round(now * 1e3 * 1e3);
    HEAP64[ptime >> 3] = BigInt(nsec);
    return 0;
  }
  var getHeapMax = () => 2147483648;
  var _emscripten_get_heap_max = () => getHeapMax();
  var alignMemory = (size, alignment) => Math.ceil(size / alignment) * alignment;
  var growMemory = (size) => {
    var oldHeapSize = wasmMemory.buffer.byteLength;
    var pages = ((size - oldHeapSize + 65535) / 65536) | 0;
    try {
      wasmMemory.grow(pages);
      updateMemoryViews();
      return 1;
    } catch (e) {}
  };
  var _emscripten_resize_heap = (requestedSize) => {
    var oldSize = HEAPU8.length;
    requestedSize >>>= 0;
    var maxHeapSize = getHeapMax();
    if (requestedSize > maxHeapSize) {
      return false;
    }
    for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
      var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
      overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
      var newSize = Math.min(
        maxHeapSize,
        alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536),
      );
      var replacement = growMemory(newSize);
      if (replacement) {
        return true;
      }
    }
    return false;
  };
  var ENV = {};
  var getExecutableName = () => thisProgram;
  var getEnvStrings = () => {
    if (!getEnvStrings.strings) {
      var lang = (globalThis.navigator?.language ?? "C").replace("-", "_") + ".UTF-8";
      var env = {
        USER: "web_user",
        LOGNAME: "web_user",
        PATH: "/",
        PWD: "/",
        HOME: "/home/web_user",
        LANG: lang,
        _: getExecutableName(),
      };
      for (var x in ENV) {
        if (ENV[x] === undefined) delete env[x];
        else env[x] = ENV[x];
      }
      var strings = [];
      for (var x in env) {
        strings.push(`${x}=${env[x]}`);
      }
      getEnvStrings.strings = strings;
    }
    return getEnvStrings.strings;
  };
  var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {
    if (!(maxBytesToWrite > 0)) return 0;
    var startIdx = outIdx;
    var endIdx = outIdx + maxBytesToWrite - 1;
    for (var i = 0; i < str.length; ++i) {
      var u = str.codePointAt(i);
      if (u <= 127) {
        if (outIdx >= endIdx) break;
        heap[outIdx++] = u;
      } else if (u <= 2047) {
        if (outIdx + 1 >= endIdx) break;
        heap[outIdx++] = 192 | (u >> 6);
        heap[outIdx++] = 128 | (u & 63);
      } else if (u <= 65535) {
        if (outIdx + 2 >= endIdx) break;
        heap[outIdx++] = 224 | (u >> 12);
        heap[outIdx++] = 128 | ((u >> 6) & 63);
        heap[outIdx++] = 128 | (u & 63);
      } else {
        if (outIdx + 3 >= endIdx) break;
        heap[outIdx++] = 240 | (u >> 18);
        heap[outIdx++] = 128 | ((u >> 12) & 63);
        heap[outIdx++] = 128 | ((u >> 6) & 63);
        heap[outIdx++] = 128 | (u & 63);
        i++;
      }
    }
    heap[outIdx] = 0;
    return outIdx - startIdx;
  };
  var stringToUTF8 = (str, outPtr, maxBytesToWrite) =>
    stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
  var HEAPU32;
  var _environ_get = (__environ, environ_buf) => {
    var bufSize = 0;
    var envp = 0;
    for (var string of getEnvStrings()) {
      var ptr = environ_buf + bufSize;
      HEAPU32[(__environ + envp) >> 2] = ptr;
      bufSize += stringToUTF8(string, ptr, Infinity) + 1;
      envp += 4;
    }
    return 0;
  };
  var lengthBytesUTF8 = (str) => {
    var len = 0;
    for (var i = 0; i < str.length; ++i) {
      var c = str.charCodeAt(i);
      if (c <= 127) {
        len++;
      } else if (c <= 2047) {
        len += 2;
      } else if (c >= 55296 && c <= 57343) {
        len += 4;
        ++i;
      } else {
        len += 3;
      }
    }
    return len;
  };
  var _environ_sizes_get = (penviron_count, penviron_buf_size) => {
    var strings = getEnvStrings();
    HEAPU32[penviron_count >> 2] = strings.length;
    var bufSize = 0;
    for (var string of strings) {
      bufSize += lengthBytesUTF8(string) + 1;
    }
    HEAPU32[penviron_buf_size >> 2] = bufSize;
    return 0;
  };
  var _fd_close = (fd) => 52;
  var _fd_read = (fd, iov, iovcnt, pnum) => 52;
  function _fd_seek(fd, offset, whence, newOffset) {
    offset = bigintToI53Checked(offset);
    return 70;
  }
  var printCharBuffers = [null, [], []];
  var printChar = (stream, curr) => {
    var buffer = printCharBuffers[stream];
    if (curr === 0 || curr === 10) {
      (stream === 1 ? out : err)(UTF8ArrayToString(buffer));
      buffer.length = 0;
    } else {
      buffer.push(curr);
    }
  };
  var _fd_write = (fd, iov, iovcnt, pnum) => {
    var num = 0;
    for (var i = 0; i < iovcnt; i++) {
      var ptr = HEAPU32[iov >> 2];
      var len = HEAPU32[(iov + 4) >> 2];
      iov += 8;
      for (var j = 0; j < len; j++) {
        printChar(fd, HEAPU8[ptr + j]);
      }
      num += len;
    }
    HEAPU32[pnum >> 2] = num;
    return 0;
  };
  var initRandomFill = () => {
    if (ENVIRONMENT_IS_NODE) {
      var nodeCrypto = require("node:crypto");
      return (view) => (nodeCrypto.randomFillSync(view), 0);
    }
    return (view) => (crypto.getRandomValues(view), 0);
  };
  var randomFill = (view) => (randomFill = initRandomFill())(view);
  var _random_get = (buffer, size) => randomFill(HEAPU8.subarray(buffer, buffer + size));
  {
    if (Module["noExitRuntime"]) noExitRuntime = Module["noExitRuntime"];
    if (Module["print"]) out = Module["print"];
    if (Module["printErr"]) err = Module["printErr"];
    if (Module["arguments"]) programArgs = Module["arguments"];
    if (Module["thisProgram"]) thisProgram = Module["thisProgram"];
    var preInit = Module["preInit"];
    if (preInit) {
      if (typeof preInit == "function") Module["preInit"] = preInit = [preInit];
      while (preInit.length > 0) {
        preInit.shift()();
      }
    }
  }
  var _semasmith_build_ir,
    _semasmith_build_model,
    _semasmith_project_build,
    _semasmith_project_callees_of,
    _semasmith_project_callers_of,
    _semasmith_project_definition_at,
    _semasmith_project_error_len,
    _semasmith_project_error_ptr,
    _semasmith_project_free,
    _semasmith_project_references_of,
    _semasmith_project_summary_len,
    _semasmith_project_summary_ptr,
    _semasmith_result_data_ptr,
    _semasmith_result_error_ptr,
    _semasmith_result_free,
    _semasmith_result_data_len,
    _semasmith_result_error_len,
    _malloc,
    _free,
    ___trap,
    memory,
    __indirect_function_table,
    wasmMemory;
  function assignWasmExports(wasmExports) {
    _semasmith_build_ir = Module["_semasmith_build_ir"] = wasmExports["w"];
    _semasmith_build_model = Module["_semasmith_build_model"] = wasmExports["x"];
    _semasmith_project_build = Module["_semasmith_project_build"] = wasmExports["y"];
    _semasmith_project_callees_of = Module["_semasmith_project_callees_of"] = wasmExports["z"];
    _semasmith_project_callers_of = Module["_semasmith_project_callers_of"] = wasmExports["A"];
    _semasmith_project_definition_at = Module["_semasmith_project_definition_at"] =
      wasmExports["B"];
    _semasmith_project_error_len = Module["_semasmith_project_error_len"] = wasmExports["C"];
    _semasmith_project_error_ptr = Module["_semasmith_project_error_ptr"] = wasmExports["D"];
    _semasmith_project_free = Module["_semasmith_project_free"] = wasmExports["E"];
    _semasmith_project_references_of = Module["_semasmith_project_references_of"] =
      wasmExports["F"];
    _semasmith_project_summary_len = Module["_semasmith_project_summary_len"] = wasmExports["G"];
    _semasmith_project_summary_ptr = Module["_semasmith_project_summary_ptr"] = wasmExports["H"];
    _semasmith_result_data_ptr = Module["_semasmith_result_data_ptr"] = wasmExports["I"];
    _semasmith_result_error_ptr = Module["_semasmith_result_error_ptr"] = wasmExports["J"];
    _semasmith_result_free = Module["_semasmith_result_free"] = wasmExports["K"];
    _semasmith_result_data_len = Module["_semasmith_result_data_len"] = wasmExports["L"];
    _semasmith_result_error_len = Module["_semasmith_result_error_len"] = wasmExports["M"];
    _malloc = Module["_malloc"] = wasmExports["N"];
    _free = Module["_free"] = wasmExports["O"];
    ___trap = wasmExports["P"];
    memory = wasmMemory = wasmExports["u"];
    __indirect_function_table = wasmExports["__indirect_function_table"];
  }
  var wasmImports = {
    a: ___assert_fail,
    k: ___syscall_fstat64,
    p: ___syscall_getcwd,
    l: ___syscall_getdents64,
    h: ___syscall_lstat64,
    i: ___syscall_newfstatat,
    g: ___syscall_openat,
    n: ___syscall_readlinkat,
    j: ___syscall_stat64,
    t: __abort_js,
    q: _clock_time_get,
    r: _emscripten_get_heap_max,
    f: _emscripten_resize_heap,
    s: _environ_get,
    e: _environ_sizes_get,
    c: _fd_close,
    d: _fd_read,
    m: _fd_seek,
    b: _fd_write,
    o: _random_get,
  };
  async function run() {
    preRun();
    var setStatus = Module["setStatus"];
    if (setStatus) {
      setStatus("Running...");
      await new Promise((resolve) => setTimeout(resolve, 1));
      setTimeout(setStatus, 1, "");
    }
    if (ABORT) return;
    initRuntime();
    Module["onRuntimeInitialized"]?.();
    postRun();
  }
  var wasmExports;
  wasmExports = await createWasm();
  await run();
  const semasmithEncoder = new TextEncoder();
  const semasmithDecoder = new TextDecoder();
  function semasmithAllocString(value) {
    const bytes = semasmithEncoder.encode(value);
    const pointer = Module._malloc(Math.max(bytes.length, 1));
    HEAPU8.set(bytes, pointer);
    return { pointer, length: bytes.length };
  }
  function semasmithBuild(buildFunction, filePath, source, language) {
    const filePathInput = semasmithAllocString(filePath);
    const sourceInput = semasmithAllocString(source);
    const languageInput = semasmithAllocString(language);
    let result = 0;
    try {
      result = buildFunction(
        filePathInput.pointer,
        filePathInput.length,
        sourceInput.pointer,
        sourceInput.length,
        languageInput.pointer,
        languageInput.length,
      );
      const errorLength = Module._semasmith_result_error_len(result);
      if (errorLength !== 0) {
        const errorPointer = Module._semasmith_result_error_ptr(result);
        const message = semasmithDecoder.decode(
          HEAPU8.subarray(errorPointer, errorPointer + errorLength),
        );
        throw new Error(message);
      }
      const dataPointer = Module._semasmith_result_data_ptr(result);
      const dataLength = Module._semasmith_result_data_len(result);
      return HEAPU8.slice(dataPointer, dataPointer + dataLength);
    } finally {
      if (result !== 0) {
        Module._semasmith_result_free(result);
      }
      Module._free(filePathInput.pointer);
      Module._free(sourceInput.pointer);
      Module._free(languageInput.pointer);
    }
  }
  Module.buildIR = function buildIR(filePath, source, language) {
    return semasmithBuild(Module._semasmith_build_ir, filePath, source, language);
  };
  Module.buildModel = function buildModel(filePath, source, language) {
    const json = semasmithBuild(Module._semasmith_build_model, filePath, source, language);
    return JSON.parse(semasmithDecoder.decode(json));
  };
  function semasmithReadProjectResult(result) {
    if (result === 0) {
      throw new Error("Semasmith project query returned a null result");
    }
    try {
      const errorLength = Module._semasmith_result_error_len(result);
      if (errorLength !== 0) {
        const errorPointer = Module._semasmith_result_error_ptr(result);
        throw new Error(
          semasmithDecoder.decode(HEAPU8.subarray(errorPointer, errorPointer + errorLength)),
        );
      }
      const dataPointer = Module._semasmith_result_data_ptr(result);
      const dataLength = Module._semasmith_result_data_len(result);
      return JSON.parse(
        semasmithDecoder.decode(HEAPU8.subarray(dataPointer, dataPointer + dataLength)),
      );
    } finally {
      Module._semasmith_result_free(result);
    }
  }
  function semasmithNormalizeProjectFiles(files) {
    if (Array.isArray(files)) {
      return files.map((file) => {
        if (
          file === null ||
          typeof file !== "object" ||
          typeof file.path !== "string" ||
          typeof file.source !== "string"
        ) {
          throw new TypeError("Project files must contain string path and source properties");
        }
        return { path: file.path, source: file.source };
      });
    }
    if (files !== null && typeof files === "object") {
      return Object.entries(files).map(([path, source]) => {
        if (typeof source !== "string") {
          throw new TypeError(`Project source for ${path} must be a string`);
        }
        return { path, source };
      });
    }
    throw new TypeError("Project files must be an array or a path-to-source object");
  }
  function semasmithSymbolFqn(symbol) {
    if (typeof symbol === "string") {
      return symbol;
    }
    if (symbol !== null && typeof symbol === "object" && typeof symbol.fqName === "string") {
      return symbol.fqName;
    }
    throw new TypeError("Expected a symbol FQN or navigation symbol");
  }
  function SemasmithProject(files, language, options) {
    if (typeof language !== "string" || language.length === 0) {
      throw new TypeError("Project language must be a non-empty string");
    }
    this._files = new Map(
      semasmithNormalizeProjectFiles(files).map((file) => [file.path, file.source]),
    );
    this._language = language;
    this._options = options || {};
    this._handle = 0;
    this._dirty = true;
    this._disposed = false;
  }
  SemasmithProject.prototype._assertUsable = function _assertUsable() {
    if (this._disposed) {
      throw new Error("Semasmith project has been disposed");
    }
  };
  SemasmithProject.prototype._assertBuilt = function _assertBuilt() {
    this._assertUsable();
    if (this._handle === 0 || this._dirty) {
      throw new Error("Semasmith project must be built after its latest file change");
    }
  };
  SemasmithProject.prototype.setFile = function setFile(path, source) {
    this._assertUsable();
    if (typeof path !== "string" || path.length === 0) {
      throw new TypeError("Project file path must be a non-empty string");
    }
    if (typeof source !== "string") {
      throw new TypeError("Project file source must be a string");
    }
    this._files.set(path, source);
    this._dirty = true;
  };
  SemasmithProject.prototype.removeFile = function removeFile(path) {
    this._assertUsable();
    if (this._files.delete(path)) {
      this._dirty = true;
    }
  };
  SemasmithProject.prototype.build = function build() {
    this._assertUsable();
    const filesInput = semasmithAllocString(
      JSON.stringify(Array.from(this._files, ([path, source]) => ({ path, source }))),
    );
    const languageInput = semasmithAllocString(this._language);
    let nextHandle = 0;
    try {
      nextHandle = Module._semasmith_project_build(
        filesInput.pointer,
        filesInput.length,
        languageInput.pointer,
        languageInput.length,
        this._options.buildCallGraph === false ? 0 : 1,
        this._options.runSolver === false ? 0 : 1,
      );
      if (nextHandle === 0) {
        throw new Error("Semasmith project build returned a null handle");
      }
      const errorLength = Module._semasmith_project_error_len(nextHandle);
      if (errorLength !== 0) {
        const errorPointer = Module._semasmith_project_error_ptr(nextHandle);
        throw new Error(
          semasmithDecoder.decode(HEAPU8.subarray(errorPointer, errorPointer + errorLength)),
        );
      }
      const summaryPointer = Module._semasmith_project_summary_ptr(nextHandle);
      const summaryLength = Module._semasmith_project_summary_len(nextHandle);
      const summary = JSON.parse(
        semasmithDecoder.decode(HEAPU8.subarray(summaryPointer, summaryPointer + summaryLength)),
      );
      if (this._handle !== 0) {
        Module._semasmith_project_free(this._handle);
      }
      this._handle = nextHandle;
      nextHandle = 0;
      this._dirty = false;
      return summary;
    } finally {
      if (nextHandle !== 0) {
        Module._semasmith_project_free(nextHandle);
      }
      Module._free(filesInput.pointer);
      Module._free(languageInput.pointer);
    }
  };
  SemasmithProject.prototype.definitionAt = function definitionAt(path, line, column) {
    this._assertBuilt();
    const pathInput = semasmithAllocString(path);
    try {
      return semasmithReadProjectResult(
        Module._semasmith_project_definition_at(
          this._handle,
          pathInput.pointer,
          pathInput.length,
          line,
          column,
        ),
      );
    } finally {
      Module._free(pathInput.pointer);
    }
  };
  SemasmithProject.prototype._symbolQuery = function _symbolQuery(queryFunction, symbol) {
    this._assertBuilt();
    const fqnInput = semasmithAllocString(semasmithSymbolFqn(symbol));
    try {
      return semasmithReadProjectResult(
        queryFunction(this._handle, fqnInput.pointer, fqnInput.length),
      );
    } finally {
      Module._free(fqnInput.pointer);
    }
  };
  SemasmithProject.prototype.referencesOf = function referencesOf(symbol) {
    return this._symbolQuery(Module._semasmith_project_references_of, symbol);
  };
  SemasmithProject.prototype.callersOf = function callersOf(symbol) {
    return this._symbolQuery(Module._semasmith_project_callers_of, symbol);
  };
  SemasmithProject.prototype.calleesOf = function calleesOf(symbol) {
    return this._symbolQuery(Module._semasmith_project_callees_of, symbol);
  };
  SemasmithProject.prototype.dispose = function dispose() {
    if (this._handle !== 0) {
      Module._semasmith_project_free(this._handle);
      this._handle = 0;
    }
    this._disposed = true;
    this._dirty = true;
    this._files.clear();
  };
  Module.createProject = function createProject(files, language, options) {
    return new SemasmithProject(files, language, options);
  };
  return Module;
}
export default createSemasmith;
