/**
 * Shared internal utilities for evalgate.
 * Not exported from index.ts — internal use only.
 */

/**
 * Converts a string to a URL-safe slug.
 *
 * @param s     Input string.
 * @param maxLen Maximum character length for the result. Default 60.
 *              Use 40 for git branch names to stay within safe limits.
 */
export function slugify(s: string, maxLen = 60): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, maxLen);
}
