# DSH Plugin API Research — exact contracts for a dual-half plugin (dsh-ssf)

Research performed read-only against the installed packages under
`/root/.dsh/profiles/node_modules/@deepseek-ai/` (all `0.1.0-rc.6` unless noted), plus
the harness monorepo checkout at `/mnt/sdb1/deepseek-harness/` where noted.
Every identifier, signature, and field name below was quoted from compiled
`lib/*.js` / `lib/*.d.ts` / `cordis.patch.yml` / `package.json` files. Anything
that could not be determined is marked **UNKNOWN** — nothing is guessed.

---

## 1. TOOL REGISTRATION (host → model-facing `ctx.tools`)

### 1.1 Plugin module shape (Cordis plugin convention)

A tool plugin is a plain ESM module exporting `{ name, inject, Config, apply }`.
From `@deepseek-ai/dsh-tool-jobs/lib/index.js` (exact):

```js
const name = "tool-jobs";
const inject = ["tools", "jobs", "systemPrompt"];   // service names to wait for
const Config = z.object({                            // schemastery; becomes the row's config schema
  waitTimeoutMs: z.number().min(1).default(3e4),
  maxWaitTimeoutMs: z.number().min(1).default(6e5),
  completionDelivery: z.union(["quiet", "wakeup"]).default("wakeup"),
  maxConsecutiveWakes: z.number().min(1).default(3)
});
function apply(ctx, config) { ... ctx.tools.register(defineTool({ ... })) ... }
export { Config, apply, inject, name };
```

### 1.2 Registration API

`ctx.tools` is the `Tools` service (class in `dsh-tools/lib/index.js`). Registration is
`tools.register(definition)` (line 2755):

```js
register(definition) {
  const name = definition.name;
  const output = definition.output;
  if (output === void 0 || typeof output !== "object" || typeof output.render !== "function" || ...)
    throw new TypeError(`tool "${name}" must declare output { schema, render, presentationMeta? }`);
  assertSupportedJsonSchema(output.schema);
  if (name === "run_code") throw new Error(`tool name "${RUN_CODE_NAME}" is reserved ...`);
  return this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, definition), { label: "tools.register()" });
}
```

- `register()` returns the **exact disposer** that unregisters the tool (effect-scoped).
- Registration is layered: a scoped `agent.ctx` registers for that agent only; globals are registered from the plain context. Scoped tools shadow globals. `run_code` is reserved (Code-Mode transport).
- Related APIs: `tools.restrict({ allow?, deny? })` (scoped only, returns disposer), `tools.guard(guard)` (synchronous guard; a returned string denies execution — `(exec) => string | undefined`), `tools.presentAs(mode)` (scoped only).

### 1.3 `defineTool(options)` — the first-party definition factory (`dsh-tools/lib/index.js:836`)

Returns a registry-ready tool object `{ name, description, parameters, output, timeoutMs?, execute, finalizeContent?, presentCall?, presentResult?, isConcurrencySafe? }`:

```js
function defineTool(options) {
  // options: {
  //   name, description,
  //   parameters: { fieldName: { type, required, description, enum?, ... } },  // spec, compiled to JSON Schema
  //   output: { schema: <JSON Schema subset>, render(args, value) -> content blocks, presentationMeta?(args, value) },
  //   timeoutMs?,                       // positive finite number
  //   execute(args, exec) -> Promise<JSON value>,   // result validated against output.schema
  //   finalizeContent?(exec, result), presentCall?(args), presentResult?(args, result), isConcurrencySafe?(args)
  // }
}
```

Concrete usage from `dsh-tool-jobs` (three tools, `job_output` / `job_list` / `job_kill`):

```js
ctx.tools.register(defineTool({
  name: "job_output",
  description: "Read a background job. ...",
  parameters: {
    job_id: { type: "string", required: true, description: "..." },
    wait:   { type: "boolean", description: "..." },
    timeout_ms: { type: "number", description: "..." }
  },
  finalizeContent: finalizeTaskContent,
  output: {
    schema: { type: "object", additionalProperties: false,
      properties: {
        text: { type: "string", required: true },
        job:  { ...PUBLIC_TASK_SCHEMA, required: true } } },
    render: (_args, value) => [{ type: "text", text: `${value.text}\n${statusLine(value.job)}` }]
  },
  async execute(args, exec) {
    const id = validateJobId(args.job_id);
    if (args.wait === true) await ctx.jobs.wait(id, timeout, exec.agent, exec.signal);
    return { text: read.text, job: publicJob(read.snapshot) };   // plain JSON, must match output.schema
  },
  presentCall: (args) => ({ card: "generic", title: `...`, kind: "read", rawInput: args.job_id })
}));
```

