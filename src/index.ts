import { tool, type Plugin, type ToolContext } from "@opencode-ai/plugin";
import { Shescape } from "shescape";
import { tmpdir } from "os";
import { resolve } from "path";
import { realpathSync } from "fs";

// Platform type - detected from git remote of current working directory
export type Platform = "github" | "gitlab";

// Platform info detected from git remote
export interface PlatformInfo {
  platform: Platform;
  host: string; // e.g. "github.com", "gitlab.com", "gitlab.mycompany.com"
}

// Shescape instance for safe shell argument escaping
const shescape = new Shescape({ shell: "bash" });

function shellEscape(str: string): string {
  return shescape.quote(str);
}

// Strip embedded credentials from git error output to prevent token leakage
export function sanitizeGitOutput(output: string): string {
  return output.replace(/x-access-token:[^@]+@/g, "x-access-token:***@");
}

// Validates GitHub/GitLab owner/repo identifiers to prevent path traversal via malicious names.
// GitHub allows: alphanumeric, hyphens, underscores, and dots (with restrictions).
// We're slightly more permissive but block path separators and traversal sequences.
export function isValidRepoIdentifier(value: string): boolean {
  if (!value || value.length > 100) return false;
  // Block path traversal sequences and path separators
  if (value.includes("..") || value.includes("/") || value.includes("\\")) return false;
  // Allow typical identifier characters
  return /^[a-zA-Z0-9._-]+$/.test(value);
}

// Safely resolves a path within a base directory, preventing traversal attacks.
// Returns null if the resolved path would escape the base directory.
//
// Security notes:
// - For existing paths: returns realPath to prevent TOCTOU races
// - For non-existent paths: returns fullPath after validating all existing parents
//   (inherent TOCTOU window exists for new file writes — mitigated by parent validation)
// - Fails closed on unexpected errors (only ENOENT is treated as "path doesn't exist")
export function safeResolvePath(basePath: string, relativePath: string): string | null {
  const normalizedBase = resolve(basePath);
  const fullPath = resolve(normalizedBase, relativePath);

  // Check the string path first (handles .. sequences)
  if (!fullPath.startsWith(normalizedBase + "/") && fullPath !== normalizedBase) {
    return null;
  }

  // Resolve base directory once — it must exist and be accessible
  let realBase: string;
  try {
    realBase = realpathSync(normalizedBase);
  } catch {
    return null; // Base directory inaccessible
  }

  // For existing paths, resolve symlinks and return the real path
  try {
    const realPath = realpathSync(fullPath);
    if (!realPath.startsWith(realBase + "/") && realPath !== realBase) {
      return null;
    }
    return realPath;
  } catch (err: unknown) {
    // Only treat ENOENT as "path doesn't exist" - fail closed on other errors
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      return null;
    }

    // Path doesn't exist — check parent directories for escaping symlinks
    let checkPath = resolve(fullPath, "..");
    while (checkPath !== normalizedBase && checkPath.startsWith(normalizedBase)) {
      try {
        const realParent = realpathSync(checkPath);
        if (!realParent.startsWith(realBase + "/") && realParent !== realBase) {
          return null;
        }
        break; // Found a safe existing parent
      } catch (parentErr: unknown) {
        const parentCode = (parentErr as NodeJS.ErrnoException).code;
        if (parentCode !== "ENOENT") {
          return null;
        }
        checkPath = resolve(checkPath, "..");
      }
    }
    return fullPath; // Parents are safe, allow write to new path
  }
}

// State tracking for cloned repos across tool invocations
const clonedRepos = new Map<
  string,
  { path: string; token: string; defaultBranch: string; platform: PlatformInfo }
>();

// Get session-scoped clone path: {tmpdir}/{sessionId}/{owner}-{repo}
function getClonePath(sessionID: string, owner: string, repo: string): string {
  return `${tmpdir()}/${sessionID}/${owner}-${repo}`;
}

// Get the repo key for the clonedRepos map - includes sessionID for isolation
function getRepoKey(sessionID: string, owner: string, repo: string): string {
  return `${sessionID}/${owner}/${repo}`;
}

