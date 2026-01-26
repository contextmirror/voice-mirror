"""GitHub CI status tool handler.

Allows Voice Mirror to check CI status via the gh CLI.
Use cases:
- "What's the CI status?" -> shows recent workflow runs
- "Did the build pass?" -> checks latest workflow conclusion
- "Any CI failures?" -> lists failed runs
"""

import asyncio
import json
import subprocess
from typing import Dict, Any


class GitHubCIHandler:
    """Check GitHub CI status via gh CLI."""

    def __init__(self, default_repo: str = "nayballs/context-mirror"):
        """
        Args:
            default_repo: Default repo to check (owner/repo format)
        """
        self.default_repo = default_repo

    async def execute(self, repo: str = "", limit: int = 5, **kwargs) -> str:
        """
        Check CI status for a repository.

        Args:
            repo: Repository in owner/repo format (defaults to context-mirror)
            limit: Number of recent runs to check
        """
        # Validate repo format or use default
        if repo and "/" not in repo:
            # Invalid format (likely transcription error), use default
            repo = self.default_repo
        repo = repo or self.default_repo

        try:
            # Run gh CLI to get workflow runs
            result = await self._run_gh_command([
                "gh", "run", "list",
                "--repo", repo,
                "--limit", str(limit),
                "--json", "status,conclusion,name,headBranch,createdAt,databaseId"
            ])

            if not result:
                return f"No CI runs found for {repo}"

            runs = json.loads(result)
            if not runs:
                return f"No CI runs found for {repo}"

            # Analyze runs
            failures = [r for r in runs if r.get("conclusion") == "failure"]
            in_progress = [r for r in runs if r.get("status") == "in_progress"]
            successes = [r for r in runs if r.get("conclusion") == "success"]

            # Build voice-friendly response
            parts = []

            if in_progress:
                parts.append(f"{len(in_progress)} build{'s are' if len(in_progress) > 1 else ' is'} in progress")

            if failures:
                # Get details of most recent failure
                latest_fail = failures[0]
                branch = latest_fail.get("headBranch", "unknown branch")
                workflow = latest_fail.get("name", "CI")
                run_id = latest_fail.get("databaseId")

                # Try to get the actual error reason
                error_reason = await self._get_failure_reason(repo, run_id)

                if error_reason:
                    parts.append(f"{len(failures)} failed. {error_reason}")
                else:
                    parts.append(f"{len(failures)} failed. Latest failure: {workflow} on {branch}")
            elif successes:
                latest = successes[0]
                branch = latest.get("headBranch", "unknown")
                parts.append(f"All passing. Latest success on {branch}")

            if not parts:
                return f"CI status unclear for {repo}"

            return ". ".join(parts)

        except FileNotFoundError:
            return "GitHub CLI (gh) not installed"
        except json.JSONDecodeError:
            return "Failed to parse CI status"
        except Exception as e:
            return f"Error checking CI: {e}"

    async def _run_gh_command(self, cmd: list) -> str:
        """Run a gh CLI command asynchronously."""
        loop = asyncio.get_event_loop()

        def _run():
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30
            )
            if result.returncode != 0:
                raise Exception(result.stderr or "gh command failed")
            return result.stdout

        return await loop.run_in_executor(None, _run)

    async def _get_failure_reason(self, repo: str, run_id: int) -> str:
        """Try to get the actual failure reason from job annotations."""
        if not run_id:
            return ""

        try:
            # Get jobs for this run
            jobs_json = await self._run_gh_command([
                "gh", "api",
                f"repos/{repo}/actions/runs/{run_id}/jobs",
                "--jq", ".jobs[0].id"
            ])
            job_id = jobs_json.strip()
            if not job_id:
                return ""

            # Get annotations for the first failed job
            annotations_json = await self._run_gh_command([
                "gh", "api",
                f"repos/{repo}/check-runs/{job_id}/annotations"
            ])

            annotations = json.loads(annotations_json)
            if annotations and len(annotations) > 0:
                message = annotations[0].get("message", "")
                # Simplify for voice output
                if "payment" in message.lower() or "billing" in message.lower():
                    return "Billing issue - GitHub Actions payments failed"
                elif "spending limit" in message.lower():
                    return "Spending limit reached on GitHub Actions"
                elif message:
                    # Truncate long messages for voice
                    return message[:100] if len(message) > 100 else message

            return ""
        except Exception:
            return ""


def register_github_ci_tools(default_repo: str = "nayballs/context-mirror") -> dict:
    """Create and return GitHub CI tool handlers.

    Args:
        default_repo: Default repository to check

    Returns:
        Dict of tool_name -> handler
    """
    handler = GitHubCIHandler(default_repo)

    return {
        "github_ci": handler,
    }
