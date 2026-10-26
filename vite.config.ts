import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// Build identifier baked into the bundle as __BUILD_ID__ and attached
// to every analytics event (src/services/buildId.ts), so a field
// report can be tied to the exact deployed build. Resolution order:
// explicit VITE_BUILD_ID env → git short hash (local builds, where
// the repo is at hand) → build timestamp (hosted builds without git
// still get a unique id per publish).
function resolveBuildId(): string {
  if (process.env.VITE_BUILD_ID) return process.env.VITE_BUILD_ID;
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    /* no git in this build environment — fall through */
  }
  return `build-${new Date().toISOString()}`;
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(resolveBuildId()),
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
