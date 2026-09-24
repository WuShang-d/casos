export function repoPath(repo) {
  try {
    return new URL(repo).pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "") || repo;
  } catch {
    return repo;
  }
}

// A DNS-1123 name from the repository's last path segment.
export function nameFromRepo(repo) {
  const last = repoPath(repo).split("/").pop() ?? "";
  return last.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