### 1.4 JSON Schema subset for `parameters` and `output.schema`

Enforced by `assertSupportedJsonSchema` (`dsh-tools/lib/index.js:321`). Supported keywords only:
`type` (single string: `object|array|string|number|integer|boolean|null`), `oneOf` (≥2 branches, no
sibling constraint keywords), `properties`, `required`, `additionalProperties` (boolean), `items`,
`enum`, `const`, plus annotations `description`, `title`, `default`, `examples`. Anything else
throws `JsonSchemaError` (`UNSUPPORTED_SCHEMA`). Type arrays are rejected.

### 1.5 The `exec` object passed to `execute(args, exec)`

Built by `createExecution` (`dsh-tools/lib/index.js:3007`):

```js
{ token, callId, rootCallId, name, signal /* AbortSignal */,
  agent?,   // owning live agent (undefined for process-global calls)
  parent?,  // token when this is a nested sub-dispatch
  arguments: <deepFrozen snapshot of args>,   // lossless-JSON required
  deferContext(context), concludeTurn() }
```

### 1.6 Tool result contract

`execute` returns a **plain JSON value** (object/array/scalar) matching `output.schema`. The
pipeline normalizes it (frozen, lossless) into the canonical result:

```js
// success (materializeFinalResult, line 3447):
{ isError: false, value, content: [{ type: "text", text }], meta?, additionalContexts?, concludesTurn? }
// error (toolErrorResult, line 3472):
{ isError: true, error: { message, info? }, content: [{ type: "text", text: `Error: ${message}` }] }
```

- `content` comes from `output.render(args, value)` (a content-block array, e.g. `[{type:"text", text}]`).
- Wrong-typed args throw `ToolArgsError` (`INVALID_ARGS`); output failing the schema throws `ToolOutputError`.

### 1.7 Execution pipeline hooks

- `tools/pre-execute` waterfall gate: listeners may return `{ kind: "allow" }` (default) or
  `{ kind: "ask", reason? }` (routes through user approval). Registered via `ctx.waterfall(scope, "tools/pre-execute", exec, ...)` (line 3098).
- `tools/post-execute` waterfall decides acceptance of the result (line 3360).
- `ctx.on("tools/pre-execute", (exec, next) => { ...; return next(); }, { prepend: true })` is how `tool-jobs`
  intercepts calls (line 179).

### 1.8 Declaring the tool plugin in `cordis.patch.yml`

Rows are list items under `- insert:`; config keys are exactly the `Config` schema fields.
Example from `dsh-base/cordis.patch.yml` and `dsh-web-app/cordis.patch.yml`:

```yaml
- insert:
    - id: tool-jobs
      name: '@deepseek-ai/dsh-tool-jobs'
      # config keys accepted: waitTimeoutMs, maxWaitTimeoutMs, completionDelivery, maxConsecutiveWakes
    - id: tool-fs-search
      name: '@deepseek-ai/dsh-tool-fs-search'
      config:
        sampleOverCapGlobResults: false
    - id: tools                      # the tools service row itself
      name: '@deepseek-ai/dsh-tools'
      config:
        mode: !!js process.env.DSH_TOOLS_MODE   # native | code | both (tools-row config)
    - id: tool-bash
      name: '@deepseek-ai/dsh-tool-bash'
      disabled: !!js process.platform === 'win32'
```

---

## 2. SESSION PROJECTION (host provider → browser UI)

### 2.1 Host registration API — `ctx.sessionProjections`

Service class `SessionProjectionRegistry` (`dsh-session-projection/lib/index.js:37`), installed as
`ctx.sessionProjections` (Cordis `Service`). It subscribes once to the host event
`ctx.on("session/event", (session, event) => this.drive(session, event))`.

```ts
// lib/types/index.d.ts (exact)
export interface ProjectionDefinition<K extends keyof SessionProjectionMap, S> {
  key: K;                              // its SessionProjectionMap entry
  schema: ZodType<SessionProjectionMap[K]>;   // validates the wire payload (view output)
  init(): S;                           // state for the empty log
  apply(state: S, event: SessionEvent): S;    // PURE; must return the SAME reference for uninteresting events (Object.is gate)
  view(state: S): SessionProjectionMap[K];    // state → wire payload
  stateVersion: number;                // non-negative int; persisted-cache invalidation version
}

register<K, S>(definition: ProjectionDefinition<K, S>): () => void;   // disposer; effect-scoped, ref-counted per key
onChanged(listener: ProjectionChangeListener): () => void;            // (session, key, value, seq) => void
snapshot(session): ProjectionSnapshot;                                // { asOfSeq, values: Partial<SessionProjectionMap> }
checkpoint(session): ProjectionCheckpoint;  // { key: { ver, seq, val } } — durable cache rows
restore(checkpoint, events, baseSeq): { snapshot, checkpoint };
viewCheckpoint(checkpoint): Partial<SessionProjectionMap>;
restoreFloor(checkpoint): number | undefined;
```

