# Security Policy

## Supported versions

Security fixes are provided for the latest published release and the current `main` branch. Older versions may not receive patches.

## Reporting a vulnerability

Do not report suspected vulnerabilities in a public issue, discussion, or pull request.

Use GitHub's **Report a vulnerability** option in the repository's Security tab. If private vulnerability reporting is unavailable, contact the maintainer privately using the contact information on the [maintainer's GitHub profile](https://github.com/johniak).

Please include:

- the affected version or commit;
- reproduction steps or a minimal proof of concept;
- the expected security impact;
- any suggested mitigation, if known.

You should receive an acknowledgement within seven days. Please allow time for a fix and coordinated disclosure before publishing details.

## Security model

Reviewonator runs locally and uses the authenticated GitHub CLI for GitHub operations. The browser receives review and pull request data, but never the GitHub token. The server listens on a loopback address and uses a per-session secret for mutating requests. Publishing always requires an explicit preview and confirmation in the UI.
