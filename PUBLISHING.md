# Publishing

`firecrawl-convex` is published to npm as a public package. Every command below
exists in `package.json` — if you change one, change the other.

## Before the first publish

1. `npm login` with an account that can publish `firecrawl-convex`.
2. Make sure a Convex deployment is configured (`npx convex dev` once). Codegen
   needs one, and `npm run build:clean` runs codegen.
3. The repository must be public before submitting to the Convex Components
   directory — its review reads the GitHub repo, not the npm tarball.

## Release checklist

```sh
npm ci                  # install exactly what the lockfile pins
npm run build:clean     # clean, regenerate component code, rebuild dist/
npm run verify          # build + test + typecheck + lint
npm pack                # inspect the tarball
```

Then sanity-check the tarball against a throwaway app, which catches broken
`exports` maps that nothing else will:

```sh
mkdir /tmp/fc-consumer && cd /tmp/fc-consumer
npm init -y && npm install convex ../path/to/firecrawl-convex-*.tgz
# add a convex/convex.config.ts that does app.use(firecrawl), then:
npx convex dev --once
```

All four entry points should resolve: the package root, `./convex.config`,
`./_generated/component`, and `./test`.

Finally:

```sh
npm publish --access public
git tag v0.1.0 && git push --follow-tags
```

## Lifecycle scripts

These run automatically; you rarely invoke them directly.

| Script | When it runs | What it does |
| --- | --- | --- |
| `prepare` | after `npm install`, and on publish | `npm run build` |
| `prepublishOnly` | before `npm publish` | `npm run clean && npm run build`, so a stale `dist/` can never ship |
| `preversion` | before `npm version` | `npm ci`, clean codegen build, test, lint, typecheck |
| `version` | during `npm version` | opens `CHANGELOG.md` for the new heading, formats, stages it |

`prepublishOnly` deliberately skips codegen so publishing works without a
configured deployment. `preversion` is the gate that regenerates component code
— which is why releases go through `npm run alpha` / `npm run release` rather
than a bare `npm publish`.

## Subsequent releases

```sh
npm run alpha     # prerelease under the @alpha tag, publish, push tags
npm run release   # patch version, publish as latest, push tags
```

For a minor or major bump:

```sh
npm version minor   # or major
npm publish
git push --follow-tags
```

## One-off tarball

```sh
npm run clean && npm run build && npm pack
```

Hand someone the `.tgz` and they can `npm install ./firecrawl-convex-x.y.z.tgz`.