// Detect platform from git remote URL
// Supports: github.com, gitlab.com, self-hosted GitHub, and self-hosted GitLab instances
export function detectPlatformFromRemote(remoteUrl: string): PlatformInfo | null {
  if (!remoteUrl) return null;

  // Patterns for git remote URLs
  // SSH: git@github.com:owner/repo.git
  // HTTPS: https://github.com/owner/repo.git
  // HTTPS with token: https://x-access-token:TOKEN@github.com/owner/repo.git

  let host: string | null = null;

  // Try SSH format: git@host:path
  const sshMatch = remoteUrl.match(/^git@([^:]+):/);
  if (sshMatch) {
    host = sshMatch[1];
  }

  // Try HTTPS format: https://[user:pass@]host/path
  if (!host) {
    const httpsMatch = remoteUrl.match(/^https?:\/\/(?:[^@]+@)?([^/]+)\//);
    if (httpsMatch) {
      host = httpsMatch[1];
    }
  }

  if (!host) return null;

  // Normalize host (remove port if present for comparison)
  const hostWithoutPort = host.split(":")[0].toLowerCase();

  // GitHub.com detection
  if (hostWithoutPort === "github.com") {
    return { platform: "github", host };
  }

  // GitLab.com detection
  if (hostWithoutPort === "gitlab.com") {
    return { platform: "gitlab", host };
  }

  // Self-hosted GitHub detection (GitHub Enterprise)
  // - Contains "github" in hostname (e.g., github.mycompany.com)
  if (hostWithoutPort.includes("github")) {
    return { platform: "github", host };
  }

  // Self-hosted GitLab detection via common patterns
  // - Contains "gitlab" in hostname
  if (hostWithoutPort.includes("gitlab")) {
    return { platform: "gitlab", host };
  }

  // Default to GitHub for unknown hosts (backwards compatibility)
  // Users with self-hosted GitLab that doesn't contain "gitlab" in hostname
  // should set CROSS_REPO_PLATFORM=gitlab env var
  return { platform: "github", host };
}

// Cache for current repo platform detection
let cachedPlatform: PlatformInfo | null | undefined = undefined;

// Detect platform from current working directory's git remote
export async function detectCurrentRepoPlatform(): Promise<PlatformInfo | null> {
  if (cachedPlatform !== undefined) {
    return cachedPlatform;
  }

  // Check for explicit platform override
  const envPlatform = process.env.CROSS_REPO_PLATFORM?.toLowerCase();
  if (envPlatform === "gitlab") {
    cachedPlatform = { platform: "gitlab", host: process.env.GITLAB_HOST || "gitlab.com" };
    return cachedPlatform;
  }
  if (envPlatform === "github") {
    cachedPlatform = { platform: "github", host: process.env.GITHUB_HOST || "github.com" };
    return cachedPlatform;
  }

  // Try to detect from git remote
  const result = await run("git remote get-url origin 2>/dev/null", 5_000);
  if (result.success && result.stdout.trim()) {
    cachedPlatform = detectPlatformFromRemote(result.stdout.trim());
    return cachedPlatform;
  }

  // Default to GitHub
  cachedPlatform = { platform: "github", host: "github.com" };
  return cachedPlatform;
}

// Reset cached platform (for testing)
export function resetPlatformCache(): void {
  cachedPlatform = undefined;
}

// Execution context types
type ExecutionContextType = "github-actions" | "gitlab-ci" | "interactive" | "non-interactive";

interface ExecutionContext {
  type: ExecutionContextType;
  platform: PlatformInfo;
  hasOIDC: boolean;
  hasCli: boolean | null; // gh or glab CLI
  hasToken: boolean;
}

// Cache CLI availability
let ghCliAvailable: boolean | null = null;
let glabCliAvailable: boolean | null = null;

function isGitHubActions(): boolean {
  return process.env.GITHUB_ACTIONS === "true";
}

function isGitLabCI(): boolean {
  return process.env.GITLAB_CI === "true";
}

function hasGitHubOIDCPermissions(): boolean {
  return !!(process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
}

function isInteractive(): boolean {
  if (process.env.CI === "true") {
    return false;
  }
  return !!(process.stdin?.isTTY && process.stdout?.isTTY);
}

async function checkGhCliAvailable(): Promise<boolean> {
  if (ghCliAvailable !== null) {
    return ghCliAvailable;
  }
  const result = await run("gh auth status", 5_000);
  ghCliAvailable = result.success;
  return ghCliAvailable;
}

async function checkGlabCliAvailable(): Promise<boolean> {
  if (glabCliAvailable !== null) {
    return glabCliAvailable;
  }
  const result = await run("glab auth status", 5_000);
  glabCliAvailable = result.success;
  return glabCliAvailable;
}

async function detectExecutionContext(platform: PlatformInfo): Promise<ExecutionContext> {
  const env = process.env;

  // GitHub Actions
  if (isGitHubActions() && platform.platform === "github") {
    return {
      type: "github-actions",
      platform,
      hasOIDC: hasGitHubOIDCPermissions(),
      hasCli: false,
      hasToken: !!(env.GH_TOKEN || env.GITHUB_TOKEN),
    };
  }

  // GitLab CI
  if (isGitLabCI() && platform.platform === "gitlab") {
    return {
      type: "gitlab-ci",
      platform,
      hasOIDC: false, // GitLab uses CI_JOB_TOKEN instead
      hasCli: false,
      hasToken: !!(env.GL_TOKEN || env.GITLAB_TOKEN || env.CI_JOB_TOKEN),
    };
  }

  // Interactive terminal
  if (isInteractive()) {
    const hasCli =
      platform.platform === "github" ? await checkGhCliAvailable() : await checkGlabCliAvailable();
    return {
      type: "interactive",
      platform,
      hasOIDC: false,
      hasCli,
      hasToken:
        platform.platform === "github"
          ? !!(env.GH_TOKEN || env.GITHUB_TOKEN)
          : !!(env.GL_TOKEN || env.GITLAB_TOKEN),
    };
  }

  // Non-interactive
  const hasCli =
    platform.platform === "github" ? await checkGhCliAvailable() : await checkGlabCliAvailable();
  return {
    type: "non-interactive",
    platform,
    hasOIDC: false,
    hasCli,
    hasToken:
      platform.platform === "github"
        ? !!(env.GH_TOKEN || env.GITHUB_TOKEN)
        : !!(env.GL_TOKEN || env.GITLAB_TOKEN),
  };
}

async function getGhCliToken(): Promise<string | null> {
  const result = await run("gh auth token", 5_000);
  return result.success ? result.stdout.trim() : null;
}

async function getGlabCliToken(): Promise<string | null> {
  const result = await run("glab auth token", 5_000);
  return result.success ? result.stdout.trim() : null;
}

async function getTokenViaOIDC(
  owner: string,
  repo: string,
): Promise<{ token: string } | { error: string }> {
  try {
    const tokenUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const tokenRequestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

    const oidcUrl = `${tokenUrl}&audience=opencode-github-action`;
    const oidcResponse = await fetch(oidcUrl, {
      headers: { Authorization: `Bearer ${tokenRequestToken}` },
    });

    if (!oidcResponse.ok) {
      return { error: `Failed to get OIDC token: ${oidcResponse.statusText}` };
    }

    const { value: oidcToken } = (await oidcResponse.json()) as { value: string };

    const oidcBaseUrl = process.env.OIDC_BASE_URL;
    if (!oidcBaseUrl) {
      return {
        error:
          "OIDC_BASE_URL environment variable not set. Ensure the workflow passes oidc_base_url to the OpenCode action.",
      };
    }
    const exchangeResponse = await fetch(`${oidcBaseUrl}/exchange_github_app_token_for_repo`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${oidcToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ owner, repo }),
    });

    if (!exchangeResponse.ok) {
      const errorBody = await exchangeResponse.text();
      if (exchangeResponse.status === 401) {
        return {
          error: `Authentication failed for ${owner}/${repo}. Ensure the Bonk GitHub App is installed on the target repository.`,
        };
      }
      return { error: `Failed to get installation token: ${errorBody}` };
    }

    const { token } = (await exchangeResponse.json()) as { token: string };
    return { token };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `OIDC token exchange failed: ${message}` };
  }
}

