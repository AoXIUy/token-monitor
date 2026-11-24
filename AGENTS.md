# AGENTS.md

This file provides shared project guidance for coding agents that load it. Read linked documents as needed. [Tripwires](#tripwires) below highlight constraints that unrelated changes could violate; the linked documents explain the reasoning.

## Commands

```bash
npm start          # launch the Electron widget (= npm run widget / npm run dev)
npm run hub        # start the Node hub on port 17321
npm run mcp        # start the standalone stdio MCP server for usage reports & queries
npm run agent      # start the headless collector→hub agent
npm run agent:once # one-shot collect+post, then exit (useful for cron/launchd)
npm test           # run the node:test suite (node --test "tests/**/*.test.js")
npm run lint       # ESLint flat config (eslint.config.js)
npm run typecheck  # opt-in JavaScript type checking (no emit)
npm run verify     # lint + typecheck + test (single local entry point)
npm run sync:worker      # vendor src/shared/ closure into worker/src/shared/
npm run update:hub-build # update src/shared/hubBuildRegistry.json and run sync:worker
```

Automated verification is `npm run verify`; CI (`.github/workflows/ci.yml`) runs lint + typecheck + test on push/PR across Node 22 & 24. The toolchain (ESLint 10 + the node:test glob) needs Node 22.13+ and DSH session decoding needs `zlib.zstdDecompressSync` (Node 22.15+), which is why `engines.node` is `>=22.15.0`.

New shared modules start with `// @ts-check`; existing files opt in when touched for a reason. Type checking uses JSDoc and emits no code.

To dry-run the agent without posting: `npm run agent:once -- --dry-run`.

## Where guidance lives

| Changing… | Read first |
|---|---|
| a boundary shared by the widget, agent, Hub or Worker; the collector, limits runtime, credentials or wire record | `docs/architecture.md` |
| an existing provider under `src/shared/providers/<id>/` or `src/electron/providers/<id>/` | The note whose `ids:` front matter lists that id — `grep -lE '^ids:.*[[, ]<id>[],]' docs/providers/*.md`; use its `read_when` to select relevant guidance. If none exists, use the code/tests and [shared code layout](docs/providers/README.md#where-provider-code-lives) |
| adding or renaming a tracked client | [Tracked-client checklist](docs/providers/README.md#adding-a-tracked-client), including its partition invariants |
| adding or renaming a limits provider | [Limits-provider checklist](docs/providers/README.md#adding-a-limits-provider) |
| watch roots, event handling or targeted refreshes | [Watching](docs/architecture.md#watching), [partition invariants](docs/providers/README.md#partition-invariants), and the matching provider note's source rules |
| the device wire shape or Hub endpoints | `docs/API.md` |
| this fork's Node-Hub-only extensions (online conversations, realtime rates, approval alerts, reports & MCP, AI analysis & OpenClaw WeChat, Antigravity Account Manager snapshots) | `docs/architecture.md#entry-points-and-the-worker-boundary`, `docs/API.md`, and the matching guide (`docs/session-conversations.md`, `docs/session-realtime.md`, `docs/approval-alerts.md`, `docs/reports-mcp.md`, `docs/openclaw-wechat.md`) |
| this fork's desktop release packaging, versioning, or GitHub release workflow | `docs/releasing-fork.md` |

Before changing runtime behavior, identify the relevant entry point, authoritative implementation, and affected callers. Scale investigation to the task; resolve any mismatch with documented contracts before editing.

Reading guidance does not require editing it. Update the narrowest relevant document in the same change when existing guidance becomes inaccurate or a necessary, non-obvious contract is introduced. Fixes that restore an already documented invariant and behavior-preserving refactors normally need no documentation change. Correct or remove stale claims rather than appending history.

## Tripwires

Each line is a constraint that a change elsewhere has broken before, or would break silently.

- **Worker isolation.** `worker/` cannot import above itself. Edit `src/shared/`, never the `@generated` copies under `worker/src/shared/`, then run `npm run sync:worker`; CI fails on drift. Modules in that closure stay free of Node built-ins. → `docs/architecture.md` (Entry points)
- **Hub build marker.** Run `npm run update:hub-build` once after the final Hub/shared change; never hand-edit generated Worker metadata. `limits/providers.js` is in the Hub core, so adding, reordering or renaming a limits provider moves the marker too. → `docs/architecture.md` (Generated and registered state)
- **tokscale binary.** Only app, agent and packaging entry points run `ensure:tokscale`; install, hub, lint, test and verify must never download it. → `docs/architecture.md` (Generated and registered state)
- **Serial scans, exact deltas.** Full ticks scan today/month/allTime serially; watch ticks scan `--today` only and apply an exact delta. Do not parallelise the scans or turn the delta into an estimate. → `docs/architecture.md` (Collector pipeline)
- **No watch cooldown.** The product promises 3–5 s updates; a mid-tick watch event re-arms the debounce. Do not add a cooldown, and do not watch the self-synced tokscale cache dirs (they re-trigger forever). → `docs/architecture.md` (Watching)
- **Client ids are partition keys.** Each tracked-client id must be a fixed point of `normalizeClientName()`, every tokscale alias must filter back to its parent, and the filter must never emit `synthetic`. → `docs/providers/README.md` (Partition invariants)
- **Limits refresh triggers.** Local token usage never triggers a limits refresh, and `burn-rate` stays out of `COOLDOWN_BYPASS_REASONS`. → `docs/architecture.md` (Limits collector)
- **Electron transport.** Provider calls take the injected transport. Under Chromium never set a `Host` header, keep `credentials: 'omit'`, and expect a cross-origin `Referer` with a path to be cancelled. → `docs/architecture.md` (Outbound transport)
- **Credentials stay in main.** Renderer settings are default-deny; a raw credential crosses only through an explicit allowlist. New fixed credentials declare a `storePath` in the provider's `account.js` (`CREDENTIAL_SETTING_PATHS` derives from it) — never a literal entry in `credentialStore.js`, never a provider-specific store. Limits account leaves must stay require-free; renderer form DTOs expose display/action metadata, never store paths, resolvers or secrets. → `docs/architecture.md` (Settings and credentials)
- **Public stats stay public.** In the Worker, the subscription version stamp and sync-settings revisions are added by `statsWithSubscriptionVersion()` on authenticated paths only; folding them into `getStats()` leaks through the unauthenticated public route. The Node hub has no public route, so its `getStats()` sets both directly. → `docs/architecture.md` (Subscriptions)
- **Balance quotas.** Key money display off `windows[].metric === 'credits'` through `limits/balanceDisplay.js`, never a provider whitelist; display-only percentages stay out of the wire shape. → `docs/architecture.md` (Balance quotas)
- **Compatibility surfaces.** Settings keys, env vars, CLI flags, Hub endpoints and the wire shape have external users. Treat changes as breaking and plan the migration.
- **Node-Hub-only fork extensions and Hub build closure.** Online conversations, approval alerts, usage reports & `/api/mcp`, AI analysis & OpenClaw integrations, unified `/api/query/*`, and Antigravity Account Manager snapshots run only on Node Hub / Desktop Local Bridge — never add them to Cloudflare Worker. Every module statically imported by `src/hub/server.js` outside `CORE_SOURCE_FILES` must be registered in `scripts/hub-build-manifest.js` (`NODE_RUNTIME_SOURCE_FILES`), followed by `npm run update:hub-build`; `tests/shared/hubBuild.test.js` enforces the exact dependency closure.
- **Packaged Electron assets (`build.files`).** Runtime assets loaded by the packaged desktop app (such as `src/mcp/**/*`, `plugins/quota-alerts/evaluator.cjs`, and `skills/openclaw-token-monitor/**/*`) must be explicitly included in `package.json` → `build.files`. Local `npm start` reads from the worktree and hides missing `app.asar` entries.
- **Antigravity Account Manager isolation.** The standalone Account Manager (`src/electron/antigravityManager/`, `src/electron/renderer/antigravityManager.*`) stays independent from the usage/limits collectors; OAuth tokens, system keyring entries, encrypted `tokens.enc`, and device profiles never leave the desktop host. Only sanitized, credential-free pool snapshots (`src/shared/antigravityManagerProtocol.js`, ≤ 512 KiB) publish to `PUT /api/antigravity-manager/snapshot` and must never enter `DeviceRecord`, Worker, or public stats.
- **Fork release template and updater assertions.** `tests/shared/appUpdater.test.js` and `tests/shared/releaseArtifactNames.test.js` assert that `src/shared/appUpdater.js` derives `AoXIUy/token-monitor` from `package.json` → `repository.url` and that `.github/RELEASE_TEMPLATE.md` carries 5 aligned `<!-- app-update-notes:<locale>:start/end -->` blocks (`en`, `zh`, `zh-TW`, `ko`, `ja` with matching categories/item counts and no trailing PR references) plus one `Full Changelog` link matching `AoXIUy/token-monitor/compare/v<prev>...v<version>`.

## Conventions

- **Consider best practices first.** When picking an approach — library vs hand-roll, pattern vs custom, framework default vs override — start by checking the ecosystem convention, not by optimizing for "fewer deps" or "less code". If a hand-rolled solution is genuinely better, argue that *after* weighing the convention.
- **Keep changes grounded in evidence.** Fix demonstrated bugs, uphold documented contracts and Tripwires, and handle expected failures within the task's scope without asking for routine confirmation. Do not add defensive machinery solely for hypothetical scenarios with no concrete basis in the code, supported runtime behavior, or requirements. Low likelihood alone is not a reason to ignore a correctness or security issue. If an unresolved concern materially affects the result, briefly state the failure mode and evidence in the final summary or PR description; otherwise, omit speculative warnings.
- **Validate at boundaries; trust established internal contracts.** Validate and normalize external or persisted data at the boundary that owns it. Internal functions should rely on those established guarantees rather than repeat the same checks or silently replace invalid internal values with empty defaults. Add further checks when a function crosses another trust boundary or needs an invariant not already guaranteed. Preserve validation required for supported compatibility.
- **Make abstractions earn their place.** Prefer straightforward code over helpers, wrappers, or configuration added for possible future reuse. Extract an abstraction when it removes meaningful duplication, clarifies a complex operation, or establishes a useful responsibility boundary. A single-use helper is fine when its name and structure make the caller easier to understand; reuse count alone is not the deciding factor.
- **Don't add dependencies or new tooling without discussing it first** (in the issue or PR description).
- **Keep documentation close to its scope and current.** This file holds cross-cutting commands, tripwires and conventions; `docs/architecture.md` holds cross-subsystem owners, invariants and their reasons. Subsystem-specific guidance belongs with that subsystem, and provider knowledge in `docs/providers/`. Keep implementation mechanics beside the code and change summaries in the PR. Author-facing documentation should focus on supported APIs, observable behavior, limitations, and practical examples. Do not present private implementation details or bug-fix history as public contracts. Document non-obvious constraints and gotchas, not descriptions the code already makes obvious. Avoid hardcoded counts and exhaustive lists (prefer a command like `ls src/shared/` over a hand-maintained one); verify claims against the code before writing them; delete anything that has gone stale — an outdated note is worse than none.

### Commit messages

Format: `<type>(<scope>): <subject>` — conventional-commit types (`feat` / `fix` / `refactor` / `docs` / `chore` / `perf` / `test` / …), with a scope when the change targets a clear subsystem (`fix(hermes):`, `fix(collector):`, `feat(limits):`); leave it off for cross-cutting or general changes. When a change belongs to a single provider, scope it by that provider (`fix(opencode):`, `fix(codex):`) rather than by the subsystem it happens to live in. Aim for a subject ≤ ~72 chars that describes the actual change. Add a **body** only when the diff doesn't make the *why* obvious — rationale, rejected alternatives, behaviour-preserving notes, linked issues; trivial changes stay single-line. Write body paragraphs as continuous lines, not hard-wrapped.

**Do:**

```
fix(dashboard): balance stat card widths
feat(wsl): scan usage from running WSL distros
docs(i18n): add Japanese README
```

**Don't** — vague subjects, or internal review/agent jargon (`P0`/`P1`, "review findings", "hardening pass"):

```
fix: address P0 review findings   ❌
fix: hardening pass round 2       ❌
fix: various improvements         ❌
```

Never add an AI `Co-Authored-By` trailer. **Do** keep the genuine human `Co-authored-by:` trailer on a multi-author squash (e.g. a maintainer follow-up on a contributor PR) and keep the `(#NN)` PR-number suffix GitHub appends to squash subjects.

### Pull requests

- PR titles follow the commit-message convention above — they become the squash-merge subject.
- In the description: summarize the change and why it is needed, link any related issue, and record checks and results, including `npm run verify` or why it could not be completed. For bug fixes, include a regression check that fails before and passes after the fix, or explain why that proof is unavailable.
- Match further validation to the changed behaviour: include reproducible before/after evidence where applicable (screenshots/GIFs for UI changes), and state relevant untested platforms and outstanding manual acceptance checks. Documentation-only edits need relevant guidance/link checks; unrelated manual runtime checks are not required.

### Authoring GitHub content via `gh`

Write PR/issue bodies and comments to a file and pass it, rather than inline heredocs: `gh issue comment --body-file <path>`, `gh api -X PATCH … -F body=@<path>`. Inline `--body "$(cat <<EOF … EOF)"` mangles backtick escaping and renders as a literal `` \` `` in GitHub markdown. Same spirit for prose: write paragraphs as continuous lines and let GitHub wrap them — don't hard-wrap at 80 columns.

## Fork workflow (`AoXIUy/token-monitor`)

### Repository topology and version lines

- `origin` is [AoXIUy/token-monitor](https://github.com/AoXIUy/token-monitor) (the maintained fork); `upstream` is [Javis603/token-monitor](https://github.com/Javis603/token-monitor) (the official upstream). The companion read-only Android client lives in [AoXIUy/token-monitor-For-Android](https://github.com/AoXIUy/token-monitor-For-Android) (sibling workspace `../token-monitor-For-Android`).
- Treat `upstream` as a **one-way sync** into `origin/main`. Never push fork branches or tags to `upstream` or open upstream PRs for fork changes unless the user explicitly asks.
- Fork versions (`v0.91.0` onward) advance monotonically on `origin` for both fork features and upstream merges, so the fork version stays strictly higher than official upstream tags. Never reset `package.json` or `worker/package.json` back to an official upstream tag's version during a merge. Keep the original MIT copyright notice.

### Syncing official upstream releases

1. Verify `git remote -v`, branch (`main`), and a clean worktree, then fetch both remotes and tags:
   ```bash
   git fetch upstream --tags
   git fetch origin --tags
   ```
2. Inspect the delta between the last merged upstream tag and the target official tag (`git log --oneline <prev-upstream-tag>..<target-upstream-tag>`), reviewing changes to `src/shared/`, Hub/Worker wire contracts, collectors, providers, and renderer surfaces.
3. Merge the official tag onto `main` with a merge commit (preserving upstream commit history):
   ```bash
   git merge --no-ff <target-upstream-tag> -m "chore(upstream): merge official vX.Y.Z"
   ```
4. Protect fork-owned files and extensions during conflict resolution:
   - `package.json`: keep the current fork `version` (until the release commit), `repository`/`homepage`/`bugs` pointing to `AoXIUy/token-monitor`, fork scripts (`mcp`, `dist:linux:appimage`), fork `build.files` (`src/mcp/**/*`, `plugins/quota-alerts/evaluator.cjs`, `skills/openclaw-token-monitor/**/*`), `build.publish` (`AoXIUy/token-monitor`), `build.win.verifyUpdateCodeSignature: false` (no SignPath `publisherName`), `build.linux` (`deb` target + fork `maintainer`), and `build.appImage`.
   - `worker/package.json` and lockfiles: keep the fork version line; never hand-edit `worker/src/shared/`.
   - `src/shared/appUpdater.js`: preserve dynamic repo resolution from `package.json` → `repository.url`.
   - `.github/workflows/release.yml`, `.github/RELEASE_TEMPLATE.md`, the fork summary banner in `README.md`, and `AGENTS.md`: preserve fork release automation and guidance.
   - `scripts/hub-build-manifest.js`, `src/hub/server.js`, `src/electron/main.js`, `src/electron/preload.js`, `src/electron/renderer/*`, and `src/shared/providers/antigravity/*`: retain all fork subsystems (online conversations, live session rates, approval alerts, reports & MCP, AI analysis & OpenClaw bridge/provisioner, Antigravity Account Manager, `<root>/daemon/*.json` PID discovery, and `antigravity/sessionActivity.js`).
5. Run `npm run update:hub-build` once after all Hub/shared changes settle (updates `src/shared/hubBuildRegistry.json` and syncs `worker/src/shared/`). Confirm `npm run sync:worker && git diff --exit-code worker/src/shared` is clean.
6. Run `npm run verify` and `git diff --check`. When plugin or Electron renderer surfaces changed, also run `npm run verify:plugins` or targeted UI verification scripts as appropriate.

### Desktop fork versioning and GitHub release procedure

Read `docs/releasing-fork.md` before preparing or repairing a release. This fork publishes unsigned **Windows x64** (`Token-Monitor-Setup-<version>.exe` installer + `Token-Monitor-<version>.exe` portable), **Linux amd64** `.deb` (`Token-Monitor-<version>-amd64.deb`), and **Linux x86_64** `.AppImage` (`Token-Monitor-<version>-x86_64.AppImage`). It does not publish macOS artifacts or use SignPath/Apple signing secrets.

1. Fetch `origin/main` and tags, inspect published GitHub Releases on `AoXIUy/token-monitor`, and pick the next unused stable `major.minor.patch` version (patch for fixes, minor for compatible features or upstream syncs). Never move or delete an existing tag or overwrite a published release.
2. Land feature/upstream-sync commits first, then prepare a dedicated release commit (`chore(release): prepare <version>`) updating these files together:
   - `package.json` and `package-lock.json` (`version`)
   - `worker/package.json` and `worker/package-lock.json` (kept aligned with root `version`; product version is excluded from the Worker build hash)
   - `README.md` (update the fork banner link to the new release notes)
   - `docs/releases/<version>.md` (reviewed EN + ZH notes containing `<!-- app-update-notes:en:start/end -->` and `<!-- app-update-notes:zh:start/end -->` blocks and `AoXIUy/token-monitor` download links)
   - `.github/RELEASE_TEMPLATE.md` (update download links, `Full Changelog` range `v<prev>...v<version>`, and all 5 localized `app-update-notes` blocks so `appUpdater.test.js` and `releaseArtifactNames.test.js` pass)
3. Run `npm run verify` and `git diff --check`, commit, and push `main`.
4. Trigger **exactly one** release route: **Actions → Release → Run workflow → main** (`workflow_dispatch`), or create and push the matching `v<version>` tag at that exact commit. Manual releases must run from `main`.
5. Wait for `.github/workflows/release.yml` to finish. It verifies version/tag/notes and runs `npm run verify` on Node 22 & 24, bundles vendored `tokscale`, builds Windows x64, Linux `.deb`, and Linux `.AppImage` on separate runners (isolating Debian `package-type` from AppImage), merges `latest-linux.yml` via `scripts/merge-linux-updater-metadata.js`, checks unsigned Windows executables, Debian package identity, packaged `app-update.yml`/`app.asar` updater repo (`AoXIUy/token-monitor`), and artifact names, generates `SHA256SUMS` and `release-metadata.json`, uploads everything to a source-matched draft, verifies every asset size, and publishes as latest.
6. After publication, verify the public release page and assets: tag, `release-metadata.json` commit SHA, `SHA256SUMS`, `latest.yml` / `latest-linux.yml`, and downloadable installers. Static/CI checks do not replace real Windows/Linux desktop acceptance when UI/OS behavior changed.

### Coordinating with the Android client (`AoXIUy/token-monitor-For-Android`)

- Whenever this repo merges an official upstream tag or adds/modifies read-only Hub endpoints (`GET /api/stats`, `/api/subscriptions`, `/api/sync/settings/*`, `/api/session-conversations`, `/api/approval-alerts`, `/api/reports*`, `/api/antigravity-manager`) or shared calculation modules under `src/shared/`, assess the follow-up adaptation needed in `../token-monitor-For-Android`.
- Keep shared display/calculation modules consumed by Android (`clientCatalog.js`, `compactTokens.js`, `currency.js`, `deviceKind.js`, `limits/balanceDisplay.js`, `limits/windowLabels.js`, `limits/windowText.js`, `limits/historyModel.js`, `sessionActivityProviders.js`, `sessionLive.js`, `sessionRealtime.js`) free of Node/Electron built-ins and compatible with both browser globals and CommonJS.
- Preserve backward compatibility on Hub read endpoints and keep the Android boundary strictly read-only (`GET`-only, zero raw secrets or write mutations); optional fork endpoints must degrade cleanly (such as HTTP `404` on older Hubs or Cloudflare Worker).
