// scan-js.js
import fs from "fs";
import path from "path";
import { parse } from "@babel/parser";
import traversePkg from "@babel/traverse";
const traverse = traversePkg.default || traversePkg; // ✅ Fix traverse import
import * as WebFeatures from "web-features";

// ✅ Load baseline.json manually (no "assert" needed)
const baselineData = JSON.parse(
  fs.readFileSync(path.resolve("./baseline.json"), "utf-8")
);

// ✅ Convert features into an iterable array
const features = Array.isArray(WebFeatures.features)
  ? WebFeatures.features
  : Object.values(WebFeatures.features || {});

// 1. Collect JS/TS files from a directory
function getFiles(dir, files = []) {
  for (const file of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getFiles(fullPath, files);
    } else if (/\.(js|ts)$/.test(file)) {
      files.push(fullPath);
    }
  }
  return files;
}

// 2. Build a map of known feature names for quick lookup
const featureMap = new Map();
for (const f of features) {
  if (f?.name) {
    featureMap.set(f.name.toLowerCase(), f);
  }
}

// 3. Scan a single JS file for feature usage
function scanFile(filePath) {
  const code = fs.readFileSync(filePath, "utf-8");
  const ast = parse(code, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });

  const usedFeatures = new Set();

  traverse(ast, {
    Identifier(path) {
      const name = path.node.name?.toLowerCase();
      if (featureMap.has(name)) {
        usedFeatures.add(featureMap.get(name));
      }
    },
    MemberExpression(path) {
      const obj = path.node.object?.name?.toLowerCase();
      if (obj && featureMap.has(obj)) {
        usedFeatures.add(featureMap.get(obj));
      }
    },
  });

  return [...usedFeatures];
}

// 4. Scan all JS/TS files and generate a report
function main() {
  const files = getFiles("./"); // 🔍 Scan current dir
  const report = [];

  for (const file of files) {
    const detected = scanFile(file);
    for (const f of detected) {
      report.push({
        file,
        feature: f.name,
        baseline: baselineData[f.name.toLowerCase()]?.baseline ?? false,
      });
    }
  }

  console.log("📊 Baseline Feature Report:");
  for (const r of report) {
    console.log(`- ${r.feature} — baseline: ${r.baseline} — file: ${r.file}`);
  }

  const unsupported = report.filter((r) => r.baseline === false);
  if (unsupported.length > 0) {
    console.log("\n❌ Found features not yet widely supported:");
    unsupported.forEach((r) => console.log(`   - ${r.feature} in ${r.file}`));
  } else {
    console.log("\n✅ All detected features are widely supported!");
  }
}

main();
