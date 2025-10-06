# 🔎 Baseline CI Guard

**Baseline CI Guard** is a GitHub Action that automatically scans your pull requests for the use of non-baseline web platform features — helping you catch browser-compatibility issues **before** they reach production.

It integrates directly into your CI pipeline, posts a detailed PR comment with detected features, and can optionally **fail the build** if critical or non-baseline APIs are used.

---

## ✨ Features

- ✅ **Automatic feature detection** in JS, TS, JSX, TSX, CSS, and HTML  
- 📊 **Pull Request reporting** with Markdown tables and MDN links  
- 🚨 **Fail-on-unsafe** mode to block merging PRs with risky APIs  
- ⚙️ **Customizable rules** via `baseline.json` and `.baselineignore`  
- 🧪 AST-based parsing for **high accuracy** and minimal false positives

---

## 🛠️ How It Works

When a pull request is opened or updated:

1. 🔍 `index.js` scans the repository for web platform features using [`web-features`](https://github.com/mdn/web-features).
2. 📊 A report is generated listing all detected features and whether they are part of the **baseline**.
3. 💬 A comment is automatically posted on the PR with MDN links, severity levels, and usage locations.
4. 🚦 (Optional) If unsafe or critical features are found, the CI **fails** to block merging.

---

## 🚀 Quick Start

### 1. Add the GitHub Action

Create a workflow file:  
`.github/workflows/baseline.yml`

```yaml
name: Baseline Feature Check

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  baseline:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Run Baseline Scan
        id: scan
        run: |
          echo "🔎 Running feature scan..."
          node index.js > scan-result.json 2> >(tee scan-log.txt >&2)
          SCAN_RESULT=$(cat scan-result.json | jq -c .)
          echo "scan-result=$SCAN_RESULT" >> $GITHUB_OUTPUT

      - name: Post PR Comment
        run: node post-pr-comment.js
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          INPUT_GITHUB-TOKEN: ${{ secrets.GITHUB_TOKEN }}
          INPUT_SCAN-RESULTS: ${{ steps.scan.outputs.scan-result }}

      # Optional: Fail the workflow if unsafe features are found
      - name: Fail on Unsafe Features
        if: ${{ fromJSON(steps.scan.outputs.scan-result).ok == false }}
        run: exit 1

```

---

## 🔎 Baseline Feature Check Report

❌ 2 non-Baseline feature(s) detected:

| Feature | MDN Link | Severity | Used in Files          |
|--------|----------|----------|------------------------|
| JSON   | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/JSON) | ⚠️ Warning | index.js, scan-code.js |
| Content | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Content) | ⚠️ Warning | index.js              |

⚠️ Consider refactoring or verifying browser support for these features before merging.


---

## 📈 CI Workflow Examples

### Testing Mode (workflow will complete even with unsafe features)

```yaml
name: Baseline Feature Check

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  baseline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Run Baseline Scan
        id: scan
        run: |
          echo "🔎 Running feature scan..."
          node index.js > scan-result.json 2> >(tee scan-log.txt >&2) || true
          if [ -s scan-result.json ]; then
            SCAN_RESULT=$(cat scan-result.json | jq -c . 2>/dev/null || echo '{"ok":false,"details":[]}')
          else
            SCAN_RESULT='{"ok":false,"details":[]}'
          fi
          echo "scan-result=$SCAN_RESULT" >> $GITHUB_OUTPUT

      - name: Post PR Comment
        run: node post-pr-comment.js
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          INPUT_GITHUB-TOKEN: ${{ secrets.GITHUB_TOKEN }}
          INPUT_SCAN-RESULTS: ${{ steps.scan.outputs.scan-result }}

      - name: Skip Fail on Unsafe Features (testing)
        run: echo "✅ Testing mode: skipping fail step."

```
---

### Production Mode (fail PRs with unsafe features)

```yaml
# same as above until Post PR Comment step
      - name: Fail on Unsafe Features
        if: ${{ fromJSON(steps.scan.outputs.scan-result).ok == false }}
        run: exit 1
```
