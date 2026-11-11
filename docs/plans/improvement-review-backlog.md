# Improvement review: backlog (parked)

Written 2026-11-10 from an outside review of ARGUS and my assessment of it. Nothing here is scheduled; the owner will come back to it.

## Corrections to the review

- Connectors already sign in with a Microsoft Entra app and a Google service account (v1.7.1). What's missing is user-consent (delegated) OAuth, which is much bigger.
- Document chunking already follows headings (v1.6), with a Retrieval check (recall, MRR). The real gap is a reranker (Appendix B).
- Act As is already off by default, admin only and audited.
- Library controls already map to several frameworks at once (Traceability, SoA). Importing the client's own controls is the new part.
- California SB 1047 was vetoed (2024). OMB M-24-10 was replaced in 2025 (M-25-21). Check the Colorado AI Act's current start date before using it.

## Worth doing, roughly by value for effort

| Item | Assessment |
| --- | --- |
| Verifier stress tests with planted errors | Best idea in the review. Plant wrong numbers, citations and unsupported claims in known-good drafts; measure what the Verifier catches. Cheap, and QA thinking applied to AI |
| Concentration risk across the AI Inventory | Cheap, high value. Vendor and model are already recorded: show what share of use cases depend on one provider. Fits SR 11-7 |
| Act As locked by an environment setting | Very small. The server refuses Act As when set, whatever the admin setting says |
| Failed sign-in lockout and rate limits | Small. Closes a gap Appendix B admits to |
| Evidence pushed from CI/CD | Medium. A pipeline posts evals, fairness metrics or an SBOM with a scoped token; each lands as fingerprinted evidence. Same entry point could later take monitoring alerts |
| OCR | Medium. Send page images to the vision model already configured on Models & Keys, not Tesseract (awkward on Cloudflare) |
| Regulator disclosure pack | Medium. Built from the incident and report builder; always a draft for legal sign-off; ARGUS never sends it |
| SR 11-7 model risk pack | Medium. ARGUS's own plain-English mapping, never the standard's text |
| MFA (TOTP or passkeys) | Medium. Once real clients use local passwords |

## Parked until a real client asks

- SAML and SCIM (OIDC covers Entra and Okta today)
- User-consent OAuth for every enterprise store
- FAIR or value-at-risk modelling (false precision; an optional loss range on high risks is enough)
- Live telemetry (OpenTelemetry, Langfuse); take alerts through the CI/CD entry point instead
- Llama Guard or NeMo Guardrails. Instead: confirm uploaded text is always fenced as data in prompts, and add red-team cases with instructions hidden in evidence

## Suggested order if picked up

1. Quick wins: Act As lock, sign-in lockout and rate limit, concentration risk, Verifier stress tests
2. CI/CD evidence push
3. OCR through the vision model, SR 11-7 pack
4. Later: MFA, regulator disclosure packs, a reranker
