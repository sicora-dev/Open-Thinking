/**
 * Interactive setup wizard for first-run provider configuration.
 * Presents a navigable list of providers using arrow keys.
 */
import * as readline from "node:readline";
import { addProvider, hasAnyProviders, loadGlobalConfig } from "./global-config";
import { type CatalogProvider, PROVIDER_CATALOG } from "./provider-catalog";

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  inverse: "\x1b[7m",
  hide: "\x1b[?25l",
  show: "\x1b[?25h",
};

/**
 * Read a single keypress from stdin (raw mode).
 */
function readKey(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("data", (data) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(data.toString());
    });
  });
}

/**
 * Read a line of text input (with masking for API keys).
 */
function readLine(prompt: string, mask = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (mask) {
      // Mask input for API keys by overriding stdout.write
      const origWrite = process.stdout.write.bind(process.stdout);
      let promptPrinted = false;
      process.stdout.write = ((...args: Parameters<typeof process.stdout.write>): boolean => {
        const str = typeof args[0] === "string" ? args[0] : args[0].toString();
        if (!promptPrinted || str === "\r\n" || str === "\n" || str.includes(prompt)) {
          if (str.includes(prompt)) promptPrinted = true;
          return origWrite(...args);
        }
        return origWrite("•".repeat(str.length));
      }) as typeof process.stdout.write;

      rl.question(prompt, (answer) => {
        process.stdout.write = origWrite;
        rl.close();
        resolve(answer.trim());
      });
    } else {
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

/**
 * Render the provider selection list.
 */
function renderProviderList(
  providers: CatalogProvider[],
  cursor: number,
  selected: Set<string>,
  configuredIds: Set<string>,
): void {
  // Clear screen area
  process.stdout.write(`\x1b[${providers.length + 6}A\x1b[J`);

  console.log(
    `  ${C.bold}Select providers to configure${C.reset} ${C.dim}(↑↓ navigate, space toggle, enter confirm)${C.reset}\n`,
  );

  let lastCategory = "";
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i] as CatalogProvider;

    // Category header
    if (p.category !== lastCategory) {
      const label = p.category === "cloud" ? "☁  Cloud Providers" : "💻 Local Inference";
      console.log(`  ${C.dim}${label}${C.reset}`);
      lastCategory = p.category;
    }

    const isCursor = i === cursor;
    const isSelected = selected.has(p.id);
    const isConfigured = configuredIds.has(p.id);

    const check = isSelected
      ? `${C.green}◉${C.reset}`
      : isConfigured
        ? `${C.cyan}●${C.reset}`
        : `${C.dim}○${C.reset}`;
    const name = isCursor ? `${C.inverse} ${p.name} ${C.reset}` : ` ${p.name} `;
    const desc = `${C.dim}${p.description}${C.reset}`;
    const configured = isConfigured ? ` ${C.cyan}(configured)${C.reset}` : "";

    console.log(`  ${check}${name}${desc}${configured}`);
  }

  console.log(`\n  ${C.dim}Space = toggle • Enter = confirm • q = skip${C.reset}`);
}

/**
 * Interactive provider selector with arrow key navigation.
 * Returns the list of provider IDs the user selected.
 */
async function selectProviders(configuredIds: Set<string>): Promise<string[]> {
  const providers = PROVIDER_CATALOG;
  let cursor = 0;
  const selected = new Set<string>();

  // Print initial space for the list
  for (let i = 0; i < providers.length + 6; i++) {
    console.log();
  }

  renderProviderList(providers, cursor, selected, configuredIds);

  process.stdout.write(C.hide);

  while (true) {
    const key = await readKey();

    if (key === "\x1b[A") {
      // Up arrow
      cursor = cursor > 0 ? cursor - 1 : providers.length - 1;
    } else if (key === "\x1b[B") {
      // Down arrow
      cursor = cursor < providers.length - 1 ? cursor + 1 : 0;
    } else if (key === " ") {
      // Space = toggle selection
      const p = providers[cursor] as CatalogProvider;
      if (selected.has(p.id)) {
        selected.delete(p.id);
      } else {
        selected.add(p.id);
      }
    } else if (key === "\r" || key === "\n") {
      // Enter = confirm
      process.stdout.write(C.show);
      return Array.from(selected);
    } else if (key === "q" || key === "\x1b" || key === "\x03") {
      // q, Escape, Ctrl+C = skip
      process.stdout.write(C.show);
      return [];
    }

    renderProviderList(providers, cursor, selected, configuredIds);
  }
}

