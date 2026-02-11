# opencode-plugin-cross-repo

An [OpenCode](https://opencode.ai) plugin that adds a cross-repository operations tool. Clone repos, grep across codebases, open PRs/MRs, and coordinate changes across multiple repositories in a single session.

## Why?

OpenCode's built-in tools operate on the current working directory. This plugin lets the agent reach into other repos:

- **Full codebase access** -- clone and grep across entire repositories instead of fetching files one at a time
- **Multi-repo operations** -- update workflows, READMEs, or dependencies across related repos and open PRs in one session
- **Platform support** -- works with GitHub and GitLab, including self-hosted instances (GitHub Enterprise, self-hosted GitLab)
- **Context-aware auth** -- automatically picks up `gh`/`glab` CLI tokens, env vars, or OIDC in GitHub Actions

## Install

### From npm (recommended)

Add the plugin to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-plugin-cross-repo"]
}
```

OpenCode installs npm plugins automatically at startup. See the [plugin docs](https://opencode.ai/docs/plugins/#from-npm).

### From a local file

Copy `src/index.ts` into your project as `.opencode/tool/cross-repo.ts` and add a `package.json` to `.opencode/` with the required dependency:

```json
{
  "dependencies": {
    "shescape": "^2.1.7"
  }
}
```

See the [local file docs](https://opencode.ai/docs/plugins/#from-local-files).

## Configuration

The plugin works out of the box with no configuration. For self-hosted instances or to override platform detection, use the plugin factory:

```typescript
// .opencode/plugins/cross-repo.ts
import { crossRepo } from "opencode-plugin-cross-repo"

export default crossRepo({
  platform: "gitlab",           // override auto-detection
  gitlabHost: "gitlab.corp.com" // self-hosted GitLab
})
```

Or as a standalone tool (no options):

```typescript
// .opencode/tool/cross-repo.ts
export { default } from "opencode-plugin-cross-repo"
```

## Platform detection

The plugin detects GitHub vs. GitLab from the current repo's git remote:

| Remote host | Detected platform | CLI |
|---|---|---|
| `github.com` | GitHub | `gh` |
| Hostname contains `github` | GitHub | `gh` |
| `gitlab.com` | GitLab | `glab` |
| Hostname contains `gitlab` | GitLab | `glab` |
| Other | GitHub (default) | `gh` |

Override with env vars:

```bash
CROSS_REPO_PLATFORM=gitlab     # force gitlab
GITLAB_HOST=gitlab.corp.com    # self-hosted GitLab
GITHUB_HOST=github.corp.com    # GitHub Enterprise
```

## Authentication

| Context | GitHub | GitLab |
|---|---|---|
| **CI** | OIDC token exchange (preferred) -> `GITHUB_TOKEN` | `GL_TOKEN` -> `GITLAB_TOKEN` -> `CI_JOB_TOKEN` |
| **Interactive** | `gh auth login` -> `GH_TOKEN`/`GITHUB_TOKEN` | `glab auth login` -> `GL_TOKEN`/`GITLAB_TOKEN` |
| **Non-interactive** | `gh` CLI token -> `GH_TOKEN`/`GITHUB_TOKEN` | `glab` CLI token -> `GL_TOKEN`/`GITLAB_TOKEN` |

## Operations

| Operation | Description |
|---|---|
| `clone` | Shallow clone to `{tmpdir}/{sessionID}/{owner}-{repo}` |
| `read` | Read a file (path relative to repo root) |
| `write` | Write a file (path relative to repo root) |
| `list` | List files (optionally under a subpath) |
| `branch` | Create and checkout a new branch |
| `commit` | Stage all changes and commit |
| `push` | Push current branch to remote |
| `pr` | Create a PR (GitHub) or MR (GitLab) |
| `exec` | Run a shell command in the repo directory |

## Example workflows

**Coordinated multi-repo update:**

```
User: Update the SDK and docs repos to use the new API endpoint

Agent:
1. clone owner=myorg repo=sdk
2. exec command="grep -r 'api.v1.example.com' --include='*.ts'"
3. write path=src/api.ts content="..."
4. branch name=update-api-endpoint
5. commit message="update API endpoint to v2"
6. push
7. pr title="update API endpoint" message="..."
8. clone owner=myorg repo=docs
9. write path=api/endpoints.md content="..."
10. branch name=update-api-docs
11. commit message="document new v2 endpoint"
12. push
13. pr title="document v2 endpoint" message="..."
```

**Cross-repo code search:**

```
User: Find all usages of the deprecated AuthService class across our repos

Agent:
1. clone owner=myorg repo=frontend
2. exec command="grep -rn 'AuthService' --include='*.ts' --include='*.tsx'"
3. clone owner=myorg repo=backend
4. exec command="grep -rn 'AuthService' --include='*.py'"
```

## Requirements

- [Bun](https://bun.sh) runtime (OpenCode uses Bun)
- `gh` CLI for GitHub operations
- `glab` CLI for GitLab operations

## Links

- [OpenCode plugins](https://opencode.ai/docs/plugins/)
- [OpenCode custom tools](https://opencode.ai/docs/custom-tools/)
- [gh CLI](https://cli.github.com/)
- [glab CLI](https://gitlab.com/gitlab-org/cli)

## License

Apache-2.0
