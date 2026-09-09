# Admin — GitHub Releases

The **GitHub** tab shows the release history of the repository this deployment
tracks and provides links to report issues and read the docs.

![GitHub tab](assets/GithubReleases.png)

## Links and resources

Cards at the top of the tab:

| Card | Link |
|------|------|
| **Report a Bug** | Open a GitHub issue with the bug report template |
| **Feature Request** | Open a GitHub issue with the feature request template |
| **Wiki** | Open the in-app help (`/help`), which serves the bundled wiki |

The release history comes from the GitHub API for the repository named by the
`TREK_REPO` server setting (default `iceafish/TREK` — this fork tracks itself,
never upstream).

## Release timeline

Below the link cards, a chronological timeline lists GitHub releases. Each entry shows:

- **Version tag** (e.g., `v2.9.14`)
- A **Latest** badge on the first (most recent) entry in the displayed list
- **Release date** and author
- A **Show details / Hide details** toggle that expands the release notes (Markdown rendered inline)

Pre-release entries are hidden unless the server has both found a newer version and is itself running a pre-release. In every other case, including a pre-release install that is already on the newest pre-release, the timeline shows stable releases only.

Releases load 10 at a time. Click **Load more** at the bottom of the timeline to fetch additional pages.

If the admin API request fails, the timeline section shows an error message. If the server cannot reach the GitHub API, the timeline displays no releases (the server returns an empty list rather than an error). This fork publishes no releases yet, so an empty timeline is normal.

## Version check

The server checks for available updates daily at 9 AM (server timezone, defaults to UTC) and sends an admin notification when a newer version is published in the tracked repository. When an update is available, a banner also appears at the top of the Admin page on next load.

Results are cached for 5 minutes to avoid repeated API calls.

## When to check

Review the GitHub tab before performing an upgrade to read the release notes for any versions between your current install and the target version. See [Updating](Updating) for the upgrade procedure.

## Related pages

- [Updating](Updating)
- [Admin-Panel-Overview](Admin-Panel-Overview)
