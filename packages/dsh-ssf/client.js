// packages/dsh-ssf/client.js — browser half of the dsh-ssf dual-half plugin
//
// Hand-written self-registering bundle (the DSH browser contract, see
// dsh-client-ui-goal/lib/client.js): window.__ModuleLoader__.load registers a
// lazy CJS factory; shared modules (react, ...) resolve via the browser module
// table's require. No build step, no JSX. The tab is read-only: it fetches
// the snapshot from GET /dsh-ssf/snapshot and polls for freshness (decoupled
// from the 'ssf' settings namespace, see dsh-plugin-omoslim's
// /dsh-plugin-omoslim/subagent-models pattern).
//
// Task ownership: 3.1 skeleton + slot registration; 3.3 pure formatting helpers
// (kept inline here — the browser module table does not resolve relative
// requires — with a mirrored ESM copy in client/format.js for node tests);
// 3.2 list/detail/empty rendering. Fetch path GET /dsh-ssf/snapshot returns
// { changes, workspaces, scannedAt, bindings } (host lib/index.js); the
// frontend also accepts a bare workspaces array for compatibility.
//
// Conversation ↔ flow binding: the host binds a flow to the conversation
// that executes it (snapshot.bindings[sessionId] = { workspace, change,
// boundAt }). A bound tab renders ONLY its bound flow; an unbound tab keeps
// the workspace-scoped list view.
window.__ModuleLoader__.load({
	id: "dsh-ssf",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		let react = require("react");

		// ---- pure formatting helpers (mirror of client/format.js) ----
		function formatChangeList(scan) {
			if (!Array.isArray(scan)) return [];
			const rank = { closing: 2, abandoned: 2 };
			return [...scan].sort((a, b) => {
				const ra = rank[a.state] ?? 1;
				const rb = rank[b.state] ?? 1;
				if (ra !== rb) return ra - rb;
				return String(a.name).localeCompare(String(b.name));
			});
		}

		function formatWorkspaces(scan) {
			if (!Array.isArray(scan)) return [];
			return [...scan]
				.filter((w) => w && Array.isArray(w.changes))
				.map((w) => ({
					path: w.path,
					workspace: w.workspace || w.path,
					changes: formatChangeList(w.changes),
				}))
				.sort((a, b) => String(a.workspace).localeCompare(String(b.workspace)));
		}

		function formatChangeDetail(item) {
			if (!item) return [];
			const rows = [];
			const raw = item.raw;
			if (raw) {
				for (const key of [
					"dp_0_decisions", "dp_0_result", "dp_1_result", "dp_2_result",
					"dp_3_result", "dp_4_result", "dp_5_result", "dp_6_result", "dp_7_result",
				]) {
					const value = raw[key];
					if (value !== undefined && value !== null && value !== "") {
						rows.push([key, String(value)]);
					}
				}
				const last = raw.last_transition;
				if (last !== undefined && last !== null && last !== "") {
					rows.push(["last_transition", String(last)]);
				}
			} else {
				rows.push(["stateFileMissing", item.stateFileMissing ? "true" : "false"]);
				if (item.parseError) rows.push(["parseError", item.parseError]);
			}
			return rows;
		}

		function changeKey(workspace, name) {
			return `${workspace}::${name}`;
		}

		function normalizePath(p) {
			return String(p || "").replace(/[\\/]+$/, "");
		}

		const ENDPOINT = "/dsh-ssf/snapshot";

		/**
		 * Fetch the ssf snapshot from the host endpoint. Throws on HTTP error.
		 * Mirrors dsh-plugin-omoslim's fetchModels error handling.
		 * @returns {Promise<object>} parsed JSON snapshot
		 */
		async function fetchSnapshot() {
			const res = await fetch(ENDPOINT, { headers: { "Cache-Control": "no-store" } });
			let json = null;
			try {
				json = await res.json();
			} catch {
				json = null;
			}
			if (!res.ok) {
				if (json && json.error) throw new Error(json.error);
				throw new Error("HTTP " + res.status);
			}
			return json;
		}

		// ---- "Spec 工作流" conversation tab ----
		const h = react.createElement;
		const styles = {
			wrap: { padding: "12px 16px", fontFamily: "inherit", fontSize: "13px" },
			empty: { color: "var(--dsw-alias-label-tertiary, #999)" },
			list: { listStyle: "none", margin: 0, padding: 0 },
			item: {
				padding: "6px 8px", borderRadius: "6px", cursor: "pointer",
				borderBottom: "1px solid var(--dsw-alias-border-l1, #eee)",
			},
			itemSelected: {
				background: "var(--dsw-alias-fill-soft, #f0f0f0)",
				borderRadius: "6px",
			},
			workspace: {
				padding: "8px 0 4px", fontWeight: 600, marginTop: "6px",
				borderTop: "1px solid var(--dsw-alias-border-l1, #eee)",
			},
			detail: { marginTop: "10px", padding: "8px 10px", border: "1px solid var(--dsw-alias-border-l1, #eee)", borderRadius: "6px" },
			row: { margin: "4px 0", wordBreak: "break-all" },
		};

		function SsfTab({ sessionId, sessionsList }) {
			const [snapshot, setSnapshot] = react.useState(null);
			const [error, setError] = react.useState(null);
			const [, setTick] = react.useState(0);
			const [selectedKey, setSelectedKey] = react.useState(null);

			// Re-render when the session list refreshes (cwd/workspace can arrive after the view mounts).
			react.useEffect(() => {
				if (sessionsList && typeof sessionsList.subscribe === "function") {
					return sessionsList.subscribe(() => setTick((t) => t + 1));
				}
			}, [sessionsList]);

			// Poll the snapshot endpoint for freshness. Keep the last snapshot on failure.
			react.useEffect(() => {
				let cancelled = false;
				let timer = null;

				async function load() {
					try {
						const data = await fetchSnapshot();
						if (!cancelled) {
							setSnapshot(data);
							setError(null);
						}
					} catch (e) {
						if (!cancelled) {
							setError(e && e.message ? e.message : String(e));
						}
					}
				}

				load();
				timer = setInterval(load, 3000);

				function onVisibility() {
					if (document.visibilityState === "visible") load();
				}
				document.addEventListener("visibilitychange", onVisibility);

				return () => {
					cancelled = true;
					if (timer !== null) clearInterval(timer);
					document.removeEventListener("visibilitychange", onVisibility);
				};
			}, []);

			const payload = snapshot;
			const rawWorkspaces = payload ? (payload.workspaces ?? payload) : undefined;
			const workspaces = formatWorkspaces(rawWorkspaces);
			const cwd = sessionsList?.getSnapshot?.().byId?.[sessionId]?.cwd;
			// Conversation ↔ flow binding: the flow executed in this conversation.
			const binding = payload && payload.bindings ? payload.bindings[sessionId] : null;
			const boundWorkspace = binding
				? workspaces.find((w) => normalizePath(w.path) === normalizePath(binding.workspace))
				: null;
			const boundChange = boundWorkspace
				? boundWorkspace.changes.find((c) => c.name === binding.change)
				: null;

			// Keep the bound flow's detail selected as the binding changes. Must
			// run before every early return so hook order stays stable.
			react.useEffect(() => {
				if (binding) setSelectedKey(changeKey(binding.workspace, binding.change));
			}, [binding ? binding.workspace : null, binding ? binding.change : null]);

			// Bound view: render only the flow bound to this conversation.
			if (binding && boundWorkspace && boundChange) {
				const boundKey = changeKey(boundWorkspace.workspace, boundChange.name);
				const boundWithWs = { ...boundChange, workspace: boundWorkspace.workspace, path: boundWorkspace.path };
				const boundRows = [["workspace", boundWithWs.workspace], ["name", boundWithWs.name], ["state", boundWithWs.state], ["workflow", boundWithWs.workflow]]
					.concat(formatChangeDetail(boundWithWs));
				return h("div", { style: styles.wrap },
					h("div", { style: styles.workspace }, `📁 ${boundWorkspace.workspace} — 已绑定本对话`),
					h("ul", { style: styles.list },
						h("li", {
							key: boundKey,
							style: { ...styles.item, ...styles.itemSelected },
						}, `${boundChange.name} — ${boundChange.state} (${boundChange.workflow})`)),
					h("div", { style: styles.detail },
						boundRows.map(([k, v]) =>
							h("p", { key: k, style: styles.row },
								h("strong", null, `${k}: `), String(v)))));
			}

			// A binding whose flow vanished (deleted change / workspace gone)
			// falls back to the workspace view with a notice.
			const staleNotice = binding
				? h("p", { style: styles.empty }, `绑定的流程 ${binding.change} 已不存在，已回落到工作区视图`)
				: null;

			// Only show the CURRENT session's workspace flows.
			const current = workspaces.find((w) => normalizePath(w.path) === normalizePath(cwd));

			const changes = current ? current.changes : [];
			if (!current || changes.length === 0) {
				return h("div", { style: styles.wrap }, staleNotice,
					h("p", { style: styles.empty }, "未发现变更或投影不可用；在对话中执行 SSF 流程（调用 ssf_* 工具）后将自动绑定到本对话"));
			}

			const list = h("ul", { style: styles.list }, changes.map((c) => {
				const key = changeKey(current.workspace, c.name);
				return h("li", {
					key,
					style: key === selectedKey ? { ...styles.item, ...styles.itemSelected } : styles.item,
					onClick: () => setSelectedKey(key),
				}, `${c.name} — ${c.state} (${c.workflow})`);
			}));

			const selected = changes.find((c) => changeKey(current.workspace, c.name) === selectedKey) ?? null;
			const selectedWithWs = selected ? { ...selected, workspace: current.workspace, path: current.path } : null;
			const detailRows = selectedWithWs
				? [["workspace", selectedWithWs.workspace], ["name", selectedWithWs.name], ["state", selectedWithWs.state], ["workflow", selectedWithWs.workflow]]
					.concat(formatChangeDetail(selectedWithWs))
				: [];
			const detail = selectedWithWs
				? h("div", { style: styles.detail },
					detailRows.map(([key, value]) =>
						h("p", { key, style: styles.row },
							h("strong", null, `${key}: `), String(value))))
				: null;

			return h("div", { style: styles.wrap }, staleNotice,
				h("div", { style: styles.workspace }, `📁 ${current.workspace}`),
				list, detail);
		}

		function apply(ctx) {
			// Chat-interface tab: show only the current workspace's flows. The
			// settings-page section is intentionally removed.
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "ssf",
				order: 20,
				label: () => "Spec 工作流",
				inject: (sessionId) => ({
					sessionsList: ctx.sessions?.list,
				}),
			}, SsfTab));
		}

		exports.apply = apply;
		exports.inject = ["slots", "locale", "sessions"];

		return module.exports;
	},
});
