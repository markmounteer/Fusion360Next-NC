"use strict";
const fs = require("node:fs");
const {inspect} = require("../lib/inspect");
const [input, output, extra] = process.argv.slice(2);
if (!input || extra) {
  console.error("Usage: node scripts/inspect.js input.stpnc [new-report.json]"); process.exitCode = 2;
} else {
  try {
    const result = inspect(fs.readFileSync(input, "utf8"));
    const report = JSON.stringify(result.report, null, 2) + "\n";
    if (output) fs.writeFileSync(output, report, {flag: "wx"});
    process.stdout.write(report);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
