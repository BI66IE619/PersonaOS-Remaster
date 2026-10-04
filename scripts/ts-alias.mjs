import { register } from "node:module";
import { pathToFileURL } from "node:url";

/* Node runs these unit scripts with --experimental-strip-types, which strips
   types but does not do TypeScript's module resolution. Two things therefore
   need help: the app's `@/` alias, which means nothing outside Next, and the
   extensionless relative imports the app is full of (`./utils`), which Node
   cannot resolve. Both are probed on disk and handed back as file URLs.

   Worth knowing: type-only imports never reach this, because type stripping
   erases them first. A suite can pass for months with a broken resolver as
   long as the modules it touches only import types. */
register(
  "data:text/javascript," +
    encodeURIComponent(`
      import { existsSync } from "node:fs";
      import { fileURLToPath, pathToFileURL } from "node:url";

      const ROOT = ${JSON.stringify(pathToFileURL(process.cwd() + "/").href)};

      /* "./utils" -> the .ts file beside it, if that is what exists. Takes a
         real path, never a URL: existsSync does not understand file://. */
      function tryExtensions(path) {
        for (const ext of [".ts", ".tsx", ".mjs", ".js"]) {
          if (existsSync(path + ext)) return path + ext;
        }
        for (const ext of ["/index.ts", "/index.tsx", "/index.mjs", "/index.js"]) {
          if (existsSync(path + ext)) return path + ext;
        }
        return null;
      }

      export function resolve(specifier, context, next) {
        /* next/headers only works inside a request. Reaching it from a script means
           something tried to read the session, which the database suites do not
           need, so it is pointed at a stub that throws. Substituting it silently
           would let a test pass while taking a branch real code never takes. */
        if (specifier === "next/headers") {
          return next(new URL("scripts/stubs/next-headers.ts", ROOT).href, context);
        }
        if (specifier.startsWith("@/")) {
          const base = fileURLToPath(new URL("src/" + specifier.slice(2), ROOT));
          const hit = tryExtensions(base);
          return next(pathToFileURL(hit ?? base).href, context);
        }
        if (specifier.startsWith("./") || specifier.startsWith("../")) {
          if (!/\\.[a-z]+$/i.test(specifier)) {
            const from = context.parentURL ?? ROOT;
            const target = fileURLToPath(new URL(specifier, from));
            const hit = tryExtensions(target);
            if (hit) return next(pathToFileURL(hit).href, context);
          }
        }
        return next(specifier, context);
      }
    `),
  pathToFileURL("./"),
);
