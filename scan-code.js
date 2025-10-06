import fs from "fs";
import path from "path";
import { parse } from "@babel/parser";
import traversePkg from "@babel/traverse";
const traverse = traversePkg.default;
import * as WebFeatures from "web-features";
import postcss from "postcss";
import postcssSelectorParser from "postcss-selector-parser";

// Load baseline.json or fallback to an empty object
const baselineData = JSON.parse(
  fs.existsSync(path.resolve("./baseline.json"))
    ? fs.readFileSync(path.resolve("./baseline.json"), "utf-8")
    : "{}"
);

// ✅ Build iterable features list
const features = Object.values(WebFeatures.features || {});

// 1. Collect files recursively
function getFiles(dir, files = []) {
  for (const file of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getFiles(fullPath, files);
    } else if (/\.(js|ts|css)$/.test(file)) {
      files.push(fullPath);
    }
  }
  return files;
}

// 2. Build a lookup map of known features
const featureMap = new Map();
for (const f of features) {
  if (f?.name) {
    featureMap.set(f.name.toLowerCase(), f);
  }
}

// 3. Scan JS/TS files with error handling
function scanJSFile(filePath) {
  const code = fs.readFileSync(filePath, "utf-8");
  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });
  } catch (err) {
    console.error(`❌ Failed to parse ${filePath}: ${err.message}`);
    return [];
  }

  const usedFeatures = new Set();

  traverse(ast, {
    Identifier(path) {
      const name = path.node.name?.toLowerCase();
      if (featureMap.has(name)) usedFeatures.add(featureMap.get(name));
    },
    MemberExpression(path) {
      const obj = path.node.object?.name?.toLowerCase();
      if (obj && featureMap.has(obj)) usedFeatures.add(featureMap.get(obj));
    },
  });

  return [...usedFeatures];
}

// 4. Scan CSS files
async function scanCSSFile(filePath) {
  const cssCode = fs.readFileSync(filePath, "utf-8");
  const root = postcss.parse(cssCode);
  const usedFeatures = new Set();

  root.walkRules(rule => {
    postcssSelectorParser(selectors => {
      selectors.walkPseudos(pseudo => {
        const name = pseudo.value.replace(":", "").toLowerCase();
        if (featureMap.has(name)) usedFeatures.add(featureMap.get(name));
      });
    }).processSync(rule.selector);
  });

  return [...usedFeatures];
}

// 5. Scan all files
async function main() {
  const files = getFiles("./");
  const report = [];

  for (const file of files) {
    let detected = [];
    if (file.endsWith(".js") || file.endsWith(".ts")) {
      detected = scanJSFile(file);
    } else if (file.endsWith(".css")) {
      detected = await scanCSSFile(file);
    }

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

  const unsupported = report.filter(r => !r.baseline);
  if (unsupported.length > 0) {
    console.log("\n❌ Found features not yet widely supported:");
    unsupported.forEach(r => console.log(`   - ${r.feature} in ${r.file}`));
  } else {
    console.log("\n✅ All detected features are widely supported!");
  }
}

main().catch(err => console.error("Unexpected error:", err));