async function getTargetRepoToken(
  owner: string,
  repo: string,
  platform: PlatformInfo,
): Promise<{ token: string } | { error: string }> {
  const context = await detectExecutionContext(platform);

  // GitHub Actions with OIDC
  if (context.type === "github-actions" && platform.platform === "github") {
    if (context.hasOIDC) {
      return await getTokenViaOIDC(owner, repo);
    }
    if (context.hasToken) {
      const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
      return { token: envToken! };
    }
    return {
      error:
        "In GitHub Actions but no authentication available. Add 'id-token: write' permission for OIDC, or set GITHUB_TOKEN.",
    };
  }

  // GitLab CI
  if (context.type === "gitlab-ci" && platform.platform === "gitlab") {
    if (context.hasToken) {
      const envToken = process.env.GL_TOKEN || process.env.GITLAB_TOKEN || process.env.CI_JOB_TOKEN;
      return { token: envToken! };
    }
    return {
      error:
        "In GitLab CI but no authentication available. Set GL_TOKEN, GITLAB_TOKEN, or use CI_JOB_TOKEN.",
    };
  }

  // Interactive and Non-interactive: Try CLI first, then env token
  if (platform.platform === "github") {
    if (context.hasCli) {
      const ghToken = await getGhCliToken();
      if (ghToken) {
        return { token: ghToken };
      }
    }
    if (context.hasToken) {
      const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
      return { token: envToken! };
    }
  } else {
    if (context.hasCli) {
      const glabToken = await getGlabCliToken();
      if (glabToken) {
        return { token: glabToken };
      }
    }
    if (context.hasToken) {
      const envToken = process.env.GL_TOKEN || process.env.GITLAB_TOKEN;
      return { token: envToken! };
    }
  }

  // Build context-specific error message
  const contextHints: Record<ExecutionContextType, Record<Platform, string>> = {
    "github-actions": {
      github: "Add 'id-token: write' permission or set GITHUB_TOKEN.",
      gitlab: "Set GL_TOKEN or GITLAB_TOKEN.",
    },
    "gitlab-ci": {
      github: "Set GH_TOKEN or GITHUB_TOKEN.",
      gitlab: "Set GL_TOKEN, GITLAB_TOKEN, or use CI_JOB_TOKEN.",
    },
    interactive: {
      github: "Run 'gh auth login' to authenticate, or set GH_TOKEN/GITHUB_TOKEN.",
      gitlab: "Run 'glab auth login' to authenticate, or set GL_TOKEN/GITLAB_TOKEN.",
    },
    "non-interactive": {
      github: "Set GH_TOKEN/GITHUB_TOKEN, or ensure 'gh auth login' was run.",
      gitlab: "Set GL_TOKEN/GITLAB_TOKEN, or ensure 'glab auth login' was run.",
    },
  };

  return {
    error: `No authentication available (context: ${context.type}, platform: ${platform.platform}). ${contextHints[context.type][platform.platform]}`,
  };
}

