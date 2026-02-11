import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  crossRepoTool,
  crossRepo,
  resetPlatformCache,
  isValidRepoIdentifier,
  safeResolvePath,
  sanitizeGitOutput,
} from "../src/index";
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Mock ToolContext for testing
const mockToolContext = {
  sessionID: "test-session-123",
  messageID: "test-message-456",
  agent: "test-agent",
  directory: "/tmp/test",
  worktree: "/tmp/test",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
};

describe("crossRepoTool", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetPlatformCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetPlatformCache();
  });

  describe("tool metadata", () => {
    it("has required tool properties", () => {
      expect(crossRepoTool.description).toContain("GitHub");
      expect(crossRepoTool.description).toContain("GitLab");
      expect(crossRepoTool.args).toBeDefined();
      expect(typeof crossRepoTool.execute).toBe("function");
    });

    it("describes supported operations", () => {
      expect(crossRepoTool.description).toContain("clone");
      expect(crossRepoTool.description).toContain("branch");
      expect(crossRepoTool.description).toContain("commit");
      expect(crossRepoTool.description).toContain("push");
      expect(crossRepoTool.description).toContain("pr");
      expect(crossRepoTool.description).toContain("merge request");
    });

    it("documents platform detection", () => {
      expect(crossRepoTool.description).toContain("CROSS_REPO_PLATFORM");
      expect(crossRepoTool.description).toContain("glab CLI");
      expect(crossRepoTool.description).toContain("gh CLI");
    });

    it("documents self-hosted GitHub support", () => {
      expect(crossRepoTool.description).toContain('containing "github"');
    });

    it("documents exec operation for grep/find", () => {
      expect(crossRepoTool.description).toContain("exec");
      expect(crossRepoTool.description).toContain("grep");
    });
  });

  describe("execute() error handling", () => {
    it("returns error JSON when repo not cloned (branch operation)", async () => {
      // Force GitHub platform
      process.env.CROSS_REPO_PLATFORM = "github";
      resetPlatformCache();

      const result = await crossRepoTool.execute(
        {
          owner: "test",
          repo: "not-cloned-repo",
          operation: "branch",
          branch: "test-branch",
        },
        mockToolContext,
      );

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("not cloned");
    });

    it("returns error JSON for unknown operation", async () => {
      process.env.CROSS_REPO_PLATFORM = "github";
      resetPlatformCache();

      const result = await crossRepoTool.execute(
        {
          owner: "test",
          repo: "test-repo",
          operation: "invalid-op" as any,
        },
        mockToolContext,
      );

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("Unknown operation");
    });

    it("never throws - always returns valid JSON", async () => {
      process.env.CROSS_REPO_PLATFORM = "github";
      resetPlatformCache();

      const badInputs = [
        { owner: "", repo: "", operation: "clone" },
        { owner: "x", repo: "y", operation: "read" },
        { owner: "x", repo: "y", operation: "write" },
        { owner: "x", repo: "y", operation: "commit" },
      ];

      for (const input of badInputs) {
        const result = await crossRepoTool.execute(input as any, mockToolContext);
        expect(() => JSON.parse(result)).not.toThrow();
        const parsed = JSON.parse(result);
        expect(parsed.success).toBe(false);
      }
    });

    it("returns error when required args missing for operations", async () => {
      process.env.CROSS_REPO_PLATFORM = "github";
      resetPlatformCache();

      const missingArgCases = [
        { owner: "x", repo: "y", operation: "exec" },
        { owner: "x", repo: "y", operation: "pr" },
      ];

      for (const input of missingArgCases) {
        const result = await crossRepoTool.execute(input as any, mockToolContext);
        const parsed = JSON.parse(result);
        expect(parsed.success).toBe(false);
        expect(parsed.error).toBeDefined();
      }
    });
  });
});

describe("crossRepo plugin factory", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    resetPlatformCache();
  });

  it("exports a plugin factory function", () => {
    expect(typeof crossRepo).toBe("function");
  });

  it("returns plugin hooks with tool definition", async () => {
    const plugin = crossRepo();
    const hooks = await plugin({} as any);
    expect(hooks.tool).toBeDefined();
    expect(hooks.tool!["cross-repo"]).toBeDefined();
  });

  it("accepts platform override option", async () => {
    const plugin = crossRepo({ platform: "gitlab" });
    const hooks = await plugin({} as any);
    expect(hooks.tool!["cross-repo"]).toBeDefined();
    expect(process.env.CROSS_REPO_PLATFORM).toBe("gitlab");
  });

  it("accepts gitlabHost option", async () => {
    const plugin = crossRepo({ gitlabHost: "gitlab.mycompany.com" });
    const hooks = await plugin({} as any);
    expect(hooks.tool!["cross-repo"]).toBeDefined();
    expect(process.env.GITLAB_HOST).toBe("gitlab.mycompany.com");
  });

  it("accepts githubHost option for GitHub Enterprise", async () => {
    const plugin = crossRepo({ githubHost: "github.mycompany.com" });
    const hooks = await plugin({} as any);
    expect(hooks.tool!["cross-repo"]).toBeDefined();
    expect(process.env.GITHUB_HOST).toBe("github.mycompany.com");
  });

  it("accepts combined platform and host options", async () => {
    const plugin = crossRepo({ platform: "github", githubHost: "github.enterprise.acme.com" });
    const hooks = await plugin({} as any);
    expect(hooks.tool!["cross-repo"]).toBeDefined();
    expect(process.env.CROSS_REPO_PLATFORM).toBe("github");
    expect(process.env.GITHUB_HOST).toBe("github.enterprise.acme.com");
  });
});

