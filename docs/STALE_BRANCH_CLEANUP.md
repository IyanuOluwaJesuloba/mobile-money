# Stale Branch Cleanup

The `Stale Branch Cleanup` GitHub Actions workflow scans repository branches once per day and can also be run manually from the Actions tab.

## Defaults

Scheduled runs use real warning and deletion behavior with these defaults:

- `stale_days`: `30`
- `delete_after_days`: `7`
- `dry_run`: `false`

Manual runs expose the same thresholds and default to `dry_run: true` so maintainers can preview actions before making changes.

## Branch exclusions

The workflow never deletes:

- The repository default branch
- Protected branches
- Branches with common long-lived names: `main`, `master`, `develop`, `development`, `staging`, `production`, `release`, `gh-pages`
- Branches with an open pull request

## Warning and deletion lifecycle

1. The workflow paginates through repository branches and checks each candidate branch's latest commit date.
2. A branch with no commit activity for more than `stale_days` is considered stale.
3. If a stale branch has an open pull request, the workflow adds a PR comment with the marker `<!-- stale-branch-cleanup -->` unless a recent warning from this workflow already exists. Branches with open pull requests are not deleted.
4. If a stale branch has no open pull request, the workflow creates or updates a GitHub issue titled `Stale branch warning: <branch>`. The issue includes the branch name, latest commit SHA/date, branch age, warning date, and planned deletion date.
5. On later runs, if the warning has existed for at least `delete_after_days`, the branch is still stale, and it is still not default/protected/long-lived/open-PR, the workflow deletes the branch ref with `DELETE /repos/{owner}/{repo}/git/refs/heads/<branch>`.
6. Deleted or already-absent refs are reported in the job summary. Warning issues are closed when the workflow deletes the branch or finds the ref already absent.

## Dry-run mode

Manual dry-run mode does not create issues, add PR comments, update issues, close issues, or delete branches. It only writes the actions it would take to the job summary.

To perform a real manual cleanup, run the workflow with `dry_run` set to `false`.

## Required permissions

The workflow uses `GITHUB_TOKEN` with:

- `contents: write` to delete stale branch refs
- `issues: write` to create/update warning issues and add PR comments
- `pull-requests: read` to detect open pull requests