// Build clone URL based on platform
function buildCloneUrl(platform: PlatformInfo, token: string, owner: string, repo: string): string {
  return `https://x-access-token:${token}@${platform.host}/${owner}/${repo}.git`;
}

async function cloneRepo(
  sessionID: string,
  owner: string,
  repo: string,
  platform: PlatformInfo,
  branch?: string,
): Promise<{ success: boolean; path?: string; defaultBranch?: string; error?: string }> {
  // Validate owner and repo to prevent path traversal via malicious identifiers
  if (!isValidRepoIdentifier(owner)) {
    return { success: false, error: `Invalid owner name: ${owner}` };
  }
  if (!isValidRepoIdentifier(repo)) {
    return { success: false, error: `Invalid repo name: ${repo}` };
  }

  const repoKey = getRepoKey(sessionID, owner, repo);

  if (clonedRepos.has(repoKey)) {
    const state = clonedRepos.get(repoKey)!;
    return {
      success: true,
      path: state.path,
      defaultBranch: state.defaultBranch,
    };
  }

  const tokenResult = await getTargetRepoToken(owner, repo, platform);
  if ("error" in tokenResult) {
    return { success: false, error: tokenResult.error };
  }

  const clonePath = getClonePath(sessionID, owner, repo);
  await run(`mkdir -p ${shellEscape(`${tmpdir()}/${sessionID}`)}`);

  const cloneUrl = buildCloneUrl(platform, tokenResult.token, owner, repo);
  await run(`rm -rf ${shellEscape(clonePath)}`);

  const branchArg = branch ? `--branch ${shellEscape(branch)}` : "";
  const cloneResult = await run(
    `git clone --depth 1 ${branchArg} ${shellEscape(cloneUrl)} ${shellEscape(clonePath)}`,
  );

  if (!cloneResult.success) {
    return { success: false, error: `Clone failed: ${sanitizeGitOutput(cloneResult.stderr)}` };
  }

  const defaultBranchResult = await run(
    `git -C ${shellEscape(clonePath)} rev-parse --abbrev-ref HEAD`,
  );
  const defaultBranch = defaultBranchResult.stdout.trim() || "main";

  // Configure git user
  const botName = platform.platform === "github" ? "bonk[bot]" : "bonk-bot";
  const botEmail =
    platform.platform === "github"
      ? "bonk[bot]@users.noreply.github.com"
      : "bonk-bot@users.noreply.gitlab.com";

  await run(`git -C ${shellEscape(clonePath)} config user.email "${botEmail}"`);
  await run(`git -C ${shellEscape(clonePath)} config user.name "${botName}"`);

  clonedRepos.set(repoKey, {
    path: clonePath,
    token: tokenResult.token,
    defaultBranch,
    platform,
  });

  return { success: true, path: clonePath, defaultBranch };
}

