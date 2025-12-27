import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { detectPlatformFromRemote, resetPlatformCache } from "../src/index"

describe("detectPlatformFromRemote", () => {
	describe("GitHub.com detection", () => {
		it("detects github.com from HTTPS URL", () => {
			const result = detectPlatformFromRemote("https://github.com/owner/repo.git")
			expect(result).toEqual({ platform: "github", host: "github.com" })
		})

		it("detects github.com from SSH URL", () => {
			const result = detectPlatformFromRemote("git@github.com:owner/repo.git")
			expect(result).toEqual({ platform: "github", host: "github.com" })
		})

		it("detects github.com from HTTPS URL with token", () => {
			const result = detectPlatformFromRemote("https://x-access-token:TOKEN@github.com/owner/repo.git")
			expect(result).toEqual({ platform: "github", host: "github.com" })
		})
	})

	describe("Self-hosted GitHub (GitHub Enterprise) detection", () => {
		it("detects self-hosted GitHub from hostname containing 'github'", () => {
			const result = detectPlatformFromRemote("https://github.mycompany.com/team/repo.git")
			expect(result).toEqual({ platform: "github", host: "github.mycompany.com" })
		})

		it("detects self-hosted GitHub with 'github' subdomain", () => {
			const result = detectPlatformFromRemote("git@github.internal.corp:team/repo.git")
			expect(result).toEqual({ platform: "github", host: "github.internal.corp" })
		})

		it("detects self-hosted GitHub with port in hostname", () => {
			const result = detectPlatformFromRemote("https://github.mycompany.com:8443/team/repo.git")
			expect(result).toEqual({ platform: "github", host: "github.mycompany.com:8443" })
		})

		it("detects GitHub Enterprise Server with token auth", () => {
			const result = detectPlatformFromRemote("https://x-access-token:TOKEN@github.enterprise.acme.com/org/repo.git")
			expect(result).toEqual({ platform: "github", host: "github.enterprise.acme.com" })
		})
	})

	describe("GitLab.com detection", () => {
		it("detects gitlab.com from HTTPS URL", () => {
			const result = detectPlatformFromRemote("https://gitlab.com/owner/repo.git")
			expect(result).toEqual({ platform: "gitlab", host: "gitlab.com" })
		})

		it("detects gitlab.com from SSH URL", () => {
			const result = detectPlatformFromRemote("git@gitlab.com:owner/repo.git")
			expect(result).toEqual({ platform: "gitlab", host: "gitlab.com" })
		})

		it("detects gitlab.com from HTTPS URL with token", () => {
			const result = detectPlatformFromRemote("https://oauth2:TOKEN@gitlab.com/owner/repo.git")
			expect(result).toEqual({ platform: "gitlab", host: "gitlab.com" })
		})

		it("handles GitLab nested groups", () => {
			const result = detectPlatformFromRemote("https://gitlab.com/group/subgroup/repo.git")
			expect(result).toEqual({ platform: "gitlab", host: "gitlab.com" })
		})
	})

	describe("Self-hosted GitLab detection", () => {
		it("detects self-hosted GitLab from hostname containing 'gitlab'", () => {
			const result = detectPlatformFromRemote("https://gitlab.mycompany.com/team/repo.git")
			expect(result).toEqual({ platform: "gitlab", host: "gitlab.mycompany.com" })
		})

		it("detects self-hosted GitLab with 'gitlab' subdomain", () => {
			const result = detectPlatformFromRemote("git@gitlab.internal.corp:team/repo.git")
			expect(result).toEqual({ platform: "gitlab", host: "gitlab.internal.corp" })
		})

		it("detects self-hosted GitLab with port in hostname", () => {
			const result = detectPlatformFromRemote("https://gitlab.mycompany.com:8443/team/repo.git")
			expect(result).toEqual({ platform: "gitlab", host: "gitlab.mycompany.com:8443" })
		})
	})

	describe("Edge cases", () => {
		it("returns null for empty string", () => {
			const result = detectPlatformFromRemote("")
			expect(result).toBeNull()
		})

		it("returns null for invalid URL", () => {
			const result = detectPlatformFromRemote("not-a-url")
			expect(result).toBeNull()
		})

		it("defaults to GitHub for unknown hosts", () => {
			// Unknown host without 'gitlab' or 'github' in name defaults to GitHub
			const result = detectPlatformFromRemote("https://git.mycompany.com/team/repo.git")
			expect(result).toEqual({ platform: "github", host: "git.mycompany.com" })
		})

		it("handles Bitbucket-like URLs (defaults to GitHub)", () => {
			const result = detectPlatformFromRemote("https://bitbucket.org/team/repo.git")
			expect(result).toEqual({ platform: "github", host: "bitbucket.org" })
		})

		it("prioritizes exact 'github.com' match over pattern", () => {
			const result = detectPlatformFromRemote("https://github.com/owner/repo.git")
			expect(result?.platform).toBe("github")
			expect(result?.host).toBe("github.com")
		})

		it("prioritizes exact 'gitlab.com' match over pattern", () => {
			const result = detectPlatformFromRemote("https://gitlab.com/owner/repo.git")
			expect(result?.platform).toBe("gitlab")
			expect(result?.host).toBe("gitlab.com")
		})
	})
})

describe("platform detection caching", () => {
	const originalEnv = { ...process.env }

	beforeEach(() => {
		resetPlatformCache()
	})

	afterEach(() => {
		process.env = { ...originalEnv }
		resetPlatformCache()
	})

	it("respects CROSS_REPO_PLATFORM=gitlab override", async () => {
		process.env.CROSS_REPO_PLATFORM = "gitlab"
		const { detectCurrentRepoPlatform } = await import("../src/index")
		resetPlatformCache() // Reset after import to pick up new env

		const result = await detectCurrentRepoPlatform()
		expect(result?.platform).toBe("gitlab")
	})

	it("respects CROSS_REPO_PLATFORM=github override", async () => {
		process.env.CROSS_REPO_PLATFORM = "github"
		const { detectCurrentRepoPlatform } = await import("../src/index")
		resetPlatformCache()

		const result = await detectCurrentRepoPlatform()
		expect(result?.platform).toBe("github")
	})

	it("uses GITLAB_HOST when platform is gitlab", async () => {
		process.env.CROSS_REPO_PLATFORM = "gitlab"
		process.env.GITLAB_HOST = "gitlab.mycorp.com"
		const { detectCurrentRepoPlatform } = await import("../src/index")
		resetPlatformCache()

		const result = await detectCurrentRepoPlatform()
		expect(result).toEqual({ platform: "gitlab", host: "gitlab.mycorp.com" })
	})

	it("uses GITHUB_HOST when platform is github", async () => {
		process.env.CROSS_REPO_PLATFORM = "github"
		process.env.GITHUB_HOST = "github.mycorp.com"
		const { detectCurrentRepoPlatform } = await import("../src/index")
		resetPlatformCache()

		const result = await detectCurrentRepoPlatform()
		expect(result).toEqual({ platform: "github", host: "github.mycorp.com" })
	})
})
