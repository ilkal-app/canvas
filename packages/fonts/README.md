# @ilkal/fonts

## Purpose

The font files the SDK (`@ilkal/sdk`) loads, as a package of their own: the text
fonts a board lays text out in (the font library, the script coverage faces and the CJK slices)
and the chrome's Geist faces. The SDK's own package carries none of them. Both are released
together, at the same version.

A mounted board loads them, only the faces its text needs, from the SDK's `fontsUrl`. By default
that is jsDelivr's copy of this package at the SDK's version,
`https://cdn.jsdelivr.net/npm/@ilkal/fonts@<version>/`. A host that serves the files itself copies
this package's folders into its public folder and gives that folder as `fontsUrl`:

```sh
cp -R node_modules/@ilkal/fonts/. public/fonts/
```

```ts
await mount(element, { fontsUrl: '/fonts/' });
```

Install the version that matches the SDK's: the SDK asks for the files of its own version.

## Public API

The package is files; its one export is the check its build runs on them.

- `FONT_FOLDERS`, `unknownFolders`: The folders the font files sit in (each listed in package.json's `files`), and the top folders of the SDK's font files that none of them is, which fail the build.

Each file sits at the path the SDK asks for it by, relative to `fontsUrl`:

- `app/…`: the fonts kept in the shell's `assets/fonts/`, at the same paths (`app/library/<family>/<face>.ttf`, `app/script-coverage/…`, `app/cjk/<region>/…`, `app/Geist-Regular.woff2`, …).
- `engine/…`: the engine's default face, Liberation Sans.
- `npm/…`: a font taken from an npm package, under its package name (none today).

## Depends on

Nothing at run time. Its build copies the SDK's build output, so `@ilkal/sdk` is a dev
dependency, which orders the builds.

## How to test

`pnpm --filter @ilkal/sdk build`, then `pnpm --filter @ilkal/fonts build` fills the package.
`pnpm vitest --project @ilkal/fonts` runs the folder check's tests. `specs/sdk/sdk-built-sample.spec.ts`
mounts the built sample and serves its font requests from this package's files.

## Design notes

The SDK's build (`packages/sdk/scripts/font-files.ts`) names each font file the bundle asks for
by its path here, under the scheme `canvas-sdk-font:`, and emits every one, with the licence files
in its folder, into the SDK's `dist/fonts/`, which the SDK's own package leaves out. The build
fails when a name in any script it emits, the workers' included, has no file, or when two files
would share a path. `scripts/build-fonts.ts` copies that folder here as it is, replacing an
earlier copy, and fails on a top folder package.json's `files` does not list. At run time the SDK
resolves each name against `fontsUrl` before the page fetches it
(`setFontFileResolver` in `@canvas/app`).

The paths carry no content hash: the version in the URL pins the files, and a host's copy is
replaced with the package. Each font is under the SIL Open Font License 1.1, its licence text
beside it (`NOTICE`).

**Size**: jsDelivr serves packages up to 150 MB and files up to 20 MB by default (its README's
"Restrictions"). This package is about 115 MB unpacked (1,097 TrueType faces, 4 WOFF2 faces and
their licences); its largest file, the colour emoji face, is 5 MB. Past 150 MB it would split into
packages by coverage.
