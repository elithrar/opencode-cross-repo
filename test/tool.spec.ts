import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { crossRepoTool, crossRepo, resetPlatformCache } from "../src/index"

// Mock ToolContext for testing
const mockToolContext = {
	sessionID: "test-session-123",
	messageID: "test-message-456",
	agent: "test-agent",
	abort: new AbortController().signal,
}

describe("crossRepoTool", () => {
	const originalEnv = { ...process.env }

	beforeEach(() => {
		resetPlatformCache()
	})

	afterEach(() => {
		process.env = { ...originalEnv }
		resetPlatformCache()
	})

	describe("tool metadata", () => {
		it("has required tool properties", () => {
			expect(crossRepoTool.description).toContain("GitHub")
			expect(crossRepoTool.description).toContain("GitLab")
			expect(crossRepoTool.args).toBeDefined()
			expect(typeof crossRepoTool.execute).toBe("function")
		})

		it("describes supported operations", () => {
			expect(crossRepoTool.description).toContain("clone")
			expect(crossRepoTool.description).toContain("branch")
			expect(crossRepoTool.description).toContain("commit")
			expect(crossRepoTool.description).toContain("push")
			expect(crossRepoTool.description).toContain("pr")
			expect(crossRepoTool.description).toContain("merge request")
		})

		it("documents platform detection", () => {
			expect(crossRepoTool.description).toContain("CROSS_REPO_PLATFORM")
			expect(crossRepoTool.description).toContain("glab CLI")
			expect(crossRepoTool.description).toContain("gh CLI")
		})

		it("documents self-hosted GitHub support", () => {
			expect(crossRepoTool.description).toContain('containing "github"')
		})

		it("documents exec operation for grep/find", () => {
			expect(crossRepoTool.description).toContain("exec")
			expect(crossRepoTool.description).toContain("grep")
		})
	})

	describe("execute() error handling", () => {
		it("returns error JSON when repo not cloned (branch operation)", async () => {
			// Force GitHub platform
			process.env.CROSS_REPO_PLATFORM = "github"
			resetPlatformCache()

			const result = await crossRepoTool.execute(
				{
					owner: "test",
					repo: "not-cloned-repo",
					operation: "branch",
					branch: "test-branch",
				},
				mockToolContext
			)

			const parsed = JSON.parse(result)
			expect(parsed.success).toBe(false)
			expect(parsed.error).toContain("not cloned")
		})

		it("returns error JSON for unknown operation", async () => {
			process.env.CROSS_REPO_PLATFORM = "github"
			resetPlatformCache()

			const result = await crossRepoTool.execute(
				{
					owner: "test",
					repo: "test-repo",
					operation: "invalid-op" as any,
				},
				mockToolContext
			)

			const parsed = JSON.parse(result)
			expect(parsed.success).toBe(false)
			expect(parsed.error).toContain("Unknown operation")
		})

		it("never throws - always returns valid JSON", async () => {
			process.env.CROSS_REPO_PLATFORM = "github"
			resetPlatformCache()

			const badInputs = [
				{ owner: "", repo: "", operation: "clone" },
				{ owner: "x", repo: "y", operation: "read" },
				{ owner: "x", repo: "y", operation: "write" },
				{ owner: "x", repo: "y", operation: "commit" },
			]

			for (const input of badInputs) {
				const result = await crossRepoTool.execute(input as any, mockToolContext)
				expect(() => JSON.parse(result)).not.toThrow()
				const parsed = JSON.parse(result)
				expect(parsed.success).toBe(false)
			}
		})

		it("returns error when required args missing for operations", async () => {
			process.env.CROSS_REPO_PLATFORM = "github"
			resetPlatformCache()

			const missingArgCases = [
				{ owner: "x", repo: "y", operation: "exec" },
				{ owner: "x", repo: "y", operation: "pr" },
			]

			for (const input of missingArgCases) {
				const result = await crossRepoTool.execute(input as any, mockToolContext)
				const parsed = JSON.parse(result)
				expect(parsed.success).toBe(false)
				expect(parsed.error).toBeDefined()
			}
		})
	})
})

describe("crossRepo plugin factory", () => {
	const originalEnv = { ...process.env }

	afterEach(() => {
		process.env = { ...originalEnv }
		resetPlatformCache()
	})

	it("exports a plugin factory function", () => {
		expect(typeof crossRepo).toBe("function")
	})

	it("returns plugin hooks with tool definition", async () => {
		const plugin = crossRepo()
		const hooks = await plugin({} as any)
		expect(hooks.tool).toBeDefined()
		expect(hooks.tool!["cross-repo"]).toBeDefined()
	})

	it("accepts platform override option", async () => {
		const plugin = crossRepo({ platform: "gitlab" })
		const hooks = await plugin({} as any)
		expect(hooks.tool!["cross-repo"]).toBeDefined()
		expect(process.env.CROSS_REPO_PLATFORM).toBe("gitlab")
	})

	it("accepts gitlabHost option", async () => {
		const plugin = crossRepo({ gitlabHost: "gitlab.mycompany.com" })
		const hooks = await plugin({} as any)
		expect(hooks.tool!["cross-repo"]).toBeDefined()
		expect(process.env.GITLAB_HOST).toBe("gitlab.mycompany.com")
	})

	it("accepts githubHost option for GitHub Enterprise", async () => {
		const plugin = crossRepo({ githubHost: "github.mycompany.com" })
		const hooks = await plugin({} as any)
		expect(hooks.tool!["cross-repo"]).toBeDefined()
		expect(process.env.GITHUB_HOST).toBe("github.mycompany.com")
	})

	it("accepts combined platform and host options", async () => {
		const plugin = crossRepo({ platform: "github", githubHost: "github.enterprise.acme.com" })
		const hooks = await plugin({} as any)
		expect(hooks.tool!["cross-repo"]).toBeDefined()
		expect(process.env.CROSS_REPO_PLATFORM).toBe("github")
		expect(process.env.GITHUB_HOST).toBe("github.enterprise.acme.com")
	})
})