Registration is an effect (disposer rides the calling fiber). Register **conditionally** via
`ctx.inject(["sessionProjections"], ...)` so headless assemblies without the registry are unaffected.

Real example — `@deepseek-ai/dsh-goal` (lib/index.js:519–531):

```js
ctx.inject(["sessionProjections"], (projectionCtx) => {
  projectionCtx.sessionProjections.register({
    key: "goal",
    schema: goalProjectionSchema,
    init: () => null,
    apply: applyGoalProjection,
    view: (state) => state,
    stateVersion: 4
  });
});
```

`applyGoalProjection(state, event)` (line 376): `if (event.type !== "goal/change") return state;`
then decodes `event.data` and returns the next whole value (or the same reference). Domain plugins
write the underlying event with `agent.session.append("goal/change", change)` (dsh-goal line 782) —
**whole-value events only** (a state-carrying event must carry the complete post-change state).

The type table is a merge-extensible interface — new keys are added by declaration merging
(`dsh-session-projection/lib/types/types.d.ts`):

```ts
export interface SessionProjectionMap {}   // domain packages merge their key here
```

Second example: `@deepseek-ai/dsh-session-stats` registers `key: "sessionStats"` with
`inject = ["sessionProjections"]`.

### 2.2 Wire / host side: how the value reaches the browser

`dsh-host-apiproxy/lib/index.js` (line ~1845) bridges the change feed to the mux stream:

```js
ctx.inject(["sessionProjections"], (projectionCtx) => {
  projectionCtx.sessionProjections.onChanged((session, key, value, seq) => {
    broadcast({ type: "session/projection", sessionId: session.id, key, value, seq });
  });
});
```

Client-side transport frames (`dsh-host-apiproxy`, literal union): `session/event`,
`session/subscribed`, `session/queue`, `session/jobs`, `session/projection`.
History tail pages carry a `projections` baseline block `{ asOfSeq, values }`
(`ProjectionsBaseline`, `dsh-client-runtime/lib/types/client/sessions/projection-store.d.ts`).

### 2.3 Client side: reading the projection

`dsh-client-runtime` `ProjectionValueStore` (per session; `session.projections`):

```ts
faceOf(key: string): ObservableSnapshot<unknown>;   // identity-stable per key; absence = undefined snapshot
get(key: string): unknown;
values(): Readonly<Partial<SessionProjectionMap>>;
subscribeAny(listener: () => void): () => void;
apply(key: string, value: unknown, seq: number): void;  // session/projection frame path, higher-seq-wins
seed(baseline: ProjectionsBaseline): void;              // tail-page block
truncate(lastSeq: number): void;
```

React binding — `dsh-client-web-react/lib/index.js`:

```js
function bindSnapshotSelector(w) {           // uSES bridge; the ONE hook constructor
  const subscribe = (fn) => w.subscribe(fn);
  const getSnapshot = () => w.getSnapshot();
  return function useSelector(sel, eq) { return useSyncExternalStoreWithSelector(subscribe, getSnapshot, void 0, sel, eq); };
}
// framework seat (standard kit, line 94-103, 430):
function projectionHook(info) {
  return (key, selector, eq) =>
    observableHook(info.projections?.faceOf(key) ?? absentSource)(selector ?? ((v) => v), eq);
}
standard["useProjection"] = projectionHook(info);   // injected into every slot entry's standard kit
```

Typed hook (`dsh-client-runtime/lib/types/client/sessions/projection-store.d.ts`):

```ts
type UseProjection = {
  <K extends keyof SessionProjectionMap>(key: K): SessionProjectionMap[K] | undefined;
  <K, S>(key: K, selector: (value: SessionProjectionMap[K] | undefined) => S, eq?: (a: S, b: S) => boolean): S;
};
```

Consumer example — `dsh-client-ui-goal/lib/client.js` (browser half):

