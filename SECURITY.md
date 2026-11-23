# Security Policy

## Scope

FThisUp deliberately drives a browser against applications and sends unusual input to them, so its own safety boundaries are security-relevant. Please report:

- **Safety-policy bypasses**: any way to make FThisUp contact a non-allow-listed host, contact a third party, send a mutating request to a read-only (production) target, run an unapproved destructive scenario, or exceed the rate/request limits.
- **Scenario-injection**: any way for a scenario file (for example one proposed by an AI agent) to execute arbitrary JavaScript or shell commands, or to read files.
- **Secret leakage**: credentials, tokens or `.env` contents ending up in results, reports or logs.
- **Report XSS**: application-controlled text escaping the HTML report's escaping.
- **Execution-layer escapes** (v0.2): any way to make FThisUp run a shell or a non-allow-listed executable, run code outside the project, leak environment secrets to a child process, let an agent-supplied scenario choose an executable or host, escape the bubblewrap sandbox it configures, or perform a request to a host that was not authorized (including a reachability probe).

Not in scope: vulnerabilities in the applications FThisUp finds bugs in, or findings that depend on you pointing FThisUp at systems you are not authorized to test.

## Reporting

Please use GitHub's **private vulnerability reporting** (repository → *Security* → *Report a vulnerability*). Do not open a public issue for an unfixed vulnerability. Include the FThisUp version (`fthisup --version`), your OS and Node version, and the smallest scenario/config that reproduces the problem.

We aim to acknowledge reports within 7 days.

## Supported versions

FThisUp is in beta (0.x). Only the latest release receives fixes.

## Responsible use

FThisUp is for applications you own or are explicitly authorized to test. It defaults to loopback addresses and blocks everything else unless you opt in. Never use it against systems you do not have permission to test.