async function createBranch(
  repoPath: string,
  branchName: string,
): Promise<{ success: boolean; branch?: string; error?: string }> {
  const result = await run(
    `git -C ${shellEscape(repoPath)} checkout -b ${shellEscape(branchName)}`,
  );

  if (!result.success) {
    const checkoutResult = await run(
      `git -C ${shellEscape(repoPath)} checkout ${shellEscape(branchName)}`,
    );
    if (!checkoutResult.success) {
      return { success: false, error: `Failed to create/checkout branch: ${sanitizeGitOutput(result.stderr)}` };
    }
  }

  return { success: true, branch: branchName };
}

async function commitChanges(
  repoPath: string,
  message: string,
): Promise<{ success: boolean; commit?: string; error?: string }> {
  const addResult = await run(`git -C ${shellEscape(repoPath)} add -A`);
  if (!addResult.success) {
    return { success: false, error: `Failed to stage changes: ${addResult.stderr}` };
  }

  const statusResult = await run(`git -C ${shellEscape(repoPath)} status --porcelain`);
  if (!statusResult.stdout.trim()) {
    return { success: false, error: "No changes to commit" };
  }

  const commitResult = await run(
    `git -C ${shellEscape(repoPath)} commit -m ${shellEscape(message)}`,
  );
  if (!commitResult.success) {
    return { success: false, error: `Failed to commit: ${commitResult.stderr}` };
  }

  const shaResult = await run(`git -C ${shellEscape(repoPath)} rev-parse HEAD`);
  const commit = shaResult.stdout.trim();

  return { success: true, commit };
}

async function pushBranch(
  repoPath: string,
  token: string,
): Promise<{ success: boolean; error?: string }> {
  const branchResult = await run(`git -C ${shellEscape(repoPath)} rev-parse --abbrev-ref HEAD`);
  const branch = branchResult.stdout.trim();

  const remoteResult = await run(`git -C ${shellEscape(repoPath)} remote get-url origin`);
  let remoteUrl = remoteResult.stdout.trim();

  if (!remoteUrl.includes("x-access-token")) {
    remoteUrl = remoteUrl.replace("https://", `https://x-access-token:${token}@`);
    await run(`git -C ${shellEscape(repoPath)} remote set-url origin ${shellEscape(remoteUrl)}`);
  }

  const pushResult = await run(
    `git -C ${shellEscape(repoPath)} push -u origin ${shellEscape(branch)}`,
  );

  if (!pushResult.success) {
    return { success: false, error: `Push failed: ${sanitizeGitOutput(pushResult.stderr)}` };
  }

  return { success: true };
}

async function createPR(
  repoPath: string,
  token: string,
  platform: PlatformInfo,
  title: string,
  body?: string,
  base?: string,
): Promise<{ success: boolean; prUrl?: string; prNumber?: number; error?: string }> {
  const branchResult = await run(`git -C ${shellEscape(repoPath)} rev-parse --abbrev-ref HEAD`);
  const headBranch = branchResult.stdout.trim();

  if (platform.platform === "github") {
    const bodyArg = body ? `--body ${shellEscape(body)}` : `--body ${shellEscape("")}`;
    const baseArg = base ? `--base ${shellEscape(base)}` : "";

    // For self-hosted GitHub (GitHub Enterprise), set GH_HOST
    const hostEnv = platform.host !== "github.com" ? `GH_HOST=${shellEscape(platform.host)} ` : "";

    const prResult = await run(
      `cd ${shellEscape(repoPath)} && ${hostEnv}GH_TOKEN=${shellEscape(token)} gh pr create --title ${shellEscape(title)} ${bodyArg} ${baseArg} --head ${shellEscape(headBranch)}`,
    );

    if (!prResult.success) {
      return { success: false, error: `PR creation failed: ${sanitizeGitOutput(prResult.stderr)}` };
    }

    const prUrl = prResult.stdout.trim();
    const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : undefined;

    return { success: true, prUrl, prNumber };
  } else {
    // GitLab MR creation via glab CLI
    const bodyArg = body ? `--description ${shellEscape(body)}` : "";
    const baseArg = base ? `--target-branch ${shellEscape(base)}` : "";

    // For self-hosted GitLab, we need to set the host
    const hostArg = platform.host !== "gitlab.com" ? `--repo ${shellEscape(platform.host)}` : "";

    const mrResult = await run(
      `cd ${shellEscape(repoPath)} && GITLAB_TOKEN=${shellEscape(token)} glab mr create --title ${shellEscape(title)} ${bodyArg} ${baseArg} --source-branch ${shellEscape(headBranch)} ${hostArg} --yes`,
    );

    if (!mrResult.success) {
      return { success: false, error: `MR creation failed: ${sanitizeGitOutput(mrResult.stderr)}` };
    }

    const mrUrl = mrResult.stdout.trim();
    // GitLab MR URL format: https://gitlab.com/owner/repo/-/merge_requests/123
    const mrNumberMatch = mrUrl.match(/\/merge_requests\/(\d+)/);
    const prNumber = mrNumberMatch ? parseInt(mrNumberMatch[1], 10) : undefined;

    return { success: true, prUrl: mrUrl, prNumber };
  }
}