```js
function GoalDock({ useProjection, onEdit, onPause, onResume, onClear, t }) {
  const projection = useProjection("goal");     // whole projected value, undefined = capability absent
  return <GoalBar goal={projection === void 0 ? void 0 : projection === null ? null : projection.goal} ... />;
}
// imperative CAS read:
const projection = sessions.binding(sessionId)?.session.projections.faceOf("goal")?.getSnapshot();
// mutations through Typert Remotes:
await ctx.remote.goals.edit(sessionId, ref, { objective });   // ref = { id, revision }
```

The UI plugin registers its dock into the conversation input dock slot:

```js
const inject = ["slots", "sessions", "remote", "remote.goals", "locale", "conversationEvents"];
function apply(ctx) {
  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock", id: "goal", order: 10, locale: NS,
    inject: (sessionId) => ({ onEdit: async (objective) => { ... await ctx.remote.goals.edit(sessionId, ref, { objective }) } })
  }, GoalDock));
}
```

Other client framework pieces referenced: `SessionRuntime` (`dsh-client-runtime`, root sessions
service `ctx.sessions` — list store with `current`, per-session Agent scope tree, stable
`SessionBinding` cache, `binding(sessionId)`); `useInvoke(fn)` from `dsh-client-web-react`:
`useInvoke(fn: () => Promise<unknown>): [invoke: () => void, pending: boolean]`.

### 2.4 Host session-event vocabulary

Driving event: `session/event` `(session, event)`; domain events live in the session log.
`KNOWN_SESSION_EVENT_TYPES` (`dsh-session/lib/types/known-event-types.js`, generated) includes:
`agent-preset/selected`, `approval/asked|decided|policy`, `assistant/chunk|message`,
`command/done|run`, `compaction/*`, `feedback/record`, `goal/change`, `hook/*`, `llm/*`,
`permission/preset`, `plan/mode`, `request/*`, `sandbox/mode`, `schedule/change`, `session/*`,
`step/start|end`, `subagent/descriptor`, `todo/write`, `tool-workflow/*`, `tool/call`,
`tool/code-dispatch*`, `tool/result`. Unknown (out-of-repo) event types are refused by the
persistence read path unless the envelope carries the `ignorable` marker.

---

## 3. SETTINGS TAB (client plugin registers a settings section)

### 3.1 The slot: `settings.section`

Settings sections are entries of the **list slot `settings.section`** (kind `"list"`, scope
`"root"`). It is declared as a child of the `sidebar.settings` entry by
`dsh-client-ui-settings-general`, which also renders the section list from the ledger:

```js
// dsh-client-ui-settings-general/lib/client.js (apply, lines 540-599)
ctx.slots.inject("sidebar.settings", () => ctx.slots.register({
  name: "sidebar.settings",
  children: {
    "settings.trigger":   { kind: "single", scope: "root" },
    "settings.header":    { kind: "single", scope: "root" },
    "settings.action":    { kind: "list",   scope: "root" },
    "settings.close":     { kind: "single", scope: "root" },
    "settings.section":   { kind: "list",   scope: "root" },   // <-- sections live here
    "settings.onboarding":{ kind: "list",   scope: "root" }
  },
  inject: shellInjected
}, SettingsRoot));

// registering one section (the General tab):
ctx.slots.inject("settings.section", () => ctx.slots.register({
  name: "settings.section",
  id: "general", order: 0,
  label: () => t("general.nav"),
  locale: NS,
  children: { "settings.general.item": { kind: "list", scope: "root" } }
}, GeneralSection));
```

Section-row reading API used by the shell: `ctx.slots.entries("settings.section")`,
`ctx.slots.subscribe("settings.section", listener)`, `ctx.slots.getVersion("settings.section")`,
and `resolveSlotLabel(entry.options.label)` from `@deepseek-ai/dsh-client-ui-slots`.

Example of a feature-owned tab — `dsh-client-ui-settings-plugins` registers
`settings.section` id `"plugins"` (order 15) with child tabs `settings.plugins.tab`
(`kind: "list"`) whose items are `settings.plugin.item` cards (`id: "bash"|"agent-loop"|"web-search"`).

### 3.2 Settings namespace API — host side

Host service `ctx.settings` (`dsh-settings/lib/index.js`, abstract `SettingsProvider`):

```js
// register(ns, schema, options) -> owner scope; ns must match lowercase-kebab (settingsNamespace())
settings.register(ns, schema, options)  // options: { base?, applies?: "live", validate? }
// returns { get(): resolved, watch(cb): disposer, update(patch), replace(section) }
```

Real example — `dsh-agent-presets/lib/index.js:856`:

```js
this.settings = settingsCtx.settings.register(settingsNamespace(SETTINGS_NAMESPACE),
  AgentPresetSettingsSchema, { base: { default: config.default } });
```