describe("isValidRepoIdentifier", () => {
  it("accepts valid GitHub identifiers", () => {
    expect(isValidRepoIdentifier("owner")).toBe(true);
    expect(isValidRepoIdentifier("my-org")).toBe(true);
    expect(isValidRepoIdentifier("my_repo")).toBe(true);
    expect(isValidRepoIdentifier("repo.name")).toBe(true);
    expect(isValidRepoIdentifier("Owner123")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidRepoIdentifier("")).toBe(false);
  });

  it("rejects strings over 100 characters", () => {
    expect(isValidRepoIdentifier("a".repeat(101))).toBe(false);
    expect(isValidRepoIdentifier("a".repeat(100))).toBe(true);
  });

  it("rejects path traversal sequences", () => {
    expect(isValidRepoIdentifier("..")).toBe(false);
    expect(isValidRepoIdentifier("../etc")).toBe(false);
    expect(isValidRepoIdentifier("foo..bar")).toBe(false);
  });

  it("rejects path separators", () => {
    expect(isValidRepoIdentifier("owner/repo")).toBe(false);
    expect(isValidRepoIdentifier("owner\\repo")).toBe(false);
  });

  it("rejects special characters", () => {
    expect(isValidRepoIdentifier("repo name")).toBe(false);
    expect(isValidRepoIdentifier("repo;rm -rf")).toBe(false);
    expect(isValidRepoIdentifier("$(whoami)")).toBe(false);
  });
});

describe("safeResolvePath", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "safe-resolve-test-"));
    // Create test file structure
    writeFileSync(join(testDir, "file.txt"), "test content");
    mkdirSync(join(testDir, "subdir"));
    writeFileSync(join(testDir, "subdir", "nested.txt"), "nested content");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("resolves valid paths within base directory", () => {
    // safeResolvePath returns realpathSync'd paths, so on macOS /var -> /private/var
    const realTestDir = realpathSync(testDir);
    expect(safeResolvePath(testDir, "file.txt")).toBe(join(realTestDir, "file.txt"));
    expect(safeResolvePath(testDir, "subdir/nested.txt")).toBe(
      join(realTestDir, "subdir", "nested.txt"),
    );
  });

  it("returns null for path traversal via ..", () => {
    expect(safeResolvePath(testDir, "../../../etc/passwd")).toBeNull();
    expect(safeResolvePath(testDir, "subdir/../../outside")).toBeNull();
  });

  it("returns null for absolute paths outside base", () => {
    expect(safeResolvePath(testDir, "/etc/passwd")).toBeNull();
  });

  it("allows new file paths when parents are safe", () => {
    const result = safeResolvePath(testDir, "new-file.txt");
    expect(result).toBe(join(testDir, "new-file.txt"));
  });

  it("allows new paths in existing subdirectories", () => {
    const result = safeResolvePath(testDir, "subdir/new-file.txt");
    expect(result).toBe(join(testDir, "subdir", "new-file.txt"));
  });

  it("returns null when base directory does not exist", () => {
    expect(safeResolvePath("/nonexistent-base-dir-xyz", "file.txt")).toBeNull();
  });

  it("returns null for symlinks that escape base directory", () => {
    // Create a symlink pointing outside the base directory
    symlinkSync("/tmp", join(testDir, "escape-link"));
    expect(safeResolvePath(testDir, "escape-link/some-file")).toBeNull();
  });
});

describe("sanitizeGitOutput", () => {
  it("strips tokens from clone URLs in error output", () => {
    const stderr =
      "fatal: repository 'https://x-access-token:ghp_secret123@github.com/owner/repo.git/' not found";
    expect(sanitizeGitOutput(stderr)).toBe(
      "fatal: repository 'https://x-access-token:***@github.com/owner/repo.git/' not found",
    );
  });

  it("strips multiple token occurrences", () => {
    const stderr = "x-access-token:abc@host1 and x-access-token:def@host2";
    expect(sanitizeGitOutput(stderr)).toBe("x-access-token:***@host1 and x-access-token:***@host2");
  });

  it("passes through output without tokens unchanged", () => {
    const clean = "fatal: not a git repository";
    expect(sanitizeGitOutput(clean)).toBe(clean);
  });
});

describe("context detection", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetPlatformCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetPlatformCache();
  });

  it("detects GitHub Actions context from GITHUB_ACTIONS=true", async () => {
    process.env.GITHUB_ACTIONS = "true";
    process.env.CROSS_REPO_PLATFORM = "github";
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;

    const result = await crossRepoTool.execute(
      { owner: "test", repo: "test-repo", operation: "clone" },
      mockToolContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("GitHub Actions");
  });

  it("uses env token when available (no auth error)", async () => {
    process.env.GITHUB_ACTIONS = "true";
    process.env.CROSS_REPO_PLATFORM = "github";
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    process.env.GH_TOKEN = "test-token-value";

    const result = await crossRepoTool.execute(
      { owner: "test", repo: "test-repo", operation: "clone" },
      mockToolContext,
    );

    const parsed = JSON.parse(result);
    // Will fail (invalid token), but NOT on "No authentication" — proves token was picked up
    if (!parsed.success) {
      expect(parsed.error).not.toContain("No authentication");
    }
  });

  it("rejects clone with invalid owner name", async () => {
    process.env.CROSS_REPO_PLATFORM = "github";
    process.env.GH_TOKEN = "test-token";

    const result = await crossRepoTool.execute(
      { owner: "../escape", repo: "repo", operation: "clone" },
      mockToolContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Invalid owner name");
  });

  it("rejects clone with invalid repo name", async () => {
    process.env.CROSS_REPO_PLATFORM = "github";
    process.env.GH_TOKEN = "test-token";

    const result = await crossRepoTool.execute(
      { owner: "valid-owner", repo: "repo/../../etc", operation: "clone" },
      mockToolContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Invalid repo name");
  });
});
