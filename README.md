# opencode-plugin-cross-repo

OpenCode plugin for cross-repository operations with GitHub and GitLab support.

Make changes across multiple repos in a single session - clone, edit, commit, push, and open PRs/MRs from OpenCode.

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

| Remote Host | Platform |
|-------------|----------|
| `github.com` | GitHub |
| `gitlab.com` | GitLab |
| Hostname contains `gitlab` | GitLab |
| Other | GitHub (default) |

Override with environment variable:

```bash
CROSS_REPO_PLATFORM=gitlab  # or github
GITLAB_HOST=gitlab.corp.com # for self-hosted
```

## Authentication

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

## Example Workflow

```
User: Update the SDK and docs repos to use the new API endpoint

OpenCode:
1. clone owner=myorg repo=sdk
2. write path=src/api.ts content="..."
3. branch name=update-api-endpoint
4. commit message="Update API endpoint to v2"
5. push
6. pr title="Update API endpoint" message="## Summary\n- Updated endpoint to v2..."

7. clone owner=myorg repo=docs
8. write path=api/endpoints.md content="..."
9. branch name=update-api-docs
10. commit message="Document new v2 endpoint"
11. push
12. pr title="Document v2 endpoint" message="## Summary\n- Added v2 endpoint docs..."
```

## Requirements

- [Bun](https://bun.sh) runtime (OpenCode runs on Bun)
- `gh` CLI for GitHub operations
- `glab` CLI for GitLab operations

## Documentation

- [OpenCode Plugins](https://opencode.ai/docs/plugins/)
- [OpenCode Custom Tools](https://opencode.ai/docs/custom-tools/)
- [gh CLI](https://cli.github.com/)
- [glab CLI](https://gitlab.com/gitlab-org/cli)

## License

Apache-2.0