async function readFile(
  repoPath: string,
  filePath: string,
): Promise<{ success: boolean; content?: string; error?: string }> {
  // Safely resolve the path, preventing traversal attacks
  const fullPath = safeResolvePath(repoPath, filePath);
  if (!fullPath) {
    return { success: false, error: "Invalid path: path traversal detected" };
  }

  const result = await run(`cat ${shellEscape(fullPath)}`);
  if (!result.success) {
    return { success: false, error: `Failed to read file: ${result.stderr}` };
  }

  return { success: true, content: result.stdout };
}

async function writeFile(
  repoPath: string,
  filePath: string,
  content: string,
): Promise<{ success: boolean; error?: string }> {
  // Safely resolve the path, preventing traversal attacks
  const fullPath = safeResolvePath(repoPath, filePath);
  if (!fullPath) {
    return { success: false, error: "Invalid path: path traversal detected" };
  }

  // Create parent directories if needed
  const dirPath = fullPath.substring(0, fullPath.lastIndexOf("/"));
  await run(`mkdir -p ${shellEscape(dirPath)}`);

  // Write content using base64 encoding to safely pass arbitrary content through the shell
  const base64Content = Buffer.from(content).toString("base64");
  const result = await run(
    `echo ${shellEscape(base64Content)} | base64 -d > ${shellEscape(fullPath)}`,
  );

  if (!result.success) {
    return { success: false, error: `Failed to write file: ${result.stderr}` };
  }

  return { success: true };
}

async function listFiles(
  repoPath: string,
  subPath?: string,
): Promise<{ success: boolean; files?: string[]; error?: string }> {
  // Safely resolve the path if subPath provided, preventing traversal attacks
  const targetPath = subPath ? safeResolvePath(repoPath, subPath) : resolve(repoPath);
  if (!targetPath) {
    return { success: false, error: "Invalid path: path traversal detected" };
  }

  // List files excluding .git directory
  const result = await run(`find ${shellEscape(targetPath)} -type f ! -path '*/\\.git/*'`);
  if (!result.success) {
    return { success: false, error: `Failed to list files: ${result.stderr}` };
  }

  // Strip the repo path prefix in JS to avoid sed pattern injection issues
  const prefix = resolve(repoPath) + "/";
  const files = result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((f) => (f.startsWith(prefix) ? f.slice(prefix.length) : f));

  return { success: true, files };
}

async function execCommand(
  repoPath: string,
  command: string,
): Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }> {
  // Audit log: exec is a powerful operation - log for visibility
  console.log(
    JSON.stringify({
      event: "cross_repo_exec",
      repo_path: repoPath,
      command_preview: command.slice(0, 100) + (command.length > 100 ? "..." : ""),
    }),
  );

  const result = await run(`cd ${shellEscape(repoPath)} && ${command}`);

  return {
    success: result.success,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.success ? undefined : result.stderr,
  };
}

