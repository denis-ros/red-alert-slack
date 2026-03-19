import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const projectDir = process.cwd();
const templatePath = path.join(projectDir, "launchd", "local.red-alert-slack.plist");
const distEntry = path.join(projectDir, "dist", "index.js");
const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
const targetPath = path.join(launchAgentsDir, "local.red-alert-slack.plist");

if (!fs.existsSync(templatePath)) {
  throw new Error(`LaunchAgent template not found: ${templatePath}`);
}

if (!fs.existsSync(distEntry)) {
  throw new Error(`Build output not found: ${distEntry}. Run npm run build first.`);
}

const template = fs.readFileSync(templatePath, "utf8");
const rendered = template
  .replaceAll("__PROJECT_DIR__", escapeXml(projectDir))
  .replaceAll("__NODE_PATH__", escapeXml(process.execPath));

fs.mkdirSync(launchAgentsDir, { recursive: true });
fs.writeFileSync(targetPath, rendered, "utf8");

console.log(`Installed LaunchAgent template to ${targetPath}`);
console.log("Next steps:");
console.log(`  launchctl unload ${targetPath} 2>/dev/null || true`);
console.log(`  launchctl load ${targetPath}`);
