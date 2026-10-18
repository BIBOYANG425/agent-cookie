// Server-rendered pages: the consent page (GET /link/:id), the cookie page (GET /me) and its sign-in variant. One small
// template module, no build step, mobile first. Field NAMES only, never a value; ids, counts, names and times. Every
// dynamic string goes through esc(); data reaches the script through attributes and a meta tag, never inside it.
import type { GatewayLinkStatus, MeView } from "@agent-cookie/contract";

export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

/** "2026-10-18 16:40 UTC" in a <time> element. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  const text = `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
  return `<time datetime="${esc(d.toISOString())}">${text}</time>`;
}

const STYLE = `
:root { color-scheme: light dark; --bg: #f5f1e9; --card: #fffdf8; --ink: #19251f; --muted: #526258; --line: #d9dfd4;
  --accent: #1e5a43; --accent-soft: #e2eee6; --warn: #8a3b12; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
@media (prefers-color-scheme: dark) { :root { --bg: #111814; --card: #18221c; --ink: #e8efe9; --muted: #a3b3a8; --line: #2c3a31;
  --accent: #5fbf93; --accent-soft: #22362b; --warn: #f0a070; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); line-height: 1.5; }
main { width: min(100% - 32px, 560px); margin: 24px auto 48px; padding: 24px; background: var(--card); border: 1px solid var(--line); border-radius: 20px; }
h1 { margin: 0 0 8px; font-size: 1.6rem; line-height: 1.25; }
h2 { margin: 28px 0 8px; font-size: 1.1rem; }
p { margin: 8px 0; }
.eyebrow { margin: 0 0 6px; color: var(--muted); font-size: .85rem; letter-spacing: .04em; text-transform: uppercase; }
.muted { color: var(--muted); font-size: .95rem; }
.notice { padding: 12px 14px; border-radius: 12px; background: var(--accent-soft); }
.warn { color: var(--warn); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; overflow-wrap: anywhere; }
ul.fields { display: flex; flex-wrap: wrap; gap: 6px; padding: 0; margin: 12px 0; list-style: none; }
ul.fields li { padding: 3px 9px; border: 1px solid var(--line); border-radius: 999px; font-size: .9rem; }
ul.rows { padding: 0; margin: 0; list-style: none; }
ul.rows li { padding: 12px 0; border-top: 1px solid var(--line); }
ul.rows li:first-child { border-top: 0; }
.row-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.actions { display: grid; gap: 10px; margin-top: 18px; }
button { min-height: 50px; padding: 0 18px; border: 0; border-radius: 12px; background: var(--accent); color: #fff; font: inherit; font-weight: 650; cursor: pointer; }
button.secondary { background: var(--accent-soft); color: var(--accent); }
button.small { min-height: 38px; font-size: .9rem; }
button:disabled { opacity: .55; cursor: wait; }
form.inline { display: inline; }
label { display: flex; gap: 8px; align-items: flex-start; margin: 10px 0; }
#status { min-height: 1.5em; margin-top: 16px; }
footer { margin-top: 28px; font-size: .9rem; }
a { color: var(--accent); }
`;

/**
 * Passkey sign-up / sign-in (the served @simplewebauthn/browser bundle), approve and decline. Reads the CSRF token from
 * the meta tag and the link id from the button; reloads after signing in so the server renders the signed-in page.
 */
const CLIENT_JS = `
(function () {
  var meta = document.querySelector('meta[name="csrf-token"]');
  var csrf = meta ? meta.getAttribute("content") : "";
  var status = document.getElementById("status");
  function say(text) { if (status) status.textContent = text; }
  function busy(on) { document.querySelectorAll("button[data-action]").forEach(function (b) { b.disabled = on; }); }
  async function post(path, body) {
    var r = await fetch(path, { method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf || "" }, body: JSON.stringify(body || {}) });
    var j = {};
    try { j = await r.json(); } catch (e) { j = {}; }
    if (!r.ok) throw new Error((j.error && j.error.message) || "Something went wrong. Please try again.");
    return j;
  }
  function show(id) {
    var decide = document.getElementById("decide");
    if (decide) decide.hidden = true;
    var done = document.getElementById(id);
    if (done) done.hidden = false;
    say("");
  }
  var actions = {
    signup: async function () {
      say("Waiting for your passkey…");
      var options = await post("/webauthn/register/options");
      var response = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });
      say("Setting up your jar…");
      await post("/webauthn/register/verify", { response: response });
      location.reload();
    },
    signin: async function () {
      say("Waiting for your passkey…");
      var options = await post("/webauthn/authenticate/options");
      var response = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
      await post("/webauthn/authenticate/verify", { response: response });
      location.reload();
    },
    approve: async function (button) {
      say("Approving…");
      await post("/links/" + encodeURIComponent(button.getAttribute("data-link")) + "/approve");
      show("done-approved");
    },
    decline: async function (button) {
      say("Declining…");
      await post("/links/" + encodeURIComponent(button.getAttribute("data-link")) + "/decline");
      show("done-declined");
    }
  };
  document.querySelectorAll("button[data-action]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var action = actions[button.getAttribute("data-action")];
      if (!action) return;
      busy(true);
      try { await action(button); busy(false); }
      catch (e) { say((e && e.message) || "Something went wrong. Please try again."); busy(false); }
    });
  });
})();
`;

