import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
/** Resolve linked executables using the selected platform's PATH and command extensions. */
export function locateTool(name: string, path: string, platform = process.platform): string {
  const windows = platform === 'win32';
  for (const directory of path.split(windows ? ';' : delimiter)) for (const suffix of windows ? ['.exe', '.cmd', '.bat', ''] : ['']) {
    const candidate = join(directory, name + suffix);
    try { accessSync(candidate, windows ? constants.F_OK : constants.X_OK); return candidate; } catch { /* Try the next PATH entry. */ }
  }
  throw new Error(`Required consumer tool unavailable: ${name}`);
}
/** Windows command shims require the shell; native executables retain argument-array execution. */
export function commandShell(executable: string, platform = process.platform): boolean { return platform === 'win32' && /\.(?:cmd|bat)$/iu.test(executable); }

/** Read PATH from a copied environment while preserving Windows key spelling. */
export function commandPath(env: NodeJS.ProcessEnv): string { return Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? ''; }
