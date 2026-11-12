# @ilkal/sdk

An infinite canvas you can embed in your own web app: shapes, text, sticky notes, frames, pen and
connectors, drawn on the GPU (WebGPU, or WebGL2 where WebGPU is missing). People and agents edit
it through the same commands.

**Version 0 is local only.** One person edits a board in the page. The board lives in memory, or
on the device in IndexedDB if you ask for that, and the SDK makes no network request beyond its
fonts (see [Fonts](#fonts)). Real-time collaboration comes in a later release.

## Install

```sh
npm install @ilkal/sdk react react-dom
```

React 19 is a peer dependency: your app brings its own `react` and `react-dom`.

## Quick start

```ts
import { mount } from '@ilkal/sdk';

const canvas = await mount(document.getElementById('board')!, {
  boardId: 'my-board',
  persistence: 'device', // keep it in IndexedDB; leave it out to keep the board in memory
  theme: 'system',
});

canvas.on('change', ({ created, updated, deleted }) => console.log(created, updated, deleted));

// When the element leaves the page:
canvas.destroy();
```

The board fills the element you give it, so give the element a size. Each `mount` is
independent: two canvases on one page share nothing.

To try it, `pnpm install`, then `pnpm --filter @ilkal/sdk sample:built`. It builds the SDK as
it is published, builds the sample page (`packages/sdk/sample/`) against that build as your own
bundler would, and serves it. The page is the quick start above and little else. Add
`?theme=dark` to its address to start in the dark theme, and `?persistence=device` to keep the
board across reloads. `pnpm --filter @ilkal/sdk sample` serves the same page from the SDK's
sources instead, for working on the SDK itself.

## The document

`canvas.document` reads the board and changes it. Every change is a command: the same commands
the editor's own tools use, checked against the board, applied in one undo step or refused whole.

```ts
const board = canvas.document; // not `document`, which is the page's

const [first] = board.objects(); // every object on the board
if (first !== undefined) {
  board.get(first.id); // one object, or undefined
  const outcome = board.run(
    'moveObjects',
    { moves: [{ id: first.id, by: { x: 40, y: 0 } }] },
    { origin: 'agent' },
  );
  if (outcome.status === 'rejected') console.warn(outcome.errors);
}
```

A command runs as the person at the board, or with `{ origin: 'agent' }` as the SDK's agent,
working for that person: undo takes an agent's change back as it does the person's own. Command
names and their inputs are typed.

## Events

`canvas.on(type, listener)` returns a function that stops listening.

- `change`: the objects created, updated and deleted, and who made the change.
- `selection`: the ids the person has selected, after each change.
- `error`: a failure from the board's storage or its rendering engine. Most leave the board
  running; an engine that fails to start leaves a board that cannot draw.

A listener added after `await mount` misses errors from the start, such as storage that fails to
open or an engine that fails to start. Pass `onError` to `mount` to receive those too. With no
`error` listener and no `onError`, errors go to the page's `reportError`.

## Theming

`theme` is `'light'`, `'dark'` or `'system'` (the default), and `canvas.setTheme()` changes it
while the board runs. The editor's toolbar and panels are set in Geist and Geist Mono, which ship
with the SDK. `chromeFonts` and `canvas.setChromeFonts()` set them in your own fonts instead.

## Fonts

The fonts a board draws text in, and Geist for its toolbar and panels, are a package of their own,
`@ilkal/fonts`, released with the SDK at the same version. A board loads only the faces its text
needs, from jsDelivr's copy of `@ilkal/fonts` at the SDK's version by default. To serve them
yourself, copy the package into your public folder and say where:

```sh
npm install @ilkal/fonts
cp -R node_modules/@ilkal/fonts/. public/fonts/
```

```ts
await mount(element, { fontsUrl: '/fonts/' });
```

Install the same version as `@ilkal/sdk`: the SDK asks for the files of its own version. The
fonts are under the SIL Open Font License 1.1, each with its licence beside it.

## API reference

Every export is documented in TSDoc. `pnpm run docs` builds the reference with TypeDoc into
`docs/api/`, and this repository publishes it to GitHub Pages at
[ilkal.dev/api](https://ilkal.dev/api/), beside the SDK's page (`site/`).

`SDK_API_VERSION` is the version of the public API. It goes up by one with every breaking change;
until 1.0, a minor release may make one, and the changelog says when.

## Developing

```sh
pnpm install
pnpm build
pnpm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute, including the DCO sign-off.

## Licence and trademark

The code is licensed under the [Apache License 2.0](LICENSE); [NOTICE](NOTICE) lists the
third-party software it bundles.

Ilkal™ is a trademark of Rudr Studio, Inc. The licence grants no right to use the name or the
logo: see [TRADEMARKS.md](TRADEMARKS.md) for what is allowed, such as "built with Ilkal".