/**
 * Prompt user for API key for a specific provider.
 */
async function configureProvider(catalog: CatalogProvider): Promise<boolean> {
  console.log();
  console.log(`  ${C.bold}${catalog.name}${C.reset} ${C.dim}(${catalog.description})${C.reset}`);

  if (!catalog.requiresKey) {
    // Local providers just need URL confirmation
    const url = await readLine(`  Base URL [${catalog.baseUrl}]: `);
    const finalUrl = url || catalog.baseUrl;

    addProvider({
      id: catalog.id,
      name: catalog.name,
      apiKey: "",
      baseUrl: finalUrl,
      type: catalog.type,
      addedAt: new Date().toISOString(),
    });

    console.log(`  ${C.green}✓${C.reset} ${catalog.name} configured at ${finalUrl}`);
    return true;
  }

  if (catalog.signupUrl) {
    console.log(`  ${C.dim}Get your API key: ${catalog.signupUrl}${C.reset}`);
  }

  const apiKey = await readLine("  API Key: ", true);

  if (!apiKey) {
    console.log(`  ${C.yellow}Skipped${C.reset} — no key provided`);
    return false;
  }

  // For Azure, also ask for the base URL
  let baseUrl = catalog.baseUrl;
  if (catalog.id === "azure") {
    const url = await readLine("  Base URL (e.g., https://myresource.openai.azure.com/...): ");
    if (url) baseUrl = url;
  }

  addProvider({
    id: catalog.id,
    name: catalog.name,
    apiKey,
    baseUrl,
    type: catalog.type,
    addedAt: new Date().toISOString(),
  });

  // Show masked key
  const masked = `${apiKey.slice(0, 4)}${"•".repeat(Math.min(apiKey.length - 8, 20))}${apiKey.slice(-4)}`;
  console.log(`  ${C.green}✓${C.reset} Saved ${C.dim}(${masked})${C.reset}`);
  return true;
}

/**
 * Run the full setup wizard.
 * Called on first run or via /providers setup.
 */
export async function runSetupWizard(): Promise<number> {
  console.log();
  console.log(`  ${C.bold}${C.cyan}OpenThinking — Provider Setup${C.reset}`);
  console.log(`  ${C.dim}Configure the LLM providers you want to use.${C.reset}`);
  console.log(`  ${C.dim}API keys are stored in ~/.openthk/providers.json${C.reset}`);

  const config = loadGlobalConfig();
  const configuredIds = new Set(Object.keys(config.providers));

  if (configuredIds.size > 0) {
    console.log(
      `\n  ${C.dim}Already configured: ${Array.from(configuredIds).join(", ")}${C.reset}`,
    );
  }

  const selectedIds = await selectProviders(configuredIds);

  if (selectedIds.length === 0) {
    console.log(`\n  ${C.dim}No providers selected.${C.reset}`);
    return 0;
  }

  let configured = 0;
  for (const id of selectedIds) {
    const catalog = PROVIDER_CATALOG.find((p) => p.id === id);
    if (!catalog) continue;
    const success = await configureProvider(catalog);
    if (success) configured++;
  }

  console.log();
  if (configured > 0) {
    console.log(
      `  ${C.green}✓${C.reset} ${configured} provider${configured !== 1 ? "s" : ""} configured successfully.`,
    );
  }
  console.log();

  return configured;
}

/**
 * Check if this is the first run (no providers configured).
 * If so, prompt the user to run setup.
 */
export async function checkFirstRun(): Promise<void> {
  if (hasAnyProviders()) return;

  // Only prompt if we're in an interactive terminal
  if (!process.stdin.isTTY) return;

  console.log(`  ${C.yellow}No providers configured yet.${C.reset}`);
  const answer = await readLine("  Run provider setup? (Y/n) ");

  if (answer === "" || answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
    await runSetupWizard();
  }
}
