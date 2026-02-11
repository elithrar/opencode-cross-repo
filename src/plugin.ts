// Package entry point for npm plugin loading.
// OpenCode calls every named export as a Plugin function, so this file
// must ONLY export Plugin-compatible functions — nothing else.

export { CrossRepoPlugin } from "./index";
