# opencode-plugin-cross-repo

OpenCode plugin for cross-repository operations with GitHub and GitLab support.

## Why Cross-Repo?

A cross-repo tool offers significant advantages over simpler alternatives like `webfetch`:

- **Full codebase access** - Grep across the entire repository for symbols, config files, and patterns. Find where functions are used, trace dependencies, and understand code structure.
- **Multi-repo operations** - Operate on multiple repositories at once. Open PRs to update workflows, READMEs, or upgrade dependencies across related repos in a single session.
- **Platform support** - Works with both GitHub and GitLab for PRs/MRs, and should work with vanilla git remotes when running locally.
- **GitHub CLI integration** - Operates within OpenCode's [GitHub CLI](https://opencode.ai/docs/github/) to perform cross-repo tasks when the orchestrating app or `GITHUB_TOKEN` has appropriate permissions.

## Installation

```bash
bun add opencode-plugin-cross-repo
```

## Usage

### As a Plugin

Create `.opencode/plugin/cross-repo.ts`:

```typescript
import { crossRepo } from "opencode-plugin-cross-repo"

export default crossRepo()
```

### As a Tool

Create `.opencode/tool/cross-repo.ts`:

```typescript
export { default } from "opencode-plugin-cross-repo"
```

### With Options

```typescript
import { crossRepo } from "opencode-plugin-cross-repo"

export default crossRepo({
  platform: "gitlab",           // Override auto-detection
  gitlabHost: "gitlab.corp.com" // Self-hosted GitLab
})
```

## Platform Detection

The plugin auto-detects the platform from your current repo's git remote:

| Remote Host | Platform | CLI Used |
|-------------|----------|----------|
| `github.com` | GitHub | `gh` |
| Host contains `github` (e.g., `github.mycompany.com`) | GitHub | `gh` |
| `gitlab.com` | GitLab | `glab` |
| Host contains `gitlab` (e.g., `gitlab.mycompany.com`) | GitLab | `glab` |
| Other hosts | GitHub (default) | `gh` |

Override with environment variable:

```bash
CROSS_REPO_PLATFORM=gitlab  # or github
GITLAB_HOST=gitlab.corp.com # for self-hosted GitLab
GITHUB_HOST=github.corp.com # for self-hosted GitHub (GitHub Enterprise)
```

## Authentication

### Execution Scenarios & Provider Support

| Scenario | GitHub | GitLab |
|----------|--------|--------|
| **CI Environment** | GitHub Actions: OIDC token exchange (preferred) -> `GITHUB_TOKEN` env var | GitLab CI: `GL_TOKEN` -> `GITLAB_TOKEN` -> `CI_JOB_TOKEN` |
| **Interactive** (terminal with TTY) | `gh auth login` OAuth -> `GH_TOKEN`/`GITHUB_TOKEN` env var | `glab auth login` OAuth -> `GL_TOKEN`/`GITLAB_TOKEN` env var |
| **Non-interactive** (sandboxes, scripts, piped contexts) | `gh` CLI if authenticated -> `GH_TOKEN`/`GITHUB_TOKEN` env var | `glab` CLI if authenticated -> `GL_TOKEN`/`GITLAB_TOKEN` env var |

### GitHub

| Context | Auth Method |
|---------|-------------|
| GitHub Actions | OIDC (requires `id-token: write`), falls back to `GITHUB_TOKEN` |
| Interactive | `gh auth login`, falls back to `GH_TOKEN` / `GITHUB_TOKEN` |
| Non-interactive | `gh` CLI token, falls back to `GH_TOKEN` / `GITHUB_TOKEN` |

### GitLab

| Context | Auth Method |
|---------|-------------|
| GitLab CI | `GL_TOKEN` / `GITLAB_TOKEN` / `CI_JOB_TOKEN` |
| Interactive | `glab auth login`, falls back to `GL_TOKEN` / `GITLAB_TOKEN` |
| Non-interactive | `glab` CLI token, falls back to `GL_TOKEN` / `GITLAB_TOKEN` |

## Operations

| Operation | Description |
|-----------|-------------|
| `clone` | Shallow clone to `{tmpdir}/{sessionID}/{owner}-{repo}` |
| `read` | Read file from cloned repo |
| `write` | Write file to cloned repo |
| `list` | List files in cloned repo |
| `branch` | Create and checkout new branch |
| `commit` | Stage all changes and commit |
| `push` | Push current branch to remote |
| `pr` | Create PR (GitHub) or MR (GitLab) |
| `exec` | Run shell command in repo directory |

### Operation Mapping by Platform

| Operation | GitHub | GitLab |
|-----------|--------|--------|
| `pr` | `gh pr create` (Pull Request) | `glab mr create` (Merge Request) |
| Git user | `bonk[bot]@users.noreply.github.com` | `bonk-bot@users.noreply.gitlab.com` |

## Example Workflows

### Coordinated Multi-Repo Updates

```
User: Update the SDK and docs repos to use the new API endpoint

OpenCode:
1. clone owner=myorg repo=sdk
2. exec command="grep -r 'api.v1.example.com' --include='*.ts'"
3. write path=src/api.ts content="..."
4. branch name=update-api-endpoint
5. commit message="Update API endpoint to v2"
6. push
7. pr title="Update API endpoint" message="## Summary\n- Updated endpoint to v2..."

8. clone owner=myorg repo=docs
9. write path=api/endpoints.md content="..."
10. branch name=update-api-docs
11. commit message="Document new v2 endpoint"
12. push
13. pr title="Document v2 endpoint" message="## Summary\n- Added v2 endpoint docs..."
```

### Cross-Repo Code Analysis

```
User: Find all usages of the deprecated AuthService class across our repos

OpenCode:
1. clone owner=myorg repo=frontend
2. exec command="grep -rn 'AuthService' --include='*.ts' --include='*.tsx'"
3. clone owner=myorg repo=backend
4. exec command="grep -rn 'AuthService' --include='*.py'"
5. clone owner=myorg repo=mobile
6. exec command="grep -rn 'AuthService' --include='*.kt' --include='*.swift'"
```

## Requirements

- [Bun](https://bun.sh) runtime (OpenCode runs on Bun)
- `gh` CLI for GitHub operations
- `glab` CLI for GitLab operations

## Documentation

- [OpenCode Plugins](https://opencode.ai/docs/plugins/)
- [OpenCode Custom Tools](https://opencode.ai/docs/custom-tools/)
- [OpenCode GitHub CLI](https://opencode.ai/docs/github/)
- [gh CLI](https://cli.github.com/)
- [glab CLI](https://gitlab.com/gitlab-org/cli)

## License

Apache-2.0
