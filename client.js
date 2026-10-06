/**
 * dsh-image-gen — the panel card for the drawing tool.
 *
 * The card contributes the form alone: the Plugins page has already drawn the
 * title and asks for `view: 'page'`. It reads and writes through the settings
 * form face (`getSnapshot` / `subscribe` / `set` / `unset`), whose writes are
 * queued against the host revision — so the readback after saving is the only
 * authority on what landed.
 *
 * Configuration is a list of drawing **groups**, each holding a list of
 * **models** with a note per model. The whole list is one field, so a group is
 * added, edited or removed in a single write and a half-edited group can never
 * be persisted on its own. A group folds, and folded is the default; which ones
 * are open is remembered in this browser rather than in the profile, so folding
 * never dirties the form.
 */
window.__ModuleLoader__.load({
    id: "dsh-image-gen",
    factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;

        Object.defineProperty(exports, "__esModule", { value: true });

        const React = require("react");

        /** Settings namespace and profile entry id. */
        const NAMESPACE = "image-gen";
        /** Slot key and module-loader id: the bundle package name. */
        const PACKAGE_NAME = "dsh-image-gen";
        /** Where this browser remembers which groups are open. */
        const FOLD_KEY = `${PACKAGE_NAME}.expanded`;

        //#region copy

        const zh = {
            "header": "绘图 (generate_image)",
            "header.hint": "每一组是一套独立的端点 + 密钥 + 模型清单。清单里的说明会写进工具描述，模型据此自己挑分组和模型。",
            "field.enabled": "启用绘图工具",
            "field.defaultGroup": "默认分组（仅在不指定时使用）",
            "field.defaultGroup.hint": "只影响「没写 group 也没写 model」的调用。每个分组都能被单独点名使用 —— 选它不会禁用别的分组。",
            "field.timeoutMs": "绘图超时 (ms)",
            "field.baseURL": "端点 Base URL",
            "field.apiKey": "API 密钥",
            "field.models": "模型清单",
            "field.models.hint": "每行一个模型：左边 ID，右边写「什么情况下选它」。这些说明会直接给到模型。",
            "field.size": "默认尺寸",
            "field.size.hint": "WIDTHxHEIGHT，例如 1024x1024、2560x1440。",
            "field.quality": "quality",
            "field.responseFormat": "response_format",
            "field.outputDir": "另存目录",
            "field.outputDir.hint": "绝对路径；留空则图片只作为附件返回。",
            "field.protocol": "协议",
            "field.protocol.openai": "OpenAI 兼容",
            "field.protocol.google": "Google AI Studio",
            "group.auto": "自动（第一个有密钥的分组）",
            "group.name": "分组名",
            "group.add": "＋ 添加分组",
            "group.remove": "移除",
            "group.untitled": "分组 {n}",
            "group.none": "还没有分组，点下面的按钮加一个。",
            "group.on": "启用",
            "group.off": "停用",
            "group.summary": "{models} 个模型 · {state}",
            "group.keyed": "已填密钥",
            "group.unkeyed": "缺密钥",
            "group.fold": "展开或折叠这一组",
            "model.id": "模型 ID",
            "model.note": "说明（给模型看）",
            "model.add": "＋ 添加模型",
            "model.default": "默认",
            "model.none": "还没有模型，加一个才能出图。",
            "preset.label": "快速填入",
            "preset.openai": "OpenAI",
            "preset.gemini": "Gemini 出图",
            "preset.imagen": "Imagen",
            "action.save": "保存",
            "action.saving": "保存中…",
            "action.discard": "放弃修改",
            "action.clear": "清空全部",
            "action.armed": "再次点击确认清空",
            "status.loading": "正在读取配置…",
            "status.unavailable": "当前 dsh 无法读写插件配置，请直接编辑配置文件的 image-gen 段。",
            "status.readonly": "配置为只读。",
            "error.save": "部分字段未能写入，请重试。",
            "dirty": "未保存",
            "summary.ready": "绘图已就绪（{groups} 组 / {models} 个模型）",
            "summary.key": "缺少密钥",
            "summary.off": "绘图未启用",
            "active": "生效中",
            "inactive": "未启用",
            "usage.hint": "保存后立即生效：模型清单与说明会写进工具描述，模型据此选择分组、模型、尺寸与质量。",
        };

        const en = {
            "header": "Drawing (generate_image)",
            "header.hint": "Each group is its own endpoint, key and model list. A model's note is compiled into the tool description, so the agent picks the group and model itself.",
            "field.enabled": "Enable the drawing tool",
            "field.defaultGroup": "Default group (used when unspecified)",
            "field.defaultGroup.hint": "Only affects calls that name neither group nor model. Every group stays selectable by name — picking one disables nothing.",
            "field.timeoutMs": "Drawing timeout (ms)",
            "field.baseURL": "Endpoint Base URL",
            "field.apiKey": "API key",
            "field.models": "Models",
            "field.models.hint": "One model per row: id on the left, \"pick me when …\" on the right. These notes go straight to the model.",
            "field.size": "Default size",
            "field.size.hint": "WIDTHxHEIGHT, for example 1024x1024 or 2560x1440.",
            "field.quality": "quality",
            "field.responseFormat": "response_format",
            "field.outputDir": "Save-into directory",
            "field.outputDir.hint": "An absolute path; leave empty to return attachments only.",
            "field.protocol": "Protocol",
            "field.protocol.openai": "OpenAI-compatible",
            "field.protocol.google": "Google AI Studio",
            "group.auto": "Automatic (first group with a key)",
            "group.name": "Group name",
            "group.add": "+ Add group",
            "group.remove": "Remove",
            "group.untitled": "Group {n}",
            "group.none": "No groups yet — add one with the button below.",
            "group.on": "Enabled",
            "group.off": "Off",
            "group.summary": "{models} models · {state}",
            "group.keyed": "key set",
            "group.unkeyed": "no key",
            "group.fold": "Expand or fold this group",
            "model.id": "Model id",
            "model.note": "Note (for the model)",
            "model.add": "+ Add model",
            "model.default": "Default",
            "model.none": "No models yet — add one before it can draw.",
            "preset.label": "Quick fill",
            "preset.openai": "OpenAI",
            "preset.gemini": "Gemini image",
            "preset.imagen": "Imagen",
            "action.save": "Save",
            "action.saving": "Saving…",
            "action.discard": "Discard",
            "action.clear": "Clear all",
            "action.armed": "Click again to confirm",
            "status.loading": "Reading configuration…",
            "status.unavailable": "This dsh cannot read or write plugin configuration; edit the image-gen section of the profile config file instead.",
            "status.readonly": "Configuration is read-only.",
            "error.save": "Some fields were not written; please retry.",
            "dirty": "Unsaved",
            "summary.ready": "Drawing ready ({groups} groups / {models} models)",
            "summary.key": "No API key",
            "summary.off": "Drawing disabled",
            "active": "Active",
            "inactive": "Disabled",
            "usage.hint": "Takes effect as soon as it is saved: the model list and its notes are compiled into the tool description, so the agent picks the group, model, size and quality from them.",
        };

        const DICTS = { zh, en };

        /** The host's Language preference if it is loaded, else the browser's. */
        const useLang = (locale) => {
            const active = React.useSyncExternalStore(
                React.useCallback((listener) => locale?.subscribe(listener) ?? (() => { }), [locale]),
                React.useCallback(() => locale?.getSnapshot().active ?? null, [locale]),
            );
            if (active === "en" || active === "zh")
                return active;
            return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("en") ? "en" : "zh";
        };

        /** Look a key up in the active language, falling back to zh, then the key. */
        const translator = (language) => (key, params) => {
            const raw = DICTS[language]?.[key] ?? zh[key] ?? key;
            return params === undefined
                ? raw
                : raw.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
        };

        //#endregion

        //#region the form's shape

        /** Per-protocol defaults: what an empty field falls back to, and its placeholder. */
        const PROTOCOL_DEFAULTS = {
            openai: { baseURL: "https://api.openai.com/v1", size: "1024x1024", quality: "high", responseFormat: "url" },
            google: { baseURL: "https://generativelanguage.googleapis.com/v1beta", size: "1024x1024", quality: "", responseFormat: "" },
        };

        /** The notes the agent reads, written once for the seeds and the presets. */
        const NOTES = {
            "gpt-image-1": "默认。文字理解最好，能在图里写出准确的文字；支持 quality 与透明背景。",
            "dall-e-3": "更便宜更快，但只支持 1024x1024 / 1792x1024 / 1024x1792，且需要 response_format=url。",
            "gemini-2.5-flash-image": "默认。快，擅长按复杂描述合成与改图；尺寸按比例走（如 16:9）。",
            "imagen-4.0-generate-001": "写实照片风格更强，一次能出多张；不要在 prompt 里要求它画文字。",
        };
        const modelOf = (id) => ({ id, note: NOTES[id] });

        /** One-click "fill this group with this endpoint", each adding its own model. */
        const PRESETS = [
            { id: "preset.openai", values: { protocol: "openai", ...PROTOCOL_DEFAULTS.openai }, model: modelOf("gpt-image-1") },
            { id: "preset.gemini", values: { protocol: "google", ...PROTOCOL_DEFAULTS.google }, model: modelOf("gemini-2.5-flash-image") },
            { id: "preset.imagen", values: { protocol: "google", ...PROTOCOL_DEFAULTS.google }, model: modelOf("imagen-4.0-generate-001") },
        ];

        /**
         * The two groups a fresh install shows.
         *
         * The Host schema seeds the same pair; this copy exists so the card can
         * show a usable form before anything has ever been saved.
         */
        const SEED_GROUPS = [
            {
                id: "openai", name: "OpenAI", protocol: "openai", ...PROTOCOL_DEFAULTS.openai,
                models: [modelOf("gpt-image-1"), modelOf("dall-e-3")], defaultModel: "gpt-image-1",
            },
            {
                id: "google", name: "Google AI Studio", protocol: "google", ...PROTOCOL_DEFAULTS.google,
                models: [modelOf("gemini-2.5-flash-image"), modelOf("imagen-4.0-generate-001")], defaultModel: "gemini-2.5-flash-image",
            },
        ];

        /** The top-level controls; `kind` selects the control and the write encoding. */
        const SCALARS = [
            { field: "enabled", kind: "bool", label: "field.enabled", fallback: true },
            { field: "defaultGroup", kind: "choice", label: "field.defaultGroup", hint: "field.defaultGroup.hint", fallback: "" },
            { field: "timeoutMs", kind: "number", label: "field.timeoutMs", fallback: 600000 },
        ];

        /** The plain fields inside one group. */
        const GROUP_FIELDS = [
            { key: "baseURL", label: "field.baseURL" },
            { key: "apiKey", label: "field.apiKey", secret: true },
            { key: "size", label: "field.size", hint: "field.size.hint" },
            { key: "quality", label: "field.quality" },
            { key: "responseFormat", label: "field.responseFormat" },
            { key: "outputDir", label: "field.outputDir", hint: "field.outputDir.hint" },
        ];

        /** Every key of a group, so the form's shape and the written shape stay in step. */
        const GROUP_KEYS = ["id", "name", "baseURL", "apiKey", "defaultModel", "size", "quality", "responseFormat", "outputDir"];

        /** One model row as the form holds it. */
        const modelRow = (raw) => ({ id: String(raw?.id ?? ""), note: String(raw?.note ?? "") });

        /**
         * One group as the form holds it.
         *
         * Nothing is trimmed here: this shape backs the inputs, and stripping a
         * space on every keystroke would make a space impossible to type in a
         * name. `canonicalGroups` is the shape written and compared.
         */
        const groupRow = (raw, index) => {
            const row = { enabled: raw?.enabled !== false, protocol: raw?.protocol === "google" ? "google" : "openai" };
            for (const key of GROUP_KEYS)
                row[key] = String(raw?.[key] ?? "");
            row.id = row.id.trim() || `group-${index + 1}`;
            row.models = (Array.isArray(raw?.models) ? raw.models : []).map(modelRow);
            return row;
        };

        /** The exact shape written, and the only shape compared. */
        const canonicalGroups = (list) => (Array.isArray(list) ? list : []).map(groupRow).map((row) => {
            const out = { enabled: row.enabled, protocol: row.protocol, models: row.models
                .map((model) => ({ id: model.id.trim(), note: model.note.trim() }))
                .filter((model) => model.id !== "") };
            for (const key of GROUP_KEYS)
                out[key] = row[key].trim();
            out.name = out.name || out.id;
            return out;
        });

        /** A control's value in the type it is compared in. */
        const typed = (field, value) => (field.kind === "bool"
            ? value !== false
            : field.kind === "number"
                ? (value === "" || value === undefined || value === null ? undefined : Number(value))
                : String(value ?? ""));

        const storedScalar = (field, snapshot) => typed(field, snapshot.value?.[field.field] ?? field.fallback);
        /** What a control shows: the draft while it is being edited, else what the host holds. */
        const shownScalar = (field, drafts, snapshot) => drafts[field.field] ?? storedScalar(field, snapshot);
        const scalarDirty = (field, drafts, snapshot) => {
            const draft = typed(field, drafts[field.field]);
            return drafts[field.field] !== undefined && draft !== undefined && draft !== storedScalar(field, snapshot);
        };
        /** Encode one control's draft as a settings write. */
        const scalarWrite = (field, draft) => {
            if (field.kind === "bool")
                return { field: field.field, value: draft === true || draft === "true" };
            const value = typed(field, draft);
            return value === undefined || value === "" || Number.isNaN(value)
                ? { field: field.field, unset: true }
                : { field: field.field, value };
        };

        /** Whether a write landed, judged by the readback rather than the reply. */
        const landed = (write, snapshot) => {
            const raw = snapshot.value?.[write.field];
            if (write.unset)
                return raw === undefined || raw === null || raw === "";
            if (Array.isArray(write.value))
                return JSON.stringify(canonicalGroups(raw)) === JSON.stringify(write.value);
            const kind = typeof write.value === "boolean" ? "bool" : typeof write.value === "number" ? "number" : "text";
            return typed({ kind }, raw) === write.value;
        };

        //#endregion

        //#region view state

        /** This browser's store, or null where it is absent or blocked. */
        const store = () => {
            try {
                return window.localStorage ?? null;
            }
            catch {
                return null;
            }
        };

        /** The group ids left open; anything absent is folded, which is the default. */
        const readExpanded = () => {
            try {
                const parsed = JSON.parse(store()?.getItem(FOLD_KEY) ?? "null");
                return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
            }
            catch {
                return new Set();
            }
        };

        /** Remember which groups are open; a store that refuses only loses the memory. */
        const writeExpanded = (ids) => {
            try {
                store()?.setItem(FOLD_KEY, JSON.stringify([...ids]));
            }
            catch {
                // View state only: losing it must never break the form.
            }
        };

        //#endregion

        //#region styles

        const input = {
            height: 34, padding: "0 12px", font: "inherit", fontSize: 13, width: "100%",
            boxSizing: "border-box", borderRadius: 8, border: "1px solid var(--dsw-alias-border-l2)",
            background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", outline: "none",
        };
        const label = { fontSize: 12, color: "var(--dsw-alias-label-secondary)" };
        const hint = { fontSize: 11, color: "var(--dsw-alias-label-tertiary)", marginTop: 4, lineHeight: 1.5 };
        const column = { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 };
        const row = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" };
        const tag = {
            fontSize: 11, padding: "1px 7px", borderRadius: 999,
            border: "1px solid var(--dsw-alias-border-l2)", color: "var(--dsw-alias-label-tertiary)",
        };
        const box = {
            display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 12,
            border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-1)",
        };
        const fold = {
            font: "inherit", fontSize: 11, lineHeight: 1, width: 24, height: 24, padding: 0, flex: "0 0 auto",
            borderRadius: 6, cursor: "pointer", border: "1px solid var(--dsw-alias-border-l2)",
            background: "none", color: "var(--dsw-alias-label-secondary)",
        };
        const button = (primary) => ({
            font: "inherit", fontSize: 13, height: 32, padding: "0 14px", borderRadius: 8, cursor: "pointer",
            border: `1px solid var(--dsw-alias-${primary ? "brand-primary" : "border-l2"})`,
            background: primary ? "var(--dsw-alias-brand-primary)" : "none",
            color: primary ? "var(--dsw-alias-label-inverse, #fff)" : "var(--dsw-alias-label-primary)",
        });
        const chip = (on) => ({
            font: "inherit", fontSize: 11, padding: "3px 9px", borderRadius: 999, cursor: "pointer", background: "none",
            border: `1px solid var(--dsw-alias-${on ? "brand-primary" : "border-l2"})`,
            color: on ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-tertiary)",
        });
        /** Fade a control that cannot be used right now. */
        const off = { opacity: 0.4, cursor: "default" };

        //#endregion

        /**
         * The configuration card.
         *
         * `view: 'page'` is what the Plugins page asks for; `summary` is part of
         * the slot's contract and is answered in one line.
         */
        function ImageCard({ scope, locale, view }) {
            const language = useLang(locale);
            const t = React.useMemo(() => translator(language), [language]);
            const snapshot = React.useSyncExternalStore(
                React.useCallback((listener) => scope.subscribe(listener), [scope]),
                React.useCallback(() => scope.getSnapshot(), [scope]),
            );
            const [drafts, setDrafts] = React.useState({});
            const [expanded, setExpanded] = React.useState(readExpanded);
            const [busy, setBusy] = React.useState(false);
            const [armed, setArmed] = React.useState(false);
            const [failed, setFailed] = React.useState("");

            const storedGroups = (() => {
                const groups = canonicalGroups(snapshot.value?.groups);
                return groups.length > 0 ? groups : canonicalGroups(SEED_GROUPS);
            })();

            // Drop drafts the host has caught up with, so a save — or an edit made
            // in another tab — clears the dirty marks on its own.
            React.useEffect(() => {
                setDrafts((previous) => {
                    const next = {};
                    for (const [key, value] of Object.entries(previous)) {
                        if (key === "groups") {
                            if (JSON.stringify(canonicalGroups(value)) !== JSON.stringify(storedGroups))
                                next.groups = value;
                            continue;
                        }
                        const field = SCALARS.find((candidate) => candidate.field === key);
                        if (field !== undefined && scalarDirty(field, previous, snapshot))
                            next[key] = value;
                    }
                    return next;
                });
                // The snapshot is the only dependency: `storedGroups` derives from it.
                // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [snapshot]);

            const writable = snapshot.writable !== false;
            const disabled = busy || !writable;
            const groups = Array.isArray(drafts.groups) ? drafts.groups : storedGroups;
            const dirtyScalars = SCALARS.filter((field) => scalarDirty(field, drafts, snapshot));
            const dirty = JSON.stringify(canonicalGroups(groups)) !== JSON.stringify(storedGroups) || dirtyScalars.length > 0;
            const enabled = shownScalar(SCALARS[0], drafts, snapshot) === true;
            const keyed = groups.filter((group) => group.apiKey.trim() !== "");
            const modelCount = keyed.reduce((total, group) => total + group.models.length, 0);
            const summary = !enabled ? t("summary.off")
                : modelCount > 0 ? t("summary.ready", { groups: keyed.length, models: modelCount })
                    : t("summary.key");
            const hasStored = Object.keys(snapshot.user ?? {}).length > 0;

            //#region edits

            /** Every group list goes back through `groupRow`, so a draft always has the canonical keys. */
            const setGroups = (list) => setDrafts((previous) => ({ ...previous, groups: list.map(groupRow) }));
            const editGroup = (index, key, value) => setGroups(groups.map((group, at) => (at === index ? { ...group, [key]: value } : group)));
            const editModels = (index, change) => setGroups(groups.map((group, at) => (at === index ? { ...group, models: change(group.models) } : group)));
            const editModel = (index, rowIndex, key, value) => editModels(index, (models) => models.map((model, at) => (at === rowIndex ? { ...model, [key]: value } : model)));
            const addModel = (index) => editModels(index, (models) => [...models, { id: "", note: "" }]);
            /** Drop one model, and the group's default with it when they were the same. */
            const removeModel = (index, rowIndex) => setGroups(groups.map((group, at) => {
                if (at !== index)
                    return group;
                const gone = group.models[rowIndex];
                return {
                    ...group,
                    models: group.models.filter((_model, position) => position !== rowIndex),
                    defaultModel: gone !== undefined && group.defaultModel === gone.id ? "" : group.defaultModel,
                };
            }));

            const remember = (id, add) => setExpanded((previous) => {
                const next = new Set(previous);
                if (add)
                    next.add(id);
                else
                    next.delete(id);
                writeExpanded(next);
                return next;
            });

            const addGroup = () => {
                let number = groups.length + 1;
                while (groups.some((group) => group.id === `group-${number}`))
                    number += 1;
                const id = `group-${number}`;
                setGroups([...groups, {
                    id, name: t("group.untitled", { n: number }), enabled: true, protocol: "openai",
                    ...PROTOCOL_DEFAULTS.openai, apiKey: "", models: [], defaultModel: "", outputDir: "",
                }]);
                // The group just added is the one about to be edited, so open it.
                remember(id, true);
            };

            const removeGroup = (index) => {
                const gone = groups[index];
                setGroups(groups.filter((_group, at) => at !== index));
                // Forget the fold state of a group that no longer exists, so the
                // store cannot grow with ids that will never come back.
                if (gone !== undefined && expanded.has(gone.id))
                    remember(gone.id, false);
            };

            /**
             * Switch one group's protocol, moving its untouched defaults along.
             *
             * A leftover endpoint from the other protocol would send Google's key
             * to OpenAI or the reverse, which fails in a way that is hard to read off
             * the error, so a field still holding either protocol's default follows
             * the chip. A value the user typed is kept.
             */
            const pickProtocol = (index, protocol) => {
                const group = groups[index];
                const next = { ...group, protocol };
                for (const key of Object.keys(PROTOCOL_DEFAULTS[protocol])) {
                    const untouched = group[key] === ""
                        || Object.values(PROTOCOL_DEFAULTS).some((defaults) => defaults[key] === group[key]);
                    if (untouched)
                        next[key] = PROTOCOL_DEFAULTS[protocol][key];
                }
                setGroups(groups.map((entry, at) => (at === index ? next : entry)));
            };

            /**
             * Apply a quick-fill preset to one group.
             *
             * The endpoint fields are overwritten, but the preset's model is only
             * *added* when the list does not already have it: a group holding
             * hand-written models must not lose them to a stray click.
             */
            const applyPreset = (index, preset) => {
                const group = groups[index];
                const models = group.models.some((model) => model.id.trim() === preset.model.id)
                    ? group.models
                    : [...group.models, preset.model];
                setGroups(groups.map((entry, at) => (at === index
                    ? { ...entry, ...preset.values, models, defaultModel: preset.model.id }
                    : entry)));
            };

            //#endregion

            //#region saving

            const save = async () => {
                setBusy(true);
                setFailed("");
                const pending = dirtyScalars.map((field) => ({
                    field: field.field,
                    draft: drafts[field.field],
                    write: scalarWrite(field, drafts[field.field]),
                }));
                if (JSON.stringify(canonicalGroups(groups)) !== JSON.stringify(storedGroups))
                    pending.push({ field: "groups", draft: groups, write: { field: "groups", value: canonicalGroups(groups) } });

                try {
                    for (const item of pending) {
                        if (item.write.unset)
                            await scope.unset(item.field);
                        else
                            await scope.set(item.field, item.write.value);
                    }
                }
                catch (error) {
                    // A rejected write throws. Keep every draft so nothing typed is
                    // lost, and say what the host objected to.
                    setFailed(`${t("error.save")} ${error instanceof Error ? error.message : String(error)}`);
                    setBusy(false);
                    return;
                }
                // Otherwise the write swallows wire and revision failures and reloads
                // instead of throwing, so the host's readback is the only authority on
                // what landed.
                const after = scope.getSnapshot();
                const remaining = {};
                for (const item of pending) {
                    if (!landed(item.write, after))
                        remaining[item.field] = item.draft;
                }
                setDrafts(remaining);
                // Name the fields that did not land: the usual cause is a host half
                // older than this card, which rejects a field it does not declare.
                if (Object.keys(remaining).length > 0)
                    setFailed(`${t("error.save")} ${Object.keys(remaining).join(", ")}`);
                setBusy(false);
            };

            const clearAll = async () => {
                setArmed(false);
                setBusy(true);
                setFailed("");
                try {
                    for (const field of [...SCALARS.map((scalar) => scalar.field), "groups"])
                        await scope.unset(field);
                    setDrafts({});
                }
                catch (error) {
                    setFailed(`${t("error.save")} ${error instanceof Error ? error.message : String(error)}`);
                }
                setBusy(false);
            };

            //#endregion

            //#region rendering

            const dirtyTag = React.createElement("span", { style: { ...tag, fontSize: 10, marginLeft: 6 } }, t("dirty"));
            const mark = (field) => (dirtyScalars.includes(field) ? dirtyTag : null);

            /** One plain control inside a group. */
            const groupControl = (group, index, field) => React.createElement("div", { key: field.key, style: column },
                React.createElement("label", { style: label }, t(field.label)),
                React.createElement("input", {
                    type: field.secret === true ? "password" : "text",
                    autoComplete: field.secret === true ? "off" : undefined,
                    style: { ...input, ...(disabled ? { opacity: 0.6 } : {}) },
                    value: group[field.key],
                    disabled,
                    spellCheck: false,
                    placeholder: String(PROTOCOL_DEFAULTS[group.protocol][field.key] ?? ""),
                    onChange: (event) => editGroup(index, field.key, event.target.value),
                }),
                field.hint === undefined ? null : React.createElement("div", { style: hint }, t(field.hint)));

            /**
             * The model list of one group.
             *
             * The note beside each id is not decoration: it is compiled into the
             * tool description the agent reads, which is how a note written here
             * becomes a reason for the model to pick that model. The chip marks
             * which entry the group draws with when a call names no model.
             */
            const modelEditor = (group, index) => {
                const fallback = group.defaultModel !== "" && group.models.some((model) => model.id === group.defaultModel)
                    ? group.defaultModel
                    : (group.models[0]?.id ?? "");
                const rows = group.models.map((model, at) => React.createElement("div", { key: at, style: row },
                    React.createElement("input", {
                        type: "text", "aria-label": t("model.id"), spellCheck: false, disabled,
                        style: { ...input, width: 200, flex: "0 0 auto" },
                        value: model.id, placeholder: t("model.id"),
                        onChange: (event) => editModel(index, at, "id", event.target.value),
                    }),
                    React.createElement("input", {
                        type: "text", "aria-label": t("model.note"), spellCheck: false, disabled,
                        style: { ...input, flex: "1 1 240px" },
                        value: model.note, placeholder: t("model.note"),
                        onChange: (event) => editModel(index, at, "note", event.target.value),
                    }),
                    React.createElement("button", {
                        type: "button", disabled, title: t("model.default"),
                        style: chip(model.id !== "" && model.id.trim() === fallback),
                        onClick: () => editGroup(index, "defaultModel", model.id.trim()),
                    }, t("model.default")),
                    React.createElement("button", {
                        type: "button", disabled, title: t("group.remove"),
                        style: { ...chip(false), padding: "3px 7px" },
                        onClick: () => removeModel(index, at),
                    }, "✕")));
                return React.createElement("div", { style: column },
                    React.createElement("label", { style: label }, t("field.models")),
                    rows.length > 0 ? rows : React.createElement("div", { style: hint }, t("model.none")),
                    React.createElement("button", {
                        type: "button", disabled, style: chip(false), onClick: () => addModel(index),
                    }, t("model.add")),
                    React.createElement("div", { style: hint }, t("field.models.hint")));
            };

            /**
             * One group: a foldable header, then its fields.
             *
             * Folding is view state, never configuration: a folded group keeps
             * every value it had, and its header still says which endpoint, how
             * many models and whether it has a key.
             */
            const groupBox = (group, index) => {
                const folded = !expanded.has(group.id);
                const state = group.apiKey.trim() === "" ? t("group.unkeyed") : t("group.keyed");
                const head = React.createElement("div", { style: row },
                    React.createElement("button", {
                        type: "button", "aria-label": t("group.fold"), "aria-expanded": !folded,
                        title: t("group.fold"), style: fold, onClick: () => remember(group.id, folded),
                    }, folded ? "▸" : "▾"),
                    React.createElement("input", {
                        type: "text", "aria-label": t("group.name"), spellCheck: false, disabled,
                        style: { ...input, width: 170, flex: "0 0 auto" },
                        value: group.name, placeholder: t("group.name"),
                        onChange: (event) => editGroup(index, "name", event.target.value),
                    }),
                    React.createElement("span", { style: tag }, group.id),
                    folded ? React.createElement("span", { style: { ...hint, marginTop: 0 } },
                        t("group.summary", { models: group.models.length, state })) : null,
                    React.createElement("label", {
                        style: { ...label, display: "flex", alignItems: "center", gap: 6, cursor: disabled ? "default" : "pointer" },
                    }, React.createElement("input", {
                        type: "checkbox", checked: group.enabled, disabled,
                        onChange: (event) => editGroup(index, "enabled", event.target.checked),
                    }), t(group.enabled ? "group.on" : "group.off")),
                    React.createElement("button", {
                        type: "button", disabled,
                        style: { ...button(false), height: 26, padding: "0 10px", fontSize: 12, marginLeft: "auto" },
                        onClick: () => removeGroup(index),
                    }, t("group.remove")));

                if (folded)
                    return React.createElement("div", { key: group.id, style: box }, head);
                return React.createElement("div", {
                    key: group.id,
                    style: { ...box, ...(group.enabled ? {} : { opacity: 0.7 }) },
                },
                    head,
                    React.createElement("div", { style: row },
                        React.createElement("span", { style: label }, t("field.protocol")),
                        ...["openai", "google"].map((value) => React.createElement("button", {
                            key: value, type: "button", disabled, style: chip(group.protocol === value),
                            onClick: () => pickProtocol(index, value),
                        }, t(`field.protocol.${value}`)))),
                    React.createElement("div", { style: row },
                        React.createElement("span", { style: label }, t("preset.label")),
                        ...PRESETS.map((preset) => React.createElement("button", {
                            key: preset.id, type: "button", disabled, style: chip(false),
                            onClick: () => applyPreset(index, preset),
                        }, t(preset.id)))),
                    modelEditor(group, index),
                    ...GROUP_FIELDS.map((field) => groupControl(group, index, field)));
            };

            /** The three top-level controls. */
            const scalarControls = () => {
                const [enabledField, choiceField, timeoutField] = SCALARS;
                const current = String(shownScalar(choiceField, drafts, snapshot));
                const known = groups.some((group) => group.id === current || group.name === current);
                const edit = (field, value) => setDrafts((previous) => ({ ...previous, [field]: value }));
                return [
                    React.createElement("label", {
                        key: "enabled",
                        style: { display: "flex", alignItems: "center", gap: 8, cursor: disabled ? "default" : "pointer" },
                    },
                        React.createElement("input", {
                            type: "checkbox", checked: enabled, disabled,
                            onChange: (event) => edit("enabled", event.target.checked),
                        }),
                        React.createElement("span", { style: { fontSize: 13, color: "var(--dsw-alias-label-primary)" } }, t("field.enabled")),
                        mark(enabledField)),
                    React.createElement("div", { key: "defaultGroup", style: column },
                        React.createElement("label", { style: label }, t("field.defaultGroup"), mark(choiceField)),
                        React.createElement("select", {
                            style: { ...input, ...(disabled ? { opacity: 0.6 } : {}) }, value: current, disabled,
                            onChange: (event) => edit("defaultGroup", event.target.value),
                        },
                            React.createElement("option", { value: "" }, t("group.auto")),
                            ...groups.map((group) => React.createElement("option", { key: group.id, value: group.id },
                                group.name === group.id ? group.id : `${group.name} (${group.id})`)),
                            known || current === "" ? null : React.createElement("option", { value: current }, current)),
                        React.createElement("div", { style: hint }, t("field.defaultGroup.hint"))),
                    React.createElement("div", { key: "timeoutMs", style: column },
                        React.createElement("label", { style: label }, t("field.timeoutMs"), mark(timeoutField)),
                        React.createElement("input", {
                            type: "text", inputMode: "numeric", spellCheck: false, disabled,
                            style: { ...input, width: 160, ...(disabled ? { opacity: 0.6 } : {}) },
                            value: String(shownScalar(timeoutField, drafts, snapshot)),
                            onChange: (event) => edit("timeoutMs", event.target.value),
                        })),
                ];
            };

            if (view === "summary")
                return React.createElement("span", { style: hint }, summary);

            const body = [];
            if (snapshot.status === "loading")
                body.push(React.createElement("div", { key: "loading", style: hint }, t("status.loading")));
            if (snapshot.status === "unavailable")
                body.push(React.createElement("div", { key: "unavailable", style: hint }, t("status.unavailable")));
            if (!writable)
                body.push(React.createElement("div", { key: "readonly", style: hint }, t("status.readonly")));
            body.push(React.createElement("div", { key: "header", style: row },
                React.createElement("span", { style: { fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, t("header")),
                React.createElement("span", { style: tag }, t(enabled ? "active" : "inactive"))));
            body.push(React.createElement("div", { key: "hint", style: { ...hint, marginTop: 0 } }, t("header.hint")));
            body.push(...scalarControls());
            body.push(groups.length === 0
                ? React.createElement("div", { key: "no-groups", style: hint }, t("group.none"))
                : React.createElement(React.Fragment, { key: "groups" }, ...groups.map(groupBox)));
            body.push(React.createElement("div", { key: "add", style: row },
                React.createElement("button", {
                    type: "button", disabled, style: { ...button(false), ...(disabled ? off : {}) }, onClick: addGroup,
                }, t("group.add"))));
            body.push(React.createElement("div", { key: "actions", style: row },
                React.createElement("button", {
                    type: "button", disabled: disabled || !dirty,
                    style: { ...button(true), ...(disabled || !dirty ? off : {}) },
                    onClick: save,
                }, t(busy ? "action.saving" : "action.save")),
                React.createElement("button", {
                    type: "button", disabled: disabled || !dirty,
                    style: { ...button(false), ...(disabled || !dirty ? off : {}) },
                    onClick: () => { setDrafts({}); setFailed(""); },
                }, t("action.discard")),
                hasStored ? React.createElement("button", {
                    type: "button", disabled, style: { ...button(false), ...(disabled ? off : {}) },
                    onClick: () => (armed ? clearAll() : setArmed(true)),
                }, t(armed ? "action.armed" : "action.clear")) : null,
                dirty ? React.createElement("span", { style: { ...hint, marginTop: 0 } }, t("dirty")) : null,
                failed === "" ? null : React.createElement("span", { style: { ...hint, marginTop: 0 } }, failed)));
            body.push(React.createElement("div", { key: "usage", style: hint }, t("usage.hint")));

            return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 16 } }, ...body);

            //#endregion
        }

        /**
         * Put the form in the bundle's own configuration seat.
         *
         * `plugins.bundle.config` is keyed by the package name and its owner only
         * asks for `view: 'page'` — it has already drawn the title and crumb, so
         * the card contributes the form alone. `configForms` is reached through a
         * child fiber because it is not in the client service catalog; a bare
         * top-level `inject` naming it would leave this entry pending.
         */
        function apply(ctx) {
            let mounted;
            ctx.inject(["configForms"], (sctx) => {
                const scope = sctx.configForms.get(NAMESPACE);
                sctx.slots.inject("plugins.bundle.config", () => {
                    mounted = sctx.slots.register({
                        name: "plugins.bundle.config",
                        key: PACKAGE_NAME,
                        // `reflect.get` is the read that needs no `inject` entry: it
                        // returns undefined rather than throwing when no locale plugin
                        // is loaded.
                        inject: () => ({ scope, locale: sctx.reflect.get("locale") }),
                    }, ImageCard);
                    return () => {
                        mounted?.();
                        mounted = undefined;
                    };
                });
            });
            // The card is silent on success, so say why when nothing mounted at all.
            const timer = setTimeout(() => {
                if (mounted === undefined)
                    console.warn(`[${NAMESPACE}] no settings card mounted: this dsh provides no configForms service or declares no plugins.bundle.config slot.`);
            }, 5000);
            ctx.effect(() => () => {
                clearTimeout(timer);
                mounted?.();
            });
        }

        exports.inject = ["slots"];
        exports.apply = apply;

        return module.exports;
    },
});
