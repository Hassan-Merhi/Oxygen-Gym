# Security Policy

## Supported version

Security fixes are applied to the current `main` branch. Older branches and historical commits are not supported release lines.

## Reporting a vulnerability

Please report suspected vulnerabilities privately. Do not open a public issue with exploit details, credentials, personal data, or reproducible attack steps.

Use GitHub's private vulnerability reporting / Security Advisory flow for this repository when available. Include:

- the affected route, component, or workflow;
- the security impact and who could be affected;
- minimal reproduction steps;
- any known workaround or mitigation;
- whether credentials or user data may have been exposed.

If the repository's private reporting flow is unavailable, contact the repository owner through GitHub without publishing sensitive details, then move the report to a private channel before sharing a proof of concept.

## Handling

Security fixes should preserve authentication, authorization, tenant boundaries, accounting integrity, and existing CI gates. Do not disable or weaken tests, CodeQL, Architecture, Backend Architecture, or repository governance checks to make a security change pass.