Commit event: `settings/updated`. Describe (wire): `describe(options)` → one descriptor per
registered namespace `{ ns, revision, base, user, value, schema }`.

### 3.3 Settings namespace API — client side

`dsh-client-ui-settings` provides `ctx.settingsScope` (`SettingsScopeBinder`); features bind a
namespace scope:

```js
// dsh-client-ui-settings-plugins/lib/client.js:1152
const bash = new BashCardController(ctx.settingsScope.bind({ namespace: "shell" }));
// controller: { getSnapshot(), subscribe(listener), set(field, value), unset(field), load() }
```

Wire contract (via `connection.api.settings`):
- `settings.describe({})` → `{ namespaces: [{ ns, revision, base, user, value, schema }], writable }`
- `settings.mutate({ ns, ops: [{ op: "set"|"unset", path: [field], value? }], expectedRevision? })` —
  writes carry the last-known revision; `SettingsConflictError` on stale revision.

### 3.4 Minimal sketch — one settings tab + one namespace

```js
// client.js (browser half)
const inject = ["slots", "locale", "settingsScope"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register("ssf", { zh: {...}, en: { nav: "SpecFlow" } }));
  const scope = ctx.settingsScope.bind({ namespace: "ssf" });   // must match host register() ns
  const useSnapshot = bindSnapshotSelector(scope);              // from dsh-client-web-react
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section", id: "ssf", order: 30,
    label: () => ctx.locale.bind("ssf")("nav"), locale: "ssf",
    inject: () => ({ useSnapshot })
  }, SsfSection));
}
```

Host half registers the same namespace:

```js
// index.js (host half)
ctx.inject(["settings"], (s) => {
  s.settings.register(settingsNamespace("ssf"), z.object({ /* fields */ }), {});
});
```

---

## 4. LOADER ROW (`cordis.patch.yml` / `cordis.yml` entry schema)

### 4.1 Row fields (from `cordis-plugin-loader/lib/index.js`, `Entry`/`EntryTree`)

A loader row is a free-form YAML object; only these keys carry loader semantics:

| Key | Meaning |
|---|---|
| `id` | optional; auto-generated (`Math.random().toString(16).slice(2,10)`) if missing; nested ids joined with `:` (`EntryTree.sep`). Duplicate ids in one group throw. |
| `name` | the import specifier (see 4.2). Imported via `EntryTree.import()` (line 260). |
| `config` | passed verbatim as the plugin's config; `!!js` YAML expressions evaluated against the loader ctx (`interpolate`/`evaluate`, lines 279-294); deep-merged with the previous layer's row by `id` (patch semantics — a patch **replaces the whole `config`** of a targeted row). |
| `inject` | string array of service names; resolved via `Inject.resolve(entry.options.inject, fiber.inject)` at fiber creation (line 699). |
| `disabled` | boolean **or** `!!js` expression evaluated against loader ctx (`disabledOf`, lines 367-369); a disabled parent entry disables children. |
| `group` | boolean; mounts a nested `EntryGroup` whose children live under the entry (used by `cordis-plugin-group`). |
| `isolate` | map `serviceName → label | true` (entry-local or named realm isolation, lines 578-650). |
| `intercept` | map installed on the entry context's `Context.intercept` (line 625). |
| `path` / `exports` | **UNKNOWN — no such row keys exist.** There is no `path` or `exports` field on a row; the `name` specifier alone determines what is imported. |

`- insert:` is the YAML key that appends new rows to the current layer:

```yaml
- insert:
    - id: my-tool
      name: '@scope/my-tool'
      config: { someKey: true }
    - id: existing-row      # rows outside insert: patch/disable by id
      disabled: true
```

### 4.2 What `name` may point to (local file path / package subpath)

`EntryTree.import(name)` (line 260):

```js
if (name.startsWith("cordis:")) return builtins[name.slice(7)];
else if (this.ctx.loader.internal) return await this.ctx.loader.internal.import(name, this.ctx.baseUrl, {});
else if (name.startsWith(".")) return await import(new URL(name, this.ctx.baseUrl).href);   // relative file, .ts→.js rewritten
else return await import(name);                                                             // bare specifier incl. subpath
```

