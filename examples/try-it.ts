/**
 * Quick demo: parse a pipeline YAML and create a context store.
 * Run with: bun run examples/try-it.ts
 */
import { parsePipeline } from "../src/pipeline/parser";
import { createContextStore } from "../src/context/store";
import { createProviderFromConfig } from "../src/providers";

// 1. Parse a pipeline file
const pipelinePath = new URL("./demo-pipeline.yaml", import.meta.url).pathname;
const parseResult = await parsePipeline(pipelinePath);

if (!parseResult.ok) {
  console.error("❌ Parse error:", parseResult.error.message);
  process.exit(1);
}

const pipeline = parseResult.value;
console.log("✅ Pipeline parsed:", pipeline.name, `v${pipeline.version}`);
console.log("   Stages:", Object.keys(pipeline.stages).join(", "));
console.log("   Providers:", Object.keys(pipeline.providers).join(", "));

// 2. Create providers from config
for (const [name, config] of Object.entries(pipeline.providers)) {
  const result = createProviderFromConfig(name, config);
  if (result.ok) {
    console.log(`✅ Provider "${name}" created (${config.type})`);
  } else {
    console.log(`⚠️  Provider "${name}" skipped:`, result.error.message);
  }
}

// 3. Use the context store
const store = createContextStore({ dbPath: ":memory:" });

await store.set("plan.architecture", "Event-driven microservices with message queue", "planner");
await store.set("plan.tech_stack", "TypeScript, Bun, PostgreSQL", "planner");
await store.set("code.entrypoint", "console.log('hello world')", "coder");

const allEntries = await store.list();
if (allEntries.ok) {
  console.log("\n📦 Context store entries:");
  for (const entry of allEntries.value) {
    console.log(`   ${entry.key} (by ${entry.createdBy}): ${entry.value.slice(0, 60)}`);
  }
}

const planEntries = await store.list("plan.");
if (planEntries.ok) {
  console.log(`\n🔍 Entries in "plan.*" namespace: ${planEntries.value.length}`);
}

store.close();
console.log("\n✨ Done!");
