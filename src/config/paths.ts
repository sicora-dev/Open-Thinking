import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Allow tests and sandboxed runs to redirect ~/.openthk to a writable temp dir.
 */
export function getOpenthkConfigDir(): string {
  return process.env.OPENTHK_CONFIG_DIR ?? join(homedir(), ".openthk");
}
