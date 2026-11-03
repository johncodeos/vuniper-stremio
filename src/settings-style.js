import { createHash } from 'node:crypto';

export const settingsStyle = `
:root {
  color-scheme: dark;
  font: 16px/1.55 system-ui, sans-serif;
  color: #fafafa;
  background: #161616;
  --muted: #b6b6b6;
  --accent: #dc6ef8;
  --border: #333333;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background: #161616;
}
main { width: min(100% - 2rem, 43rem); margin: 0 auto; padding: clamp(2rem, 7vw, 5rem) 0 3rem; }
header { margin-bottom: 1.75rem; }
.brand { display: flex; align-items: center; gap: .7rem; font-weight: 750; }
.mark { display: block; width: 2.4rem; height: 2.4rem; border-radius: .7rem; }
.kicker { margin: 1.6rem 0 .4rem; color: var(--accent); letter-spacing: .12em; font-size: .72rem; font-weight: 750; }
h1 { margin: 0; font-size: clamp(2rem, 6vw, 3.3rem); letter-spacing: -.045em; line-height: 1.08; }
h2 { margin: 0 0 .25rem; font-size: 1.13rem; }
p { margin: .45rem 0 1rem; }
header p:last-child, .hint, footer { color: var(--muted); }
.panel {
  padding: clamp(1rem, 4vw, 2rem); border: 1px solid var(--border); border-radius: 1.35rem;
  background: #1a1a1a; box-shadow: 0 1.1rem 3rem #0006;
}
form { margin: 0; }
section + section { margin-top: 1.4rem; padding-top: 1.4rem; border-top: 1px solid var(--border); }
.field { margin: .9rem 0; }
label { font-weight: 630; }
input[type=password] {
  display: block; width: 100%; padding: .72rem .85rem; margin: .35rem 0;
  border: 1px solid var(--border); border-radius: .65rem; background: #1e1e1e; color: inherit; font: inherit;
}
input[type=checkbox] { accent-color: #dc6ef8; width: 1rem; height: 1rem; margin: 0 .35rem 0 0; vertical-align: -.12rem; }
.choice { display: block; margin: .9rem 0; }
.badge { color: var(--muted); font-size: .8rem; font-weight: 500; }
button, .primary {
  display: inline-block; margin-top: .6rem; padding: .72rem 1.15rem; border: 0; border-radius: .7rem;
  background: #ffffff; color: #161616; font: inherit; font-weight: 750; text-decoration: none; cursor: pointer;
}
button:hover, .primary:hover { background: #eeeeee; }
a { color: var(--accent); text-underline-offset: .18em; }
:focus-visible { outline: 2px solid #dc6ef8; outline-offset: 3px; }
code {
  display: block; border: 1px solid var(--border); padding: .8rem;
  border-radius: .65rem; background: #1e1e1e; overflow-wrap: anywhere; user-select: all;
}
footer { margin-top: 1rem; font-size: .85rem; }
`;

export const settingsStyleHash = createHash('sha256').update(settingsStyle).digest('base64');