interface Layout {
  title: string;
  nonce: string;
  csrf?: string;
  /** Load the WebAuthn bundle and the page script. */
  script: boolean;
}

function layout(o: Layout, main: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="same-origin">
${o.csrf ? `<meta name="csrf-token" content="${esc(o.csrf)}">` : ""}
<title>${esc(o.title)}</title>
<style nonce="${esc(o.nonce)}">${STYLE}</style>
</head>
<body>
<main>
${main}
</main>
${o.script ? `<script src="/vendor/webauthn.js"></script>\n<script nonce="${esc(o.nonce)}">${CLIENT_JS}</script>` : ""}
</body>
</html>`;
}

const STATUS_TEXT: Record<GatewayLinkStatus, string> = {
  pending: "waiting for your decision",
  approved: "approved",
  declined: "declined",
  expired: "expired",
};

export interface ConsentPageInput {
  nonce: string;
  csrf?: string;
  linkId: string;
  status: GatewayLinkStatus;
  agentName: string;
  expiresAt: string;
  /** Field names the assistant may receive by policy (auto.assistant). */
  fields: readonly string[];
  /** The signed-in person, if any. */
  userId?: string;
}

export function consentPage(i: ConsentPageInput): string {
  const name = esc(i.agentName);
  const signedIn = i.userId !== undefined;
  let decide = "";
  if (i.status !== "pending") {
    decide = `<p class="notice">This link is ${STATUS_TEXT[i.status]}. You can close this page.</p>`;
  } else if (!signedIn) {
    decide = `<section id="decide">
<p>Sign in with your passkey to decide, or create your jar with one. No password, no email.</p>
<div class="actions">
<button data-action="signin">Sign in with a passkey</button>
<button class="secondary" data-action="signup">Create my jar with a passkey</button>
</div>
</section>`;
  } else {
    decide = `<section id="decide">
<p class="muted">Signed in as <code>${esc(i.userId!)}</code>. This link can be decided until ${when(i.expiresAt)}.</p>
<div class="actions">
<button data-action="approve" data-link="${esc(i.linkId)}">Approve</button>
<button class="secondary" data-action="decline" data-link="${esc(i.linkId)}">Decline</button>
</div>
</section>`;
  }
  return layout({ title: "Link an assistant", nonce: i.nonce, ...(i.csrf ? { csrf: i.csrf } : {}), script: i.status === "pending" },
    `<p class="eyebrow">Agent Cookie</p>
<h1>${name} asks to link to your jar</h1>
<p>If you approve, ${name} can read these fields from your jar when it helps you, by your jar's policy. Only their names are shown here:</p>
<ul class="fields">${i.fields.map((f) => `<li><code>${esc(f)}</code></li>`).join("")}</ul>
<p class="muted">Every read is recorded as a receipt on your cookie page, and you can revoke the link there at any time. ${name} never receives your shipping address or payment method.</p>
${decide}
<section id="done-approved" hidden><p class="notice">Approved. ${name} is linked to your jar. You can close this page.</p></section>
<section id="done-declined" hidden><p class="notice">Declined. ${name} was told no. You can close this page.</p></section>
<p id="status" role="status" aria-live="polite"></p>
<footer><a href="/me">Your cookie page</a></footer>`);
}

const DONE_TEXT: Record<string, string> = {
  deleted: "Your data was deleted: your jar, its history and your passkey record are gone.",
  logout: "You are signed out.",
};

export function signInPage(i: { nonce: string; done?: string }): string {
  const done = i.done && DONE_TEXT[i.done] ? `<p class="notice">${esc(DONE_TEXT[i.done]!)}</p>` : "";
  return layout({ title: "Your cookie page", nonce: i.nonce, script: true },
    `<p class="eyebrow">Agent Cookie</p>
<h1>Your cookie page</h1>
${done}
<p>Sign in with your passkey to see who knew what about you, and to revoke what you no longer want.</p>
<div class="actions">
<button data-action="signin">Sign in with a passkey</button>
<button class="secondary" data-action="signup">Create my jar with a passkey</button>
</div>
<p id="status" role="status" aria-live="polite"></p>`);
}

export interface MePageInput {
  nonce: string;
  csrf: string;
  me: MeView;
  /** agentId → display name (global assistants and the instance's own agents). */
  names: Map<string, string>;
  /** The instance could not be reached: grants and receipts are not shown. */
  jarUnavailable: boolean;
}

export function mePage(i: MePageInput): string {
  const { me } = i;
  const name = (agentId: string) => esc(i.names.get(agentId) ?? agentId);
  const csrfField = `<input type="hidden" name="csrf" value="${esc(i.csrf)}">`;
  const receipts = me.receipts.length === 0
    ? `<p class="muted">No reads yet.</p>`
    : `<ul class="rows">${me.receipts.map((r) => `<li><div class="row-head"><strong>${name(r.agentId)}</strong>${when(r.createdAt)}</div>
<div>Purpose <code>${esc(r.purpose)}</code></div>
<ul class="fields">${r.fields.map((f) => `<li><code>${esc(f)}</code></li>`).join("")}</ul></li>`).join("")}</ul>`;
  const grants = me.grants.length === 0
    ? `<p class="muted">No grants.</p>`
    : `<ul class="rows">${me.grants.map((g) => `<li><div class="row-head"><strong>${esc(g.agentName)}</strong><span>${esc(g.status)}</span></div>
<div>Purpose <code>${esc(g.purpose)}</code> · ${g.status === "live" ? "until" : "ended"} ${when(g.expiresAt)}</div>
${g.status === "live" ? `<form method="post" action="/me/grants/${encodeURIComponent(g.id)}/revoke">${csrfField}<button class="small secondary">Revoke</button></form>` : ""}</li>`).join("")}</ul>`;
  const links = me.links.length === 0
    ? `<p class="muted">No links.</p>`
    : `<ul class="rows">${me.links.map((l) => `<li><div class="row-head"><strong>${esc(l.agentName)}</strong><span>${esc(l.status)}</span></div>
<div class="muted">Asked ${when(l.createdAt)}${l.decidedAt ? ` · decided ${when(l.decidedAt)}` : ""}</div></li>`).join("")}</ul>`;
  return layout({ title: "Your cookie page", nonce: i.nonce, csrf: i.csrf, script: false },
    `<p class="eyebrow">Agent Cookie</p>
<h1>Your cookie page</h1>
<p class="muted">Signed in as <code>${esc(me.userId)}</code> since ${when(me.createdAt)}. Your jar: <code>${esc(me.jarUrl)}</code></p>
${i.jarUnavailable ? `<p class="notice warn">Your jar could not be reached just now, so reads and grants are not shown. Try again in a moment.</p>` : ""}
<h2>Who knew what (${me.receipts.length})</h2>
<p class="muted">Each time an agent received fields from your jar: who, which fields (names only), and for what.</p>
${receipts}
<h2>Grants (${me.grants.length})</h2>
${grants}
<h2>Links (${me.links.length})</h2>
${links}
<h2>Delete my data</h2>
<p class="muted">Stops your jar, removes its directory (your card, its history and every receipt) and your passkey record here. Assistants you linked lose access at once. This cannot be undone.</p>
<form method="post" action="/me/delete">${csrfField}
<label><input type="checkbox" name="confirm" value="yes" required> I understand this deletes everything.</label>
<button class="secondary">Delete my data</button>
</form>
<footer><form method="post" action="/me/logout">${csrfField}<button class="small secondary">Sign out</button></form></footer>`);
}

export function notFoundPage(nonce: string): string {
  return layout({ title: "Not found", nonce, script: false },
    `<p class="eyebrow">Agent Cookie</p><h1>This link does not exist</h1><p>Ask the assistant for a new link.</p>`);
}
