import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
const root = process.cwd();
const runtimeSource = "./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930/src";
export default defineConfig({ resolve: { dedupe: ["react", "react-dom"], alias: [{ find: "@/components/data-prep-tab", replacement: resolve(root, "output/data-prep-full-acceptance-20261004/runtime-delta/postimages/src/components/data-prep-tab.tsx") }, { find: "@/components/typed-resource-access-editor", replacement: resolve(runtimeSource, "components/typed-resource-access-editor.tsx") }, { find: "@/components/data-prep-request-recovery", replacement: resolve(runtimeSource, "components/data-prep-request-recovery.tsx") }, { find: "@", replacement: resolve(root, "src") }] }, test: { setupFiles: [resolve(root, "vitest.setup.ts")], include: ["scripts/qa/data-prep-full-acceptance-20261004/editor-*.spec.*"], maxWorkers: 1, fileParallelism: false } });
