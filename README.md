# opencode-cross-repo

An [OpenCode](https://opencode.ai) plugin that adds a cross-repository operations tool. Clone repos, grep across codebases, open PRs/MRs, and coordinate changes across multiple repositories in a single session.

## Install

Add the plugin to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-cross-repo"]
}
```

OpenCode installs npm plugins automatically at startup. See the [plugin docs](https://opencode.ai/docs/plugins/).

You can also install from a local file — copy `src/index.ts` to `.opencode/tool/cross-repo.ts` with a `shescape` dependency. See the [local file docs](https://opencode.ai/docs/plugins/#from-local-files).

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

## Operations

| Operation | Description |
|---|---|
| `clone` | Shallow clone to a session-scoped temp directory |
| `read` | Read a file (path relative to repo root) |
| `write` | Write a file (path relative to repo root) |
| `list` | List files (optionally under a subpath) |
| `branch` | Create and checkout a new branch |
| `commit` | Stage all changes and commit |
| `push` | Push current branch to remote |
| `pr` | Create a PR (GitHub) or MR (GitLab) |
| `exec` | Run a shell command in the repo directory |

## Authentication

Works automatically in most cases:

- **Interactive** — picks up `gh auth login` / `glab auth login` tokens, falls back to `GH_TOKEN`/`GITHUB_TOKEN` or `GL_TOKEN`/`GITLAB_TOKEN` env vars
- **CI** — uses OIDC token exchange in GitHub Actions (preferred), or `GITHUB_TOKEN` / `GL_TOKEN` / `GITLAB_TOKEN` / `CI_JOB_TOKEN` env vars

## Platform detection and configuration

The plugin detects GitHub vs. GitLab from the current repo's git remote. Hostnames containing `github` use `gh`, hostnames containing `gitlab` use `glab`, and unknown hosts default to GitHub.

Override with env vars when auto-detection doesn't work:

```bash
CROSS_REPO_PLATFORM=gitlab     # force gitlab
GITLAB_HOST=gitlab.corp.com    # self-hosted GitLab
GITHUB_HOST=github.corp.com    # GitHub Enterprise
```

For self-hosted instances, use the plugin factory:

```typescript
// .opencode/plugins/cross-repo.ts
import { crossRepo } from "opencode-cross-repo/advanced"

export default crossRepo({
  platform: "gitlab",
  gitlabHost: "gitlab.corp.com"
})
```

## Requirements

- [Bun](https://bun.sh) runtime (OpenCode uses Bun)
- `gh` CLI for GitHub, `glab` CLI for GitLab

## Links

- [OpenCode plugins](https://opencode.ai/docs/plugins/) · [Custom tools](https://opencode.ai/docs/custom-tools/)
- [gh CLI](https://cli.github.com/) · [glab CLI](https://gitlab.com/gitlab-org/cli)

## License

Apache-2.0
