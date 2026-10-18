# Agent Cookie

## Tagline

Your context, across agents. Your control, throughout.

## Short description

Agent Cookie gives connected AI assistants shared personal context, with permissions and receipts you can inspect. Switch assistants without starting from scratch, while a workspace you control checks what each recipient may read.

## Inspiration

Switching AI assistants often feels like meeting someone new. We explain our preferences again, repeat our usual size, and lose useful context from earlier interactions.

Website cookies gave individual sites continuity. We wanted to explore continuity across connected agents while keeping the user in control. That became Agent Cookie: a personal context layer with sources, separate recipient sessions, and purpose-based access.

## What it does

Agent Cookie brings together a personal card, separate merchant sessions, and a workspace that checks access rules. Connected personal assistants can use the same context. Company assistants request a consent link and receive only the fields their role and the user's policy permit. Their context excludes shipping addresses and payment methods.

Our prototype starts on a phone, continues through Claude Desktop, and makes the underlying permissions visible in an English console. In a separate controlled Sample scenario, one company assistant records a preference, a second receives it on its first context read, and the same merchant sessions continue across both assistants. A fixture checkout releases the Sample address only to the selected merchant. Revoking the second assistant causes its next context read to return GRANT_REVOKED.

Users can inspect context, learning candidates, sources, permissions, and receipts. They can pause learning or revoke access. Revocation blocks future reads; it cannot recall information already delivered.

## How we built it

The workspace uses TypeScript, Hono, SQLite, and a Git memory repository. A shared contract connects the SDK, CLI, MCP integration, Photon iMessage channel, and React/Vite console. HANA connects the conversational assistant to the workspace; Shopify UCP supplies catalog and checkout handoff operations.

The SDK has distinct clients for personal agents, company assistants, and merchants. Permission checks, expiry, revocation, and memory merging run in deterministic code. A model cannot grant itself additional access.

Opt-in preference learning uses local filtering, a TypeSafe Jev gate, and GPT-OSS extraction through OpenRouter. The workspace preserves source identity and decides whether a preference remains a candidate or becomes context. One conversation appearing in several places still counts as one source.

## Challenges we ran into

Source identity was a challenge: the same conversation can produce a message, a shopping request, and a later selection. Counting these as independent evidence would inflate confidence. We preserved conversation provenance across the flow.

Real messaging required checking delivery records as well as model output. A generated reply does not by itself prove that the phone received it.

Live commerce also changes. A catalog result may omit sizing or delivery information. A checkout link is a handoff, not an order. We retain Sample, Fixture, and Live distinctions and keep uncertainty visible.

## Accomplishments that we are proud of

- A real HANA/Photon phone flow returned live offers and delivered a merchant handoff after selection.
- A natural phone conversation produced a preference candidate after the inactivity window, with one source and no manual learning trigger.
- Actual Claude Desktop MCP calls read the same Sample card and returned two live offers in English.
- A separately verified Sample company-assistant flow demonstrated consent, inherited context, stable merchant sessions, purpose-gated address access, and denied access after revocation.
- The English console displays the same sources, grants, and field-name receipts used to verify those behaviors.

## What we learned

Useful memory needs a lifecycle. Where a detail came from matters as much as its value. An explicit user statement and an inferred preference deserve different treatment.

We also learned that a working component and a convincing demonstration are different milestones. The phone, assistant, workspace, merchant, and console must show a consistent account of what actually happened.

## What's next

We want to expand integrations, improve onboarding, and measure whether portable context reduces repeated questions. We will evaluate preference-based ranking against controlled product sets and validate hosted identity and payment integrations separately.

## Built with

TypeScript, Node.js, React, Vite, Hono, SQLite, Git, MCP, Photon, Shopify UCP, OpenRouter, GPT-OSS, TypeSafe Jev, Vitest.

## Generative AI model or API response

Yes. The prototype uses language models through OpenRouter for conversation and opt-in preference learning. TypeSafe Jev gates candidate text, and GPT-OSS extracts structured preferences. Deterministic code validates the result, preserves its source, and determines whether it remains a candidate or can update context. Models do not decide authorization, approve their own access, or complete payments. This division allows conversational input while keeping permissions and memory updates inspectable.

## Demo scope

The persona is Sample. Live searches and fixture replays are labelled separately. The live phone handoff did not release the Sample address to a live merchant; the address-release demonstration belongs to the isolated fixture scenario. No completed purchase or real payment is claimed. Pairwise session IDs avoid one global identifier across recipients, but do not make all forms of correlation impossible.

## Submission links and team fields

- Repository: https://github.com/BIBOYANG425/agent-cookie — public visibility verified on October 18, 2026.
- Video: final YouTube or Vimeo URL required from the recording owner.
- Team names, registration emails, schools, and ASI:One handles: use each member's exact confirmed details.
- Event track and sponsor categories: select only the team's confirmed entries.
- AI development tools: confirm each member's actual tools; this is separate from the models implemented in the product.
