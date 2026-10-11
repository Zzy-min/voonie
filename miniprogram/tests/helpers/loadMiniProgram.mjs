import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ts = require(path.resolve(root, "../web-v2/node_modules/typescript"));

export function loadMiniProgram(relative, { wx = {}, app = {}, api, globals = {} } = {}) {
  let definition;
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (file.endsWith(path.join("utils", "api.ts")) && api) return api;
    if (cache.has(file)) return cache.get(file).exports;
    const source = fs.readFileSync(file, "utf8");
    const code = file.endsWith(".ts") ? ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText : source;
    const module = { exports: {} }; cache.set(file, module);
    const context = vm.createContext({ wx, getApp: () => app, Page: (config) => definition = config,
      Component: (config) => definition = config, module, exports: module.exports,
      setTimeout, clearTimeout, setInterval, clearInterval, console: { info() {}, warn() {}, error() {} }, ...globals,
      require(specifier) {
        if (!specifier.startsWith(".")) return require(specifier);
        const target = path.resolve(path.dirname(file), specifier);
        return load([target, `${target}.ts`, `${target}.js`].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()));
      },
    });
    vm.runInContext(code, context, { filename: file });
    return module.exports;
  }
  const exports = load(path.resolve(root, relative));
  if (!definition) return exports;
  return Object.assign({}, definition, {
    data: structuredClone(definition.data), getTabBar: () => null,
    setData(values) {
      Object.entries(values).forEach(([key, value]) => {
        const parts = key.replace(/\[(\d+)\]/g, ".$1").split(".");
        let target = this.data;
        for (const part of parts.slice(0, -1)) target = target[part];
        target[parts.at(-1)] = value;
      });
    },
  });
}
