// packages/dsh-ssf/client.js — browser half of the dsh-ssf dual-half plugin
//
// Hand-written self-registering bundle (the DSH browser contract, see
// dsh-client-ui-goal/lib/client.js): window.__ModuleLoader__.load registers a
// lazy CJS factory; shared modules (react, ...) resolve via the browser module
// table's require. No build step, no JSX. The tab is read-only: it renders the
// snapshot the host pushes into the 'ssf' settings namespace.
//
// Task ownership: 3.1 skeleton + scope bind + slot registration; 3.3 pure
// formatting helpers (kept inline here — the browser module table does not
// resolve relative requires — with a mirrored ESM copy in client/format.js for
// node tests); 3.2 list/detail/empty rendering.
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

		// ---- "Spec 工作流" settings section ----
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
			detail: { marginTop: "10px", padding: "8px 10px", border: "1px solid var(--dsw-alias-border-l1, #eee)", borderRadius: "6px" },
			row: { margin: "4px 0", wordBreak: "break-all" },
		};

		function SsfSection({ scope }) {
			// Re-render when the host pushes a new snapshot.
			const [, setTick] = react.useState(0);
			react.useEffect(() => {
				if (!scope) return undefined;
				return scope.subscribe(() => setTick((t) => t + 1));
			}, [scope]);
			const [selectedName, setSelectedName] = react.useState(null);

			const snapshot = scope ? scope.getSnapshot() : undefined;
			const changes = formatChangeList(snapshot && snapshot.changes);
			const selected = changes.find((c) => c.name === selectedName) ?? null;

			if (changes.length === 0) {
				return h("div", { style: styles.wrap },
					h("p", { style: styles.empty }, "未发现变更或投影不可用"));
			}

			const list = h("ul", { style: styles.list }, changes.map((c) =>
				h("li", {
					key: c.name,
					style: c.name === selectedName ? { ...styles.item, ...styles.itemSelected } : styles.item,
					onClick: () => setSelectedName(c.name),
				}, `${c.name} — ${c.state} (${c.workflow})`)));

			const detailRows = selected
				? [["name", selected.name], ["state", selected.state], ["workflow", selected.workflow]]
					.concat(formatChangeDetail(selected))
				: [];
			const detail = selected
				? h("div", { style: styles.detail },
					detailRows.map(([key, value]) =>
						h("p", { key, style: styles.row },
							h("strong", null, `${key}: `), String(value))))
				: null;

			return h("div", { style: styles.wrap }, list, detail);
		}

		function apply(ctx) {
			const scope = ctx.settingsScope.bind({ namespace: "ssf" });
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "ssf",
				order: 30,
				label: () => "Spec 工作流",
				inject: () => ({ scope }),
			}, SsfSection));
		}

		exports.apply = apply;
		exports.inject = ["slots", "locale", "settingsScope"];

		return module.exports;
	},
});
