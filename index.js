#!/usr/bin/env node

import fg from 'fast-glob';
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import * as core from '@actions/core';

import { features as wfFeatures } from 'web-features';
import { parse } from '@babel/parser';
import traversePkg from '@babel/traverse';
import postcss from 'postcss';
import postcssSelectorParser from 'postcss-selector-parser';

const traverse = traversePkg.default;

/**
 * Normalize feature definitions (array or object)
 */
function normalizeFeatures(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((f) => ({
        id: f.id ?? (f.name ? f.name.toLowerCase().replace(/\s+/g, '-') : undefined),
        name: f.name ?? undefined,
        baseline: f.baseline ?? f.status ?? false,
        description: f.description ?? '',
      }))
      .filter(Boolean);
  } else {
    return Object.entries(raw).map(([id, data]) => ({
      id,
      name: data.name ?? id,
      baseline: data.baseline ?? false,
      description: data.description ?? '',
    }));
  }
}

/**
 * Load local baseline.json if present
 */
async function loadBaselineJson(cwd) {
  try {
    const filePath = path.join(cwd, 'baseline.json');
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * AST-based JS/TS detection
 */
function detectFeaturesInJS(content, features) {
  let ast;
  try {
    ast = parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  } catch {
    return [];
  }

  const featureMap = new Map(features.map((f) => [f.name?.toLowerCase(), f]));
  const used = new Set();

  traverse(ast, {
    Identifier(path) {
      const name = path.node.name?.toLowerCase();
      if (featureMap.has(name)) used.add(featureMap.get(name));
    },
    MemberExpression(path) {
      const obj = path.node.object?.name?.toLowerCase();
      if (obj && featureMap.has(obj)) used.add(featureMap.get(obj));
    },
  });

  return Array.from(used);
}

/**
 * CSS selector detection
 */
async function detectFeaturesInCSS(content, features) {
  const root = postcss.parse(content);
  const featureMap = new Map(features.map((f) => [f.name?.toLowerCase(), f]));
  const used = new Set();

  root.walkRules((rule) => {
    postcssSelectorParser((selectors) => {
      selectors.walkPseudos((pseudo) => {
        const name = pseudo.value.replace(/^:+/, '').toLowerCase();
        if (featureMap.has(name)) used.add(featureMap.get(name));
      });
    }).processSync(rule.selector);
  });

  return Array.from(used);
}

/**
 * Load .baselineignore if present
 */
async function loadBaselineIgnore(cwd) {
  try {
    const ignoreFile = path.join(cwd, '.baselineignore');
    const content = await fs.readFile(ignoreFile, 'utf8');
    return new Set(
      content
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase())
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

async function run({
  patterns = ['**/*.{js,ts,jsx,tsx,css,html}'],
  cwd = process.cwd(),
  failOnLimited = true,
  criticalFeatures = [],
} = {}) {
  const patternsArr = Array.isArray(patterns) ? patterns : patterns.split(',').map((p) => p.trim());
  const baselineIgnore = await loadBaselineIgnore(cwd);

  // 1️⃣ Load official web-features
  const defaultFeatures = normalizeFeatures(wfFeatures);

  // 2️⃣ Load local overrides
  const baselineJson = await loadBaselineJson(cwd);
  const localOverrides = Object.entries(baselineJson).map(([name, data]) => ({
    id: name.toLowerCase(),
    name: name,
    baseline: data.baseline ?? false,
    description: data.description ?? '',
  }));

  // 3️⃣ Merge: local overrides take precedence
  const merged = new Map();
  for (const f of [...defaultFeatures, ...localOverrides]) {
    if (!baselineIgnore.has(f.name?.toLowerCase()) && !baselineIgnore.has(f.id)) {
      merged.set(f.name?.toLowerCase(), f);
    }
  }
  const features = Array.from(merged.values());

  console.error(`🔎 Scanning ${patternsArr.join(', ')} — ${features.length} features loaded`);

  const files = await fg(patternsArr, { cwd, dot: true, ignore: ['node_modules/**', '.git/**'] });
  const report = new Map();

  for (const file of files) {
    try {
      const content = await fs.readFile(path.join(cwd, file), 'utf8');
      let detected = [];
      if (/\.(js|ts|jsx|tsx|html)$/.test(file)) detected = detectFeaturesInJS(content, features);
      else if (file.endsWith('.css')) detected = await detectFeaturesInCSS(content, features);

      for (const f of detected) {
        const entry = report.get(f.id) ?? { feature: f, files: new Set() };
        entry.files.add(file);
        report.set(f.id, entry);
      }
    } catch {
      // ignore unreadable files
    }
  }

  const results = [];
  for (const [id, entry] of report.entries()) {
    results.push({ id, name: entry.feature.name, baseline: entry.feature.baseline, files: Array.from(entry.files) });
  }

  const unsafe = results.filter((r) => r.baseline === false);

  // 4️⃣ Critical feature enforcement
  const criticalLower = criticalFeatures.map(f => f.toLowerCase());
  const criticalDetected = results.filter(r => criticalLower.includes(r.id));

  const ok = !(failOnLimited && (unsafe.length > 0 || criticalDetected.length > 0));

  // ✅ Set GitHub Action outputs
  try {
    core.setOutput('ok', ok);
    core.setOutput('details', JSON.stringify(results));
    core.setOutput('critical-detected', JSON.stringify(criticalDetected));
  } catch (err) {
    console.warn('⚠️ Failed to set GitHub Actions outputs', err);
  }

  // CLI logging — go to stderr only
  if (report.size === 0) {
    console.error('✅ No matches found.');
  } else {
    console.error('🚨 Detected feature usages:');
    for (const [id, entry] of report.entries()) {
      console.error(
        `- ${id} (${entry.feature.name}) — baseline: ${entry.feature.baseline} — used in ${entry.files.size} file(s)`
      );
      Array.from(entry.files).slice(0, 5).forEach((f) => console.error(`   • ${f}`));
    }
    if (criticalDetected.length > 0) {
      console.error(`⚠️ Critical features detected: ${criticalDetected.map(f => f.id).join(', ')}`);
    }
  }

  return { ok, details: results, criticalDetected };
}

/* CLI mode */
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  (async () => {
    try {
      const failOnLimited = core.getInput('fail-on-limited') !== 'false';
      const criticalInput = core.getInput('critical-features') || '';
      const criticalFeatures = criticalInput.split(',').map(f => f.trim()).filter(Boolean);

      const res = await run({ failOnLimited, criticalFeatures });

      // ✅ Print JSON only to stdout for GitHub Actions
      console.log(JSON.stringify(res));

      process.exit(res.ok ? 0 : 1);
    } catch (err) {
      console.error(err);
      process.exit(2);
    }
  })();
}

export { run };
