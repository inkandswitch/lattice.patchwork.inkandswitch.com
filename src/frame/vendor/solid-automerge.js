// solid-automerge 2.0.2 (chee's, ~/soft/chee/solid-automerge at v2.0.2), with
// cabbages and @solid-primitives/utils bundled in: neither's in patchwork's
// import map. solid-js stays a bare import, so it's patchwork's one solid.
//   esbuild src/index.ts --bundle --format=esm --external:solid-js
//     --external:solid-js/store --external:solid-js/web --external:@automerge/*

var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/.pnpm/ms@2.1.3/node_modules/ms/index.js
var require_ms = __commonJS({
  "node_modules/.pnpm/ms@2.1.3/node_modules/ms/index.js"(exports, module) {
    var s = 1e3;
    var m = s * 60;
    var h = m * 60;
    var d = h * 24;
    var w = d * 7;
    var y = d * 365.25;
    module.exports = function(val, options) {
      options = options || {};
      var type = typeof val;
      if (type === "string" && val.length > 0) {
        return parse(val);
      } else if (type === "number" && isFinite(val)) {
        return options.long ? fmtLong(val) : fmtShort(val);
      }
      throw new Error(
        "val is not a non-empty string or a valid number. val=" + JSON.stringify(val)
      );
    };
    function parse(str) {
      str = String(str);
      if (str.length > 100) {
        return;
      }
      var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
        str
      );
      if (!match) {
        return;
      }
      var n = parseFloat(match[1]);
      var type = (match[2] || "ms").toLowerCase();
      switch (type) {
        case "years":
        case "year":
        case "yrs":
        case "yr":
        case "y":
          return n * y;
        case "weeks":
        case "week":
        case "w":
          return n * w;
        case "days":
        case "day":
        case "d":
          return n * d;
        case "hours":
        case "hour":
        case "hrs":
        case "hr":
        case "h":
          return n * h;
        case "minutes":
        case "minute":
        case "mins":
        case "min":
        case "m":
          return n * m;
        case "seconds":
        case "second":
        case "secs":
        case "sec":
        case "s":
          return n * s;
        case "milliseconds":
        case "millisecond":
        case "msecs":
        case "msec":
        case "ms":
          return n;
        default:
          return void 0;
      }
    }
    function fmtShort(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) {
        return Math.round(ms / d) + "d";
      }
      if (msAbs >= h) {
        return Math.round(ms / h) + "h";
      }
      if (msAbs >= m) {
        return Math.round(ms / m) + "m";
      }
      if (msAbs >= s) {
        return Math.round(ms / s) + "s";
      }
      return ms + "ms";
    }
    function fmtLong(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) {
        return plural(ms, msAbs, d, "day");
      }
      if (msAbs >= h) {
        return plural(ms, msAbs, h, "hour");
      }
      if (msAbs >= m) {
        return plural(ms, msAbs, m, "minute");
      }
      if (msAbs >= s) {
        return plural(ms, msAbs, s, "second");
      }
      return ms + " ms";
    }
    function plural(ms, msAbs, n, name) {
      var isPlural = msAbs >= n * 1.5;
      return Math.round(ms / n) + " " + name + (isPlural ? "s" : "");
    }
  }
});

