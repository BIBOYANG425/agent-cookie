# Devpost submission runbook for a computer-use agent (Codex)

2026-10-18. This file tells a computer-use agent exactly what to type into each field of the LA Hacks 2026 Devpost form for **Agent Cookie**. All copy is English. The longer reasoning behind it is in `docs/devpost-submission-brief.md`; do not paraphrase from there, paste from here.

## Rules for the agent

1. **Paste, don't write.** Every value below is final text. Copy it exactly, including Markdown. Do not add claims, numbers, emoji or prize language.
2. **Never invent personal data.** Team names, emails and schools are marked `ASK HUMAN`. If they are not in your instructions, stop at that field and ask. A wrong email disqualifies the team.
3. **Never tick an attestation checkbox.** The two "I understand..." boxes are legal acknowledgements for the people on the team. Leave them for a human.
4. **Never change repository visibility.** The GitHub field says MUST BE PUBLIC. If the repo is private, stop and tell the human; do not change settings yourself.
5. **Never press the final Submit / Publish button.** Press **Save & continue** on each page. Stop on the last page and hand back to the human with a summary of what is filled and what is missing.
6. **Pick dropdown options only when they match exactly the names listed here.** If an option is missing or named differently, stop and ask; do not pick the closest one.
7. Before leaving each page, check the character counter: no field may show a negative count.

## Page 1 · General info

### Project name (60 characters)

Replace the current value `Agent-cookie` with:

```
Agent Cookie
```

### Elevator pitch (200 characters)

Replace the current value `agent cookie` with (103 characters):

```
The cookie for AI agents. Any agent knows you on its first message and never holds your address or card.
```

Press **Save & continue**.

## Page 2 · Project Story

### About the project (Markdown)

Clear the placeholder. Open `docs/devpost-story.md` in this repository and paste its **entire raw contents**, exactly as written: Markdown, the `$$` formula blocks and the image line included. Do not paste the rendered preview.

The image line points at `docs/assets/agent-cookie-loop.png` on `main`, which is public and loads. If Devpost's preview still shows a broken image, leave the line in and tell the human. If the two `$$` formula blocks show as raw text in the preview, delete those two blocks and tell the human.

### Built with (up to 25 tags)

Type each tag and press Enter after each one. If the field offers an autocomplete suggestion with the same name, pick it; otherwise keep the typed text. 21 tags:

```
typescript
node.js
pnpm
hono
sqlite
git
react
vite
python
photon
imessage
shopify
claude
openrouter
model-context-protocol
webauthn
visa
openapi
sentry
vitest
esbuild
```

### Try it out links (if the page has this field)

```
https://github.com/BIBOYANG425/agent-cookie
```

Press **Save & continue**.

## Page 3 · Additional info

### Sponsor / Special Prizes (select all that apply)

Select each of these **only if an option with that sponsor's name exists**:

- Photon
- Visa
- Cognition (may be listed as Devin or Windsurf)
- Paper (may be listed as Best Designed Hack)
- Sentry

Do **not** select Fetch / Agentverse, Browser Use, or Intuit / Jev. If none of the five names above appear, stop and ask.

### GitHub Repo (MUST BE PUBLIC)

```
https://github.com/BIBOYANG425/agent-cookie
```

Then open that URL in a private or logged-out browser window. If GitHub shows a 404, the repo is private: **stop and tell the human**. Do not change the visibility yourself.

### Which of the event tracks would you like to be considered for? (one only)

Select the option whose name contains **Applied Intelligence**. If no option contains that phrase, stop and send the human the full list of options.

### Email of Team Member 1 to 4

`ASK HUMAN`. Each must be the exact email that person used to register and log in at LA Hacks. Leave unused member fields empty.

### Team Member Names

`ASK HUMAN`. Format exactly: `First Last, First Last, First Last, First Last`.

### The two "I understand..." checkboxes

**Leave unticked.** A human team member ticks them.

### List all of the universities or schools that your team members currently attend

`ASK HUMAN`.

Press **Save & continue** if the page allows it with the human fields still empty; otherwise stop here.

## Page 4 and later (video, images)

- **Video link:** `ASK HUMAN` for the unlisted YouTube URL. Do not upload or record anything.
- **Image gallery:** upload only files the human gives you. Every console screenshot must show the `Sample` label.

## Hand-back summary

When you stop, send the human:

1. Which pages are saved.
2. Which fields are still empty and why (`ASK HUMAN`, missing option, repo private).
3. A reminder that the two checkboxes and the final Submit are theirs.

## Before submitting (for the human)

- Make the repository public and confirm it loads logged out.
- Merge `claude/stoic-feynman-vgpyzi` so the root `README.md` judges see is the English one.
- Fill emails, names and schools; tick the two checkboxes; add the video link; press Submit.
