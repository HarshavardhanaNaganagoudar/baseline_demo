#!/usr/bin/env node

import core from '@actions/core';
import github from '@actions/github';

/**
 * Helper to generate MDN link for a feature
 */
function mdnLink(featureId) {
  if (!featureId) return '';
  return `[MDN](https://developer.mozilla.org/en-US/docs/Web/API/${featureId})`;
}

/**
 * Determines severity of a feature
 * @param {object} feature
 * @returns 'fail' | 'warning'
 */
function getSeverity(feature) {
  // For now, baseline:false features are 'fail', but you can add rules here
  return feature.critical ? 'fail' : 'warning';
}

async function run() {
  try {
    // 1️⃣ Inputs from GitHub Action
    const token = core.getInput('github-token', { required: true });
    const scanResultsJson = core.getInput('scan-results', { required: true });

    // 2️⃣ Safely parse scan results
    let scanResults;
    try {
      scanResults = JSON.parse(scanResultsJson);
    } catch (e) {
      throw new Error('❌ Invalid scan-results JSON provided to post-pr-comment.js');
    }

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const pull_number = github.context.payload.pull_request?.number;

    if (!pull_number) {
      console.log('⚠️ No pull request detected — skipping PR comment.');
      return;
    }

    // 3️⃣ Filter only non-baseline features
    const nonBaseline = (scanResults.details || []).filter(f => f.baseline === false);

    // 4️⃣ Build the comment body
    let commentBody = `## 🔎 Baseline Feature Check Report\n\n`;

    if (scanResults.ok || nonBaseline.length === 0) {
      commentBody += '✅ No `baseline: false` features found!\n';
    } else {
      commentBody += `❌ ${nonBaseline.length} non-Baseline feature(s) detected:\n\n`;

      commentBody += '| Feature | MDN Link | Severity | Used in Files |\n';
      commentBody += '|---------|----------|----------|---------------|\n';

      nonBaseline.forEach(f => {
        // Deduplicate files
        const uniqueFiles = Array.from(new Set(f.files));
        const fileList = uniqueFiles.slice(0, 5).map(file => `\`${file}\``).join('<br>');

        let moreFiles = '';
        if (uniqueFiles.length > 5) {
          moreFiles = `<br>...and ${uniqueFiles.length - 5} more file(s)`;
        }

        const severity = getSeverity(f);
        const severityLabel = severity === 'fail' ? '❌ Fail' : '⚠️ Warning';

        commentBody += `| **${f.name}** (\`${f.id}\`) | ${mdnLink(f.id)} | ${severityLabel} | ${fileList}${moreFiles} |\n`;
      });

      commentBody += `\n⚠️ Consider refactoring or verifying browser support for these features before merging.\n`;
    }

    // 5️⃣ Update existing comment if present
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: pull_number,
    });

    const existing = comments.find(
      c => c.user.type === 'Bot' && c.body.startsWith('## 🔎 Baseline Feature Check Report')
    );

    if (existing) {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existing.id,
        body: commentBody,
      });
      console.log('🔁 Updated existing baseline report comment.');
    } else {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pull_number,
        body: commentBody,
      });
      console.log('✅ Posted new baseline report comment.');
    }

  } catch (err) {
    core.setFailed(err.message);
  }
}

run();