// node_modules/.pnpm/debug@4.4.3/node_modules/debug/src/common.js
var require_common = __commonJS({
  "node_modules/.pnpm/debug@4.4.3/node_modules/debug/src/common.js"(exports, module) {
    function setup(env) {
      createDebug.debug = createDebug;
      createDebug.default = createDebug;
      createDebug.coerce = coerce;
      createDebug.disable = disable;
      createDebug.enable = enable;
      createDebug.enabled = enabled;
      createDebug.humanize = require_ms();
      createDebug.destroy = destroy;
      Object.keys(env).forEach((key) => {
        createDebug[key] = env[key];
      });
      createDebug.names = [];
      createDebug.skips = [];
      createDebug.formatters = {};
      function selectColor(namespace) {
        let hash = 0;
        for (let i = 0; i < namespace.length; i++) {
          hash = (hash << 5) - hash + namespace.charCodeAt(i);
          hash |= 0;
        }
        return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
      }
      createDebug.selectColor = selectColor;
      function createDebug(namespace) {
        let prevTime;
        let enableOverride = null;
        let namespacesCache;
        let enabledCache;
        function debug2(...args) {
          if (!debug2.enabled) {
            return;
          }
          const self = debug2;
          const curr = Number(/* @__PURE__ */ new Date());
          const ms = curr - (prevTime || curr);
          self.diff = ms;
          self.prev = prevTime;
          self.curr = curr;
          prevTime = curr;
          args[0] = createDebug.coerce(args[0]);
          if (typeof args[0] !== "string") {
            args.unshift("%O");
          }
          let index = 0;
          args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
            if (match === "%%") {
              return "%";
            }
            index++;
            const formatter = createDebug.formatters[format];
            if (typeof formatter === "function") {
              const val = args[index];
              match = formatter.call(self, val);
              args.splice(index, 1);
              index--;
            }
            return match;
          });
          createDebug.formatArgs.call(self, args);
          const logFn = self.log || createDebug.log;
          logFn.apply(self, args);
        }
        debug2.namespace = namespace;
        debug2.useColors = createDebug.useColors();
        debug2.color = createDebug.selectColor(namespace);
        debug2.extend = extend;
        debug2.destroy = createDebug.destroy;
        Object.defineProperty(debug2, "enabled", {
          enumerable: true,
          configurable: false,
          get: () => {
            if (enableOverride !== null) {
              return enableOverride;
            }
            if (namespacesCache !== createDebug.namespaces) {
              namespacesCache = createDebug.namespaces;
              enabledCache = createDebug.enabled(namespace);
            }
            return enabledCache;
          },
          set: (v) => {
            enableOverride = v;
          }
        });
        if (typeof createDebug.init === "function") {
          createDebug.init(debug2);
        }
        return debug2;
      }
      function extend(namespace, delimiter) {
        const newDebug = createDebug(this.namespace + (typeof delimiter === "undefined" ? ":" : delimiter) + namespace);
        newDebug.log = this.log;
        return newDebug;
      }
      function enable(namespaces) {
        createDebug.save(namespaces);
        createDebug.namespaces = namespaces;
        createDebug.names = [];
        createDebug.skips = [];
        const split = (typeof namespaces === "string" ? namespaces : "").trim().replace(/\s+/g, ",").split(",").filter(Boolean);
        for (const ns of split) {
          if (ns[0] === "-") {
            createDebug.skips.push(ns.slice(1));
          } else {
            createDebug.names.push(ns);
          }
        }
      }
      function matchesTemplate(search, template) {
        let searchIndex = 0;
        let templateIndex = 0;
        let starIndex = -1;
        let matchIndex = 0;
        while (searchIndex < search.length) {
          if (templateIndex < template.length && (template[templateIndex] === search[searchIndex] || template[templateIndex] === "*")) {
            if (template[templateIndex] === "*") {
              starIndex = templateIndex;
              matchIndex = searchIndex;
              templateIndex++;
            } else {
              searchIndex++;
              templateIndex++;
            }
          } else if (starIndex !== -1) {
            templateIndex = starIndex + 1;
            matchIndex++;
            searchIndex = matchIndex;
          } else {
            return false;
          }
        }
        while (templateIndex < template.length && template[templateIndex] === "*") {
          templateIndex++;
        }
        return templateIndex === template.length;
      }
      function disable() {
        const namespaces = [
          ...createDebug.names,
          ...createDebug.skips.map((namespace) => "-" + namespace)
        ].join(",");
        createDebug.enable("");
        return namespaces;
      }
      function enabled(name) {
        for (const skip of createDebug.skips) {
          if (matchesTemplate(name, skip)) {
            return false;
          }
        }
        for (const ns of createDebug.names) {
          if (matchesTemplate(name, ns)) {
            return true;
          }
        }
        return false;
      }
      function coerce(val) {
        if (val instanceof Error) {
          return val.stack || val.message;
        }
        return val;
      }
      function destroy() {
        console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
      }
      createDebug.enable(createDebug.load());
      return createDebug;
    }
    module.exports = setup;
  }
});