- **Relative file path**: `name: "./some/dir/plugin.js"` — resolved against the Loader's
  `baseUrl`, which is the **profile directory** (`/root/.dsh/profiles/web/` for the web profile;
  anchored in `dsh-app-boot` and `dsh/lib/profile-boot-*.js`: “the Loader's `baseUrl` is the profile directory”).
- **Bare package name or subpath**: Node ESM resolution, so `name: '@deepseek-ai/dsh-web-app/startup'`
  works because `dsh-web-app` exports `"./startup": { types, default: "./lib/startup.js" }`.
  A local (non-installed) package like `spec-superflow` resolves **only if** it is reachable via
  Node resolution from the profile (installed under `/root/.dsh/profiles/node_modules/` or the
  flat fallback dir) **or** the row uses a `.`-relative path. A subpath such as
  `spec-superflow` → `spec-superflow/dist/index.js` needs the package to declare that subpath in
  its `exports` map and be resolvable.

### 4.3 `dsh.client` rows vs host rows

There is **no distinct row kind**. The `dsh.client` distinction is made by the **target
package's `package.json`**, scanned by the node half of `dsh-client-modules`
(`lib/index.js`, `ClientModuleRegistry`):

```js
// per loader entry (by entry.options.name), read the package's package.json:
dsh: { client: { platform: "web", inject?: string[], immediately?: boolean } }
// + exports["./client"] -> bundle path (string or { default })
```

`processOne(entryName)` (line 281) qualifies an entry iff a live loader entry with that name
exists (`entry.fiber !== void 0 && !entry.disabled`), then `resolveMeta` reads the package
manifest: `dsh.client.platform !== "web"` or a missing `exports["./client"]` → not a client
package (cached negative). Qualified packages get a graph row and a bundle rev:

```js
graphRow(id, rev, injectEdges, immediately) {
  return { id, url: `/plugins/${id}/client.js?rev=${rev}`, rev,
           ...(injectEdges ? { inject: injectEdges } : {}),
           ...(immediately ? { immediately: true } : {}) };
}
```

The composed graph is injected into `index.html` as `window.__DSH_BOOT__` =
`{ rev, entries: [...] }` (first script in `<head>`, `<` escaped). The route
`GET /plugins/<id>/client.js` (+ `client.js.map`) is served by the modules node half
(`serveBundle`, line 313; `cache-control: no-cache`).

Browser-side parse contract (`dsh-client-modules/lib/client.js`, `parseBootManifest`): every
entry must carry string `id`/`url`/`rev`; optional string-array `inject`, boolean `immediately`.

---

## 5. DUAL-HALF (dual-face) PACKAGE structure

### 5.1 The static dual-face pattern (`exports["./client"]` + `dsh.client`)

Every installed dual-face package (`dsh-client-modules`, `dsh-client-connection`,
`dsh-client-hmr`, `dsh-client-ui-*`) follows the same `package.json` shape
(quoted from `dsh-client-modules/package.json`):

```json
{
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".":        { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./invariant": { "types": "./lib/types/invariant.d.ts", "default": "./lib/invariant.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "dsh": { "client": { "platform": "web", "inject": [], "immediately": true } },
  "files": ["lib/index.js", "lib/invariant.js", "lib/client.js", "lib/types/**/*.d.ts"]
}
```

- **Host half** = `lib/index.js` (the row's `name` imports this; a Cordis plugin or a Service).
- **Browser half** = `lib/client.js` (the built bundle). It is *not* an ESM module: it is a
  self-registering CJS factory —

```js
window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-client-ui-goal",      // graph id = package name
  factory: (require) => { /* ... var module = {exports:{}}; ... */ return module.exports; }
});
```

- Executing the script only **registers** the factory (`window.__ModuleLoader__.load`).
  Materialization (`factory(require) → exports`) is lazy and memoized
  (`ClientModuleSystem.materialize`); CSS is injected at materialization as
  `<style data-plugin="<id>" data-plugin-css="<id>/X.module.css">`. Cross-plugin value imports
  are forbidden (bundle purity gate) — collaboration goes through cordis services.
- The node half (`ClientModuleRegistry`) scans the Loader, serves the bundle at
  `/plugins/<id>/client.js?rev=<hash>`, injects `window.__DSH_BOOT__`, and provides the
  `clientModules` service (`static inject = ["webServer", "loader"]`; needs `ctx.baseUrl`).
- The kernel (`dsh-client-modules/lib/client.js` `apply`) enrolls the system as
  `ctx.modules` (`ctx.reflect.provide("modules", modules)`) using `globalThis.__DSH_MODULES__`.

### 5.2 The `dsh-cordis-*-runner` pair — dynamic dual-half packages (a separate mechanism)

`dsh-cordis-host-runner` / `dsh-cordis-client-runner` implement *model-defined* dual-half
packages (not the static pattern above): the host half runs in a `node:vm` sandbox
(`ctx.dynamicCordisRunner`, `define`/`run`/`runHostHalf`/`getClientCode`/`stop`/`inventory`/`invoke`),
and the browser half is delivered as source through the `cordis/request-run` /
`cordis/request-run-resolved` / `dynamicCordisRunner/package` / `dynamicCordisRunner/retract`
forwarded events, then evaluated as an async closure in the page (React + `styles` + `host`
symbol surface, guarded `apply`). This is what the **dsh-ssf** design should *not* use unless the
goal is model-authored plugins; for a shipped plugin package use the §5.1 static dual-face form.

### 5.3 Bundle manifests

`dsh-base` and `dsh-web-app` declare their patch files via the `dsh.bundle.patch` manifest field
and export them:

```json
"exports": { "./cordis.patch.yml": "./cordis.patch.yml" },
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

Profile `package.json` lists bundles in `dsh.profile.bundles` (composed as patches in order,
then the profile's own `cordis.patch.yml`, then `--patch` overlays).

---

## 6. CLIENT BUILD / DEV (how client bundles are built and hot-reloaded)

### 6.1 `pnpm run dev:web` — what it rebuilds

Not defined in any installed package (`dsh-web-frontend/package.json` scripts are only
`build`/`dev`/`watch`, all vite). It lives at the harness monorepo root
`/mnt/sdb1/deepseek-harness/package.json`:

```json
"dev:web": "tsx scripts/dev-web.ts --poll"
```

`scripts/dev-web.ts` (read in the checkout): **tsdown watch build over every package whose
`package.json` carries `dsh.client.platform === "web"`** (`discoverPluginDirs()` globs
`packages/*/*/package.json`), emitting each package's `lib/client.js`. It does **not** rebuild
the shell. The script's own doc: “runs every `dsh.client` plugin package through the tsdown JS
API in watch mode. Reload signaling is not this script's business — the host webserver stat-polls
the bundles it serves and broadcasts `rebuilt` frames itself.” `--poll[=ms]` switches the source
watcher to polling (default 500 ms) for network mounts.

### 6.2 HMR chain (`dsh-client-hmr`)

- Node half: one interval stat-polls every graph bundle from a synchronous baseline, calls
  `ctx.clientModules.rebuilt(id)` on real rev changes, and serves the dev SSE channel
  `GET /plugins/events` (frames: `graph`, `rebuilt`).
- Browser half subscribes to that SSE channel and per `rebuilt` frame runs, in order:
  `invalidate` → `prefetch` (load+register the new bundle while the old fiber still serves) →
  `registry.delete` → drain the old fiber → remove owned `<style data-plugin>` tags →
  `entry.refresh()` re-imports/remounts → `fiber.await()` rethrows startup failures.
- Dependents cascade through cordis fiber activation epochs (no client-side graph analysis).
- Known limits (from README): reload is coarse (React state inside the plugin is lost), no
  failure rollback, graph `rev` is not refreshed by rebuilt frames (harmless: bundle endpoint is
  `no-cache`).

### 6.3 Production build path

From `/mnt/sdb1/deepseek-harness/package.json`:

```json
"build":       "npm run build:lib && npm run build:web",
"build:lib":   "npm run build:lib:host && npm run build:lib:client",
"build:lib:host":   "tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host",
"build:lib:client": "tsc -b tsconfig.client.json && tsdown --env.DSH_BUILD_FACE client",
"build:web":   "pnpm --filter @deepseek-ai/dsh-web-frontend run build"   // vite build -> dist/
```

- `dsh-web-frontend` (`apps/web`): `vite build` → `dist/` (package `exports: { "./dist/*": "./dist/*" }`, `files: ["dist", "!dist/**/*.map"]`).
- Served by `@deepseek-ai/dsh-host-frontend-static` (function plugin, `Config = z.object({ distIndex: z.string().required() })`), which claims the webserver's single fallback seat: traversal outside dist is 403, any miss falls back to `index.html` (HTTP 200, SPA routing), non-GET/HEAD is 405; every index response runs the webserver's index taps (boot-manifest injection).
- `distIndex` is an assembly fact, never user config — `dsh-web-app/lib/index.js`:

```js
function resolveDistIndex() {
  const require = createRequire(import.meta.url);
  return require.resolve("@deepseek-ai/dsh-web-frontend/dist/index.html");  // throws: "run pnpm run build from the repository root first"
}
// apply():
ctx.plugin(FrontendStatic, { distIndex: internals.resolveDistIndex() });
```

- `dsh-web-app` also exports a subpath `"./startup"` used as a row (`- id: web-startup,
  name: '@deepseek-ai/dsh-web-app/startup'`) providing `webStartup` (host/port from CLI flags).

### 6.4 Empty user patch layer (`/root/.dsh/profiles/web/`)

- `cordis.yml` — `[]` with the comment: “Edit cordis.patch.yml, not this file. The tree is
  composed as patches: each bundle in package.json's `dsh.profile.bundles`, then
  `cordis.patch.yml`, then any `--patch` overlays.”
- `cordis.patch.yml` — currently `[]` with: “a top-level YAML array of loader patch entries
  (id-targeted config overrides, disables, and insert lists; `!!js` expressions allowed).”
- `package.json` — `{ "name": "dsh-profile-web", "dependencies": {}, "dsh": { "profile":
  { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } } }`.

Exact YAML row format expected there (from the shipped bundles, quoted verbatim shapes):

```yaml
# 1) disable an existing row by id (config/name untouched)
- id: hmr
  disabled: true
# 2) override config wholesale (the whole `config` of the base row is replaced)
- id: session-query-sqlite
  config:
    path: ':memory:'
    openAt: never
# 3) insert new rows
- insert:
    - id: my-plugin
      name: '@scope/my-plugin'            # or './relative/path.js' or 'pkg/subpath'
      config:
        key: value
      inject: [someService]               # optional
      disabled: false                     # optional; !!js expressions allowed
```

A deployment adding a new dual-half plugin adds one row here for the host half
(`name` → the package, or a `.`-relative path) plus, if the package declares
`dsh.client`/`exports["./client"]`, the client-modules scan picks it up automatically as a
browser entry (no separate row needed).

---

## Cross-cutting facts useful for dsh-ssf implementation tasks

- Host plugin exports: `{ name, inject, Config, apply(ctx, config) }`; `Config` is a
  schemastery `z.object` (defaults become the row's config schema).
- `inject` (host): array of service names to wait for; conditional services use
  `ctx.inject(["service"], (subCtx) => { ... })`.
- Browser plugin exports: `{ apply(ctx), inject: [...] }` (module-level `inject` declares
  services in the browser fiber; package-level `dsh.client.inject` drives boot-graph edges).
- Client slot registration: `ctx.slots.inject("<parent-slot>", () => ctx.slots.register({
  name: "<slot>", id?, order?, label?, locale?, inject?, children? }, Component))`; entries
  receive the standard kit (`useSession`, `useProjection`, `t`, `useStore`/`actions`,
  session-scoped hooks) plus their `inject` props.
- Client services live under `ctx.remote.<ns>` (Typert-generated, e.g. `remote.goals`,
  `remote.settings`); forwarded host events arrive via `ctx.remote.$on("<event>", handler)`.
- All `dsh.client`-declared packages are built by `tsdown` (face `client`) into
  `lib/client.js`; node halves by `tsc` + tsdown (face `host`).

## Sources

Installed packages (compiled artifacts, all under `/root/.dsh/profiles/node_modules/@deepseek-ai/`):
`dsh-tools/lib/index.js`, `dsh-tool-jobs/lib/index.js`, `dsh-session-projection/lib/index.js` +
`lib/types/index.d.ts` + `lib/types/types.d.ts`, `dsh-goal/lib/index.js`,
`dsh-session/lib/types/known-event-types.js`, `dsh-session-stats/lib/index.js`,
`dsh-client-modules/lib/index.js` + `lib/client.js` + `package.json`,
`dsh-client-runtime/lib/types/client/sessions/{projection-store,session,service}.d.ts` +
`lib/client.js`, `dsh-client-web-react/lib/index.js` + `lib/types/{bind,use-invoke}.d.ts`,
`dsh-client-ui-goal/lib/client.js`, `dsh-client-ui-settings/lib/client.js`,
`dsh-client-ui-settings-general/lib/client.js`, `dsh-client-ui-settings-plugins/lib/client.js`,
`dsh-settings/lib/index.js`, `dsh-agent-presets/lib/index.js`,
`cordis-plugin-loader/lib/index.js`, `dsh-client-connection/package.json`,
`dsh-client-hmr/lib/index.js` + `README.md`, `dsh-cordis-host-runner/README.md`,
`dsh-cordis-client-runner/README.md`, `dsh-host-frontend-static/README.md` + `lib/index.js`,
`dsh-web-app/lib/index.js` + `package.json` + `cordis.patch.yml`,
`dsh-base/cordis.patch.yml`, `dsh-web-frontend/package.json`,
`/root/.dsh/profiles/web/{cordis.yml,cordis.patch.yml,package.json}`,
harness checkout `/mnt/sdb1/deepseek-harness/package.json` + `scripts/dev-web.ts`.