async function run(
  command: string,
  timeoutMs: number = 60_000,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn(["bash", "-c", command], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      timeout: timeoutMs,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_SSH_COMMAND: "ssh -oBatchMode=yes -oStrictHostKeyChecking=accept-new",
        GIT_PAGER: "cat",
        PAGER: "cat",
        DEBIAN_FRONTEND: "noninteractive",
        NO_COLOR: "1",
        TERM: "dumb",
      },
    });

    const exited = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    return {
      success: exited === 0,
      stdout,
      stderr,
    };
  } catch (error) {
    return {
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

// The cross-repo tool definition
export const crossRepoTool = tool({
  description: `Operate on GitHub or GitLab repositories other than the current working repository.

Use this tool when you need to:
- Clone and make changes to a different repository (e.g. "also update the docs repo")
- Create coordinated changes across multiple repos (e.g. "update the SDK and the examples repo")
- Open PRs/MRs in related repositories based on changes in the current repo
- Summarize changes from the current repo and apply related changes to another repo
- Grep across entire repositories for symbols, config, and patterns

**Platform Detection**: The tool auto-detects whether to use GitHub or GitLab based on the current repo's git remote:
- github.com -> GitHub (uses gh CLI)
- Hosts containing "github" (e.g., github.mycompany.com) -> GitHub (uses gh CLI)
- gitlab.com or hosts containing "gitlab" -> GitLab (uses glab CLI)
- Set CROSS_REPO_PLATFORM=github|gitlab to override detection

The tool handles authentication automatically based on execution context:

**GitHub Actions**: Uses OIDC token exchange (requires id-token: write permission), falls back to GITHUB_TOKEN env var.
**GitLab CI**: Uses GL_TOKEN, GITLAB_TOKEN, or CI_JOB_TOKEN env var.
**Interactive** (terminal): Uses gh/glab CLI (supports OAuth flow), falls back to GH_TOKEN/GITHUB_TOKEN or GL_TOKEN/GITLAB_TOKEN.
**Non-interactive** (CI, sandbox, scripts): Uses gh/glab CLI if authenticated, falls back to env tokens.

Supported operations:
- clone: Shallow clone a repo to {tmpdir}/{sessionID}/{owner}-{repo}. Returns the local path.
- read: Read a file from the cloned repo (path relative to repo root).
- write: Write content to a file in the cloned repo (path relative to repo root).
- list: List files in the cloned repo (optionally under a subpath).
- branch: Create and checkout a new branch from the default branch.
- commit: Stage all changes and commit with a message.
- push: Push the current branch to remote.
- pr: Create a pull request (GitHub) or merge request (GitLab). IMPORTANT: Always include a meaningful body/description via the 'message' parameter.
- exec: Run arbitrary shell commands in the cloned repo directory (useful for grep, find, etc.).

Typical workflow:
1. clone the target repo
2. Use read/write/list/exec operations to view and modify files
3. branch to create a feature branch
4. commit your changes
5. push the branch
6. pr to create a pull request/merge request with a descriptive body`,

  args: {
    owner: tool.schema.string().describe("Repository owner (org or user) or GitLab namespace"),
    repo: tool.schema.string().describe("Repository name"),
    operation: tool.schema
      .enum(["clone", "branch", "commit", "push", "pr", "exec", "read", "write", "list"])
      .describe("Operation to perform on the target repository"),
    branch: tool.schema
      .string()
      .optional()
      .describe("Branch name for 'branch' operation, or specific branch to clone for 'clone'"),
    message: tool.schema
      .string()
      .optional()
      .describe(
        "Commit message for 'commit' operation. For 'pr' operation, this is the PR/MR body/description.",
      ),
    title: tool.schema.string().optional().describe("PR/MR title for 'pr' operation"),
    base: tool.schema
      .string()
      .optional()
      .describe("Base/target branch for PR/MR (defaults to repo's default branch)"),
    command: tool.schema
      .string()
      .optional()
      .describe("Shell command to execute for 'exec' operation"),
    path: tool.schema
      .string()
      .optional()
      .describe("File path for 'read', 'write', or 'list' operations (relative to repo root)"),
    content: tool.schema.string().optional().describe("File content for 'write' operation"),
  },

  async execute(args, ctx: ToolContext) {
    // Detect platform from current repo
    const platform = await detectCurrentRepoPlatform();
    if (!platform) {
      return JSON.stringify({
        success: false,
        error: "Could not detect platform. Set CROSS_REPO_PLATFORM=github|gitlab.",
      });
    }

    const repoKey = getRepoKey(ctx.sessionID, args.owner, args.repo);
    const stringify = (result: object) => JSON.stringify(result);

    try {
      switch (args.operation) {
        case "clone":
          return stringify(
            await cloneRepo(ctx.sessionID, args.owner, args.repo, platform, args.branch),
          );

        case "branch": {
          const state = clonedRepos.get(repoKey);
          if (!state) {
            return stringify({
              success: false,
              error: `Repository ${repoKey} not cloned. Run clone operation first.`,
            });
          }
          if (!args.branch) {
            return stringify({
              success: false,
              error: "Branch name required for 'branch' operation",
            });
          }
          return stringify(await createBranch(state.path, args.branch));
        }

        case "commit": {
          const state = clonedRepos.get(repoKey);
          if (!state) {
            return stringify({
              success: false,
              error: `Repository ${repoKey} not cloned. Run clone operation first.`,
            });
          }
          if (!args.message) {
            return stringify({
              success: false,
              error: "Commit message required for 'commit' operation",
            });
          }
          return stringify(await commitChanges(state.path, args.message));
        }

        case "push": {
          const state = clonedRepos.get(repoKey);
          if (!state) {
            return stringify({
              success: false,
              error: `Repository ${repoKey} not cloned. Run clone operation first.`,
            });
          }
          return stringify(await pushBranch(state.path, state.token));
        }

        case "pr": {
          const state = clonedRepos.get(repoKey);
          if (!state) {
            return stringify({
              success: false,
              error: `Repository ${repoKey} not cloned. Run clone operation first.`,
            });
          }
          if (!args.title) {
            return stringify({ success: false, error: "PR/MR title required for 'pr' operation" });
          }
          return stringify(
            await createPR(
              state.path,
              state.token,
              state.platform,
              args.title,
              args.message,
              args.base || state.defaultBranch,
            ),
          );
        }

        case "exec": {
          const state = clonedRepos.get(repoKey);
          if (!state) {
            return stringify({
              success: false,
              error: `Repository ${repoKey} not cloned. Run clone operation first.`,
            });
          }
          if (!args.command) {
            return stringify({ success: false, error: "Command required for 'exec' operation" });
          }
          return stringify(await execCommand(state.path, args.command));
        }

        case "read": {
          const state = clonedRepos.get(repoKey);
          if (!state) {
            return stringify({
              success: false,
              error: `Repository ${repoKey} not cloned. Run clone operation first.`,
            });
          }
          if (!args.path) {
            return stringify({ success: false, error: "Path required for 'read' operation" });
          }
          return stringify(await readFile(state.path, args.path));
        }

        case "write": {
          const state = clonedRepos.get(repoKey);
          if (!state) {
            return stringify({
              success: false,
              error: `Repository ${repoKey} not cloned. Run clone operation first.`,
            });
          }
          if (!args.path) {
            return stringify({ success: false, error: "Path required for 'write' operation" });
          }
          if (args.content === undefined) {
            return stringify({ success: false, error: "Content required for 'write' operation" });
          }
          return stringify(await writeFile(state.path, args.path, args.content));
        }

        case "list": {
          const state = clonedRepos.get(repoKey);
          if (!state) {
            return stringify({
              success: false,
              error: `Repository ${repoKey} not cloned. Run clone operation first.`,
            });
          }
          return stringify(await listFiles(state.path, args.path));
        }

        default:
          return stringify({ success: false, error: `Unknown operation: ${args.operation}` });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`cross-repo tool error [${args.operation}]:`, message);
      return stringify({ success: false, error: `Unexpected error: ${message}` });
    }
  },
});

// Plugin factory for advanced configuration (use in .opencode/plugins/ files)
export interface CrossRepoOptions {
  // Override platform detection
  platform?: Platform;
  // Custom GitLab host for self-hosted instances
  gitlabHost?: string;
  // Custom GitHub host for self-hosted instances (GitHub Enterprise)
  githubHost?: string;
}

export const crossRepo = (options: CrossRepoOptions = {}): Plugin => {
  return async () => {
    // Apply options to environment for detection
    if (options.platform) {
      process.env.CROSS_REPO_PLATFORM = options.platform;
    }
    if (options.gitlabHost) {
      process.env.GITLAB_HOST = options.gitlabHost;
    }
    if (options.githubHost) {
      process.env.GITHUB_HOST = options.githubHost;
    }

    return {
      tool: {
        "cross-repo": crossRepoTool,
      },
    };
  };
};

// Direct plugin export for npm plugin loading via opencode.json "plugin" array.
// OpenCode discovers named exports and calls them as Plugin functions.
export const CrossRepoPlugin: Plugin = async () => {
  return {
    tool: {
      "cross-repo": crossRepoTool,
    },
  };
};

// Default export for .opencode/tool/ usage
export default crossRepoTool;