// node_modules/.pnpm/debug@4.4.3/node_modules/debug/src/browser.js
var require_browser = __commonJS({
  "node_modules/.pnpm/debug@4.4.3/node_modules/debug/src/browser.js"(exports, module) {
    exports.formatArgs = formatArgs;
    exports.save = save;
    exports.load = load;
    exports.useColors = useColors;
    exports.storage = localstorage();
    exports.destroy = /* @__PURE__ */ (() => {
      let warned = false;
      return () => {
        if (!warned) {
          warned = true;
          console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
        }
      };
    })();
    exports.colors = [
      "#0000CC",
      "#0000FF",
      "#0033CC",
      "#0033FF",
      "#0066CC",
      "#0066FF",
      "#0099CC",
      "#0099FF",
      "#00CC00",
      "#00CC33",
      "#00CC66",
      "#00CC99",
      "#00CCCC",
      "#00CCFF",
      "#3300CC",
      "#3300FF",
      "#3333CC",
      "#3333FF",
      "#3366CC",
      "#3366FF",
      "#3399CC",
      "#3399FF",
      "#33CC00",
      "#33CC33",
      "#33CC66",
      "#33CC99",
      "#33CCCC",
      "#33CCFF",
      "#6600CC",
      "#6600FF",
      "#6633CC",
      "#6633FF",
      "#66CC00",
      "#66CC33",
      "#9900CC",
      "#9900FF",
      "#9933CC",
      "#9933FF",
      "#99CC00",
      "#99CC33",
      "#CC0000",
      "#CC0033",
      "#CC0066",
      "#CC0099",
      "#CC00CC",
      "#CC00FF",
      "#CC3300",
      "#CC3333",
      "#CC3366",
      "#CC3399",
      "#CC33CC",
      "#CC33FF",
      "#CC6600",
      "#CC6633",
      "#CC9900",
      "#CC9933",
      "#CCCC00",
      "#CCCC33",
      "#FF0000",
      "#FF0033",
      "#FF0066",
      "#FF0099",
      "#FF00CC",
      "#FF00FF",
      "#FF3300",
      "#FF3333",
      "#FF3366",
      "#FF3399",
      "#FF33CC",
      "#FF33FF",
      "#FF6600",
      "#FF6633",
      "#FF9900",
      "#FF9933",
      "#FFCC00",
      "#FFCC33"
    ];
    function useColors() {
      if (typeof window !== "undefined" && window.process && (window.process.type === "renderer" || window.process.__nwjs)) {
        return true;
      }
      if (typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
        return false;
      }
      let m;
      return typeof document !== "undefined" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || // Is firebug? http://stackoverflow.com/a/398120/376773
      typeof window !== "undefined" && window.console && (window.console.firebug || window.console.exception && window.console.table) || // Is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      typeof navigator !== "undefined" && navigator.userAgent && (m = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(m[1], 10) >= 31 || // Double check webkit in userAgent just in case we are in a worker
      typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
    }
    function formatArgs(args) {
      args[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + args[0] + (this.useColors ? "%c " : " ") + "+" + module.exports.humanize(this.diff);
      if (!this.useColors) {
        return;
      }
      const c = "color: " + this.color;
      args.splice(1, 0, c, "color: inherit");
      let index = 0;
      let lastC = 0;
      args[0].replace(/%[a-zA-Z%]/g, (match) => {
        if (match === "%%") {
          return;
        }
        index++;
        if (match === "%c") {
          lastC = index;
        }
      });
      args.splice(lastC, 0, c);
    }
    exports.log = console.debug || console.log || (() => {
    });
    function save(namespaces) {
      try {
        if (namespaces) {
          exports.storage.setItem("debug", namespaces);
        } else {
          exports.storage.removeItem("debug");
        }
      } catch (error) {
      }
    }
    function load() {
      let r;
      try {
        r = exports.storage.getItem("debug") || exports.storage.getItem("DEBUG");
      } catch (error) {
      }
      if (!r && typeof process !== "undefined" && "env" in process) {
        r = process.env.DEBUG;
      }
      return r;
    }
    function localstorage() {
      try {
        return localStorage;
      } catch (error) {
      }
    }
    module.exports = require_common()(exports);
    var { formatters } = module.exports;
    formatters.j = function(v) {
      try {
        return JSON.stringify(v);
      } catch (error) {
        return "[UnexpectedJSONParseError]: " + error.message;
      }
    };
  }
});

// node_modules/.pnpm/cabbages@0.2.10/node_modules/cabbages/output/cabbages.js
var import_debug = __toESM(require_browser(), 1);
var log = (0, import_debug.default)("cabbages");
function pojo(target) {
  return typeof target == "object" && typeof target != null && Object.getPrototypeOf(target) == Object.prototype;
}
var BLOCK_MARKER = "\uFFFC";
function apply(target, ...rest) {
  if (rest.length == 0) {
    log("empty patch");
    return;
  }
  const [path, range, val] = rest;
  let p = [...path];
  while (true) {
    let key = p.shift();
    if (!p.length) {
      const RANGE_ARRAY = Array.isArray(range);
      if (pojo(target) && RANGE_ARRAY && typeof key == "undefined" && typeof range[0] == "string") {
        delete target[range[0]];
        return;
      }
      if (RANGE_ARRAY || typeof range == "number") {
        if (typeof key == "undefined") {
          throw new Error("cant treat top level as a seq");
        }
        key = key;
        let [start, end] = Array.isArray(range) ? range : [range, range + 1];
        const ZERO_LENGTH = Array.isArray(range) && range.length == 0;
        if (!ZERO_LENGTH && (start == null || end == null)) {
          throw new RangeError("it's all or nothing, no half measures");
        }
        const DELETE = typeof val == "undefined";
        const INSERT = start === end && !DELETE;
        const APPEND = ZERO_LENGTH && !DELETE;
        const REPLACE = !INSERT && !DELETE && !APPEND;
        if (typeof target[key] == "undefined") {
          if (typeof target == "string") {
            return;
          } else if (typeof val == "string") {
            target[key] = "";
          } else {
            target[key] = [];
          }
        }
        let seq = target[key];
        if (Array.isArray(seq)) {
          if (APPEND) {
            Array.isArray(val) ? seq.push(...val) : seq.push(val);
            return;
          }
          if (INSERT || REPLACE) {
            Array.isArray(val) ? seq.splice(start, end - start, ...val) : seq.splice(start, end - start, val);
            return;
          }
          if (DELETE) {
            seq.splice(start, end - start);
            return;
          }
          throw new Error("i don't know what happened");
        }
        if (typeof seq == "string") {
          if (APPEND) {
            target[key] = seq + val;
            return;
          }
          if (REPLACE || INSERT) {
            target[key] = seq.slice(0, start) + (typeof val == "string" ? val : val.map(
              (n) => typeof n == "string" ? n : BLOCK_MARKER
            ).join("")) + seq.slice(end);
            return;
          }
          if (DELETE) {
            target[key] = seq.slice(0, start) + seq.slice(end);
            return;
          }
          throw new Error("i don't know what happened");
        }
        if (pojo(seq) && RANGE_ARRAY && typeof range[0] == "string") {
          delete seq[range[0]];
          return;
        }
        throw new Error("not implemented");
      }
      if (typeof key == "undefined") {
        if (typeof range != "string") {
          throw new Error(`can't index top-level map with ${range}`);
        }
        if (typeof val == "undefined") {
          delete target[range];
        } else {
          target[range] = val;
        }
        return;
      }
      if (typeof target[key] == "undefined") {
        target[key] = {};
      }
      if (RANGE_ARRAY) {
        let [a, b] = range;
        if (a != null && b != null) {
          if (typeof val == "undefined" && a != null && b != null) {
            delete target[key][a || b];
          } else {
            target[key][a || b] = val;
          }
        }
      } else {
        if (typeof val == "undefined") {
          delete target[key][range];
        } else if (typeof target[key] == "string") {
          return;
        } else {
          target[key][range] = val;
        }
      }
      return;
    }
    if (typeof key == "undefined") {
      throw new Error("cant treat top level as a seq");
    }
    key = key;
    let nextkey = p[0];
    if (typeof target[key] == "undefined") {
      if (typeof nextkey == "string") {
        target[key] = {};
      } else if (typeof nextkey == "number") {
        target[key] = [];
      } else {
        throw new Error(`can't go down this road ${target}.${key}.${nextkey}`);
      }
    }
    target = target[key];
  }
}
function get(obj, key) {
  for (let p = 0; p < key.length; p++) {
    obj = obj ? obj[key[p]] : void 0;
  }
  return obj;
}
function fromAutomerge(autopatch, payload) {
  const path = autopatch.path.slice(0, -1);
  const key = autopatch.path[autopatch.path.length - 1];
  switch (autopatch.action) {
    case "mark":
    case "unmark":
      log(
        `skipping ${autopatch.action} because it doesn't affect material reality`
      );
      return [];
    case "inc":
      if (payload) {
        return [path, key, get(payload.patchInfo.after, autopatch.path)];
      } else {
        throw new Error(
          `can't apply ${autopatch.action} without payload argument`
        );
      }
    case "conflict":
      if (payload) {
        return [path, key, get(payload.patchInfo.after, autopatch.path)];
      } else {
        throw new Error(
          `can't apply ${autopatch.action} without payload argument`
        );
      }
    case "del": {
      return typeof key == "string" ? [path, key] : [path, [key, key + (autopatch.length || 1)]];
    }
    case "insert": {
      return [
        path,
        [key, key],
        structuredClone(autopatch.values)
      ];
    }
    case "splice": {
      return [path, [key, key], [autopatch.value]];
    }
    case "put": {
      return [path, key, structuredClone(autopatch.value)];
    }
  }
}

// src/autoproduce.ts
function autoproduce(payload) {
  return (doc) => {
    for (let patch of payload.patches) {
      apply(doc, ...fromAutomerge(patch, payload));
    }
  };
}

// src/createDocumentProjection.ts
import { createMemo } from "solid-js";

// src/makeDocumentProjection.ts
import { onCleanup } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
var cache = /* @__PURE__ */ new WeakMap();
function makeDocumentProjection(handle) {
  onCleanup(() => {
    const item = cache.get(handle);
    if (!item) return;
    if (!item.refs--) {
      item.cleanup();
    }
  });
  if (cache.has(handle)) {
    const item = cache.get(handle);
    item.refs++;
    return item.store;
  }
  const [doc, set] = createStore(structuredClone(handle.doc()));
  cache.set(handle, {
    refs: 0,
    store: doc,
    cleanup() {
      handle.off("change", patch);
      handle.off("delete", ondelete);
      cache.delete(handle);
    }
  });
  function patch(payload) {
    if (payload.scopeReplaced) {
      set(reconcile(payload.doc ?? {}));
      return;
    }
    set(produce(autoproduce(payload)));
  }
  function ondelete() {
    set(reconcile({}));
  }
  handle.on("change", patch);
  handle.on("delete", ondelete);
  handle.whenReady().then(() => {
    set(structuredClone(handle.doc()));
  });
  return doc;
}

// node_modules/.pnpm/@solid-primitives+utils@6.4.0_solid-js@1.9.13/node_modules/@solid-primitives/utils/dist/index.js
import { getOwner, onCleanup as onCleanup2, createSignal, untrack, sharedConfig, onMount, DEV, equalFn } from "solid-js";
import { isServer } from "solid-js/web";
var access = (v) => typeof v === "function" && !v.length ? v() : v;

// src/createDocumentProjection.ts
function createDocumentProjection(handle) {
  const projection = createMemo(
    () => access(handle) && makeDocumentProjection(access(handle))
  );
  return projection;
}

// src/useDocHandle.ts
import { createEffect, createResource, useContext } from "solid-js";

// src/context.ts
import { createContext } from "solid-js";
var RepoContext = createContext(
  null
);

// src/useDocHandle.ts
function useDocHandle(url, options) {
  const contextRepo = useContext(RepoContext);
  if (!options?.repo && !contextRepo) {
    throw new Error("use outside <RepoContext> requires options.repo");
  }
  const repo = options?.repo || contextRepo;
  function getExistingHandle() {
    if (options?.["~skipInitialValue"]) return void 0;
    const unwrappedURL = access(url);
    if (!unwrappedURL) return void 0;
    const state = repo.findWithProgress(unwrappedURL).peek();
    return state.state === "ready" ? state.handle : void 0;
  }
  const [handle, { mutate }] = createResource(
    url,
    (url2) => repo.findWithProgress(url2).whenReady(),
    {
      initialValue: getExistingHandle()
    }
  );
  createEffect(() => {
    if (!access(url)) {
      mutate();
    }
  });
  return handle;
}

// src/useDocument.ts
function useDocument(url, options) {
  const handle = useDocHandle(url, options);
  return [createDocumentProjection(handle), handle];
}

// src/makeDocSignal.ts
import { onCleanup as onCleanup3 } from "solid-js";
import { createSignal as createSignal2 } from "solid-js";
function makeDocSignal(handle) {
  const [signal, setSignal] = createSignal2(handle.doc());
  function update() {
    setSignal(() => handle.doc());
  }
  handle.on("change", update);
  onCleanup3(() => handle.off("change", update));
  return signal;
}

// src/createDocSignal.ts
import { createEffect as createEffect2, onCleanup as onCleanup4 } from "solid-js";
import { createSignal as createSignal3 } from "solid-js";
function createDocSignal(handle) {
  const [signal, setSignal] = createSignal3(handle()?.doc());
  createEffect2(() => {
    const h = handle();
    function update() {
      setSignal(() => h?.doc());
    }
    update();
    if (h) {
      h.on("change", update);
      onCleanup4(() => h.off("change", update));
    }
  });
  return signal;
}

// src/useDocSignal.ts
function useDocSignal(url, options) {
  const handle = useDocHandle(url, options);
  return [createDocSignal(handle), handle];
}

// src/useRepo.ts
import { useContext as useContext2 } from "solid-js";
function useRepo() {
  const repo = useContext2(RepoContext);
  if (!repo) throw new Error("Please wrap me in a <RepoContext value={repo}>");
  return repo;
}
export {
  RepoContext,
  autoproduce,
  createDocSignal,
  createDocumentProjection,
  makeDocSignal,
  makeDocumentProjection,
  useDocHandle,
  useDocSignal,
  useDocument,
  useRepo
};
