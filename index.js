/**
 * dsh-image-gen — the `generate_image` tool, configured from the Plugins panel.
 *
 * Configuration is a list of drawing **groups**: each is a complete endpoint of
 * its own (protocol, base URL, key, defaults) holding a list of **models**, and
 * each model carries a note written for the agent — "pick me when …". Those
 * notes are compiled into the tool's own description, so the catalogue the panel
 * shows is the catalogue the agent reads.
 *
 * A call names the group it wants and/or the model it wants. Naming a model that
 * another group lists routes the call to that group, so "group A's model" and
 * "group B's model" are both reachable without the caller tracking endpoints.
 * Naming both sends the named model to the named endpoint, listed or not.
 *
 * dsh already configures custom language models itself, so this plugin registers
 * no model route. Every field is volatile, so a panel save applies to the next
 * drawing without a restart.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Schema from '@deepseek-ai/schemastery';

/** The Loader entry id; it is also this plugin's settings namespace. */
export const name = 'image-gen';

/** The tool this plugin contributes to the agent's toolset. */
export const IMAGE_TOOL_NAME = 'generate_image';

/** The only raster formats the harness attachment store admits. */
const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const BASE_URL = {
    openai: 'https://api.openai.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta',
};
const DEFAULT_MODEL = { openai: 'gpt-image-1', google: 'gemini-2.5-flash-image' };
/** How each protocol is named in the tool description the agent reads. */
const PROTOCOL_NAME = {
    openai: 'OpenAI-compatible',
    google: 'Google AI Studio',
};

/**
 * The two groups a fresh install starts with, so the panel is never an empty
 * form and both protocols are one key away. Each note is written for the agent,
 * because that is what it reads while choosing.
 */
const SEED_GROUPS = [
    {
        id: 'openai',
        name: 'OpenAI',
        protocol: 'openai',
        quality: 'high',
        responseFormat: 'url',
        models: [
            { id: 'gpt-image-1', note: '默认。文字理解最好，能在图里写出准确的文字；支持 quality 与透明背景。' },
            { id: 'dall-e-3', note: '更便宜更快，但只支持 1024x1024 / 1792x1024 / 1024x1792，且需要 response_format=url。' },
        ],
        defaultModel: 'gpt-image-1',
    },
    {
        id: 'google',
        name: 'Google AI Studio',
        protocol: 'google',
        models: [
            { id: 'gemini-2.5-flash-image', note: '默认。快，擅长按复杂描述合成与改图；尺寸按比例走（如 16:9）。' },
            { id: 'imagen-4.0-generate-001', note: '写实照片风格更强，一次能出多张；不要在 prompt 里要求它画文字。' },
        ],
        defaultModel: 'gemini-2.5-flash-image',
    },
];

/**
 * The attribution header every provider request must carry.
 *
 * The harness package is reached through the boot interception layer, so it is
 * imported opportunistically: a plugin must not fail to load because that layer
 * changed shape, and the literal satisfies the same contract.
 */
let attribution = () => ({ 'user-agent': 'deepseek-harness/0.2.0 (+https://github.com/deepseek-ai/deepseek-harness)' });
try {
    const runtime = await import('@deepseek-ai/dsh-llm');
    if (typeof runtime.attributionHeaders === 'function')
        attribution = runtime.attributionHeaders;
}
catch {
    // Not installed in this deployment; the literal above is used instead.
}

/** Fail one request with the code the tool result reports. */
const fail = (message, code) => Object.assign(new Error(message), { name: 'ImageError', code });

const text = (value) => (typeof value === 'string' ? value.trim() : '');

//#region configuration

const modelField = Schema.object({
    id: Schema.string().default('').description('模型 ID，例如 gpt-image-1。Model id.'),
    note: Schema.string().default('').description('给模型看的说明：什么情况下选它。会写进工具描述。A note for the model: when to choose it.'),
});

const groupField = Schema.object({
    id: Schema.string().default('').description('分组标识，工具用它选中这一组。Group id a call can select this group by.'),
    name: Schema.string().default('').description('分组显示名。Display name.'),
    enabled: Schema.boolean().default(true).description('这一组是否可用。Whether this group can be used.'),
    protocol: Schema.string().default('openai').description('openai = 兼容 /images/generations；google = Google AI Studio。'),
    baseURL: Schema.string().default('').description('端点 Base URL，留空用该协议的默认值。Empty uses the protocol default.'),
    apiKey: Schema.string().default('').description('这一组的 API 密钥。API key for this group.'),
    models: Schema.array(modelField).default([]).description('这一组能出的模型清单，每个模型带一句给模型看的说明。Models this group can draw with, each with a note.'),
    defaultModel: Schema.string().default('').description('默认模型 ID；留空用清单里的第一个。Empty uses the first listed.'),
    size: Schema.string().default('').description('默认出图尺寸 WIDTHxHEIGHT，留空用 1024x1024。'),
    quality: Schema.string().default('').description('openai 协议的 quality，留空则不发送。quality for the openai protocol; empty omits it.'),
    responseFormat: Schema.string().default('').description('openai 协议的 response_format：url 或 b64_json，留空则不发送。'),
    outputDir: Schema.string().default('').description('另存目录(绝对路径)，留空则只作为附件返回。'),
});

/**
 * Every field is volatile, which is what lets a panel save rewrite the live
 * references instead of reloading the entry. The group list is one field, so a
 * whole group is added, edited or removed in a single write.
 */
export const Config = Schema.object({
    enabled: Schema.boolean().default(true).volatile().description('注册 generate_image 工具，让 dsh 具备绘图能力。Register the drawing tool.'),
    defaultGroup: Schema.string().default('').volatile().description('工具未指定分组时用哪一组(id 或名称)；留空则自动选第一个有密钥的分组。'),
    groups: Schema.array(groupField).default(SEED_GROUPS).volatile().description('绘图分组，每一组是一套独立的端点+密钥+模型清单。Drawing groups.'),
    timeoutMs: Schema.number().default(600000).volatile().description('单次绘图请求超时(毫秒)。Per-drawing timeout in milliseconds.'),
});

/** Flatten the entry config to plain values, read fresh at each call. */
const readConfig = (raw) => Object.fromEntries(Object.entries(raw ?? {})
    .map(([key, value]) => [key, typeof value?.get === 'function' ? value.get() : value]));

/** Complete one stored group into the shape a drawing needs. */
function normalizeGroup(raw, index) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const protocol = text(raw.protocol) === 'google' ? 'google' : 'openai';
    const id = text(raw.id) || `group-${index + 1}`;
    return {
        id,
        name: text(raw.name) || id,
        enabled: raw.enabled !== false,
        protocol,
        baseURL: (text(raw.baseURL) || BASE_URL[protocol]).replace(/\/+$/, ''),
        apiKey: text(raw.apiKey),
        models: (Array.isArray(raw.models) ? raw.models : [])
            .map((model) => ({ id: text(model?.id), note: text(model?.note) }))
            .filter((model) => model.id.length > 0),
        defaultModel: text(raw.defaultModel),
        size: text(raw.size) || '1024x1024',
        quality: text(raw.quality),
        responseFormat: text(raw.responseFormat),
        outputDir: text(raw.outputDir),
    };
}

/** Every configured group, in panel order, with the gaps filled in. */
const readGroups = (config) => (Array.isArray(config.groups) ? config.groups : [])
    .map(normalizeGroup).filter((group) => group !== null);

/** The one-line description of a group used in messages. */
const labelOf = (group) => (group.name === group.id ? group.id : `${group.name} (${group.id})`);

/** The model a group draws with when a call names none. */
const defaultModelOf = (group) => (group.defaultModel.length > 0
    && group.models.some((model) => model.id === group.defaultModel)
    ? group.defaultModel
    : (group.models[0]?.id ?? DEFAULT_MODEL[group.protocol]));

/** Find one group by id or display name, case-insensitively. */
const groupByName = (groups, wanted) => {
    const lowered = wanted.toLowerCase();
    return groups.find((group) => group.id.toLowerCase() === lowered || group.name.toLowerCase() === lowered);
};

/**
 * The group used when a call names none: the configured default, else the first
 * usable one. "Usable" means enabled and keyed, which is what keeps a fresh
 * install's two seeded groups from failing on the empty one.
 */
function defaultGroupOf(config, groups) {
    const preferred = groupByName(groups, text(config.defaultGroup));
    if (preferred !== undefined && preferred.apiKey.length > 0)
        return preferred;
    return groups.find((group) => group.enabled && group.apiKey.length > 0)
        ?? groups.find((group) => group.apiKey.length > 0)
        ?? groups.find((group) => group.enabled)
        ?? groups[0];
}

/**
 * Decide which group and which model one call uses.
 *
 * A named group is the endpoint, full stop: whatever model the call names goes
 * to it. Without a group, a named model picks the group that lists it — that is
 * what lets any (group, model) pair the panel offers be reached. Naming neither
 * uses the default group and that group's own default model.
 */
function resolveTarget(config, requestedGroup, requestedModel) {
    const groups = readGroups(config);
    if (groups.length === 0)
        throw fail('no drawing group is configured; add one in the dsh-image-gen plugin panel', 'MISSING_CREDENTIAL');
    const wantedGroup = text(requestedGroup);
    const wantedModel = text(requestedModel);
    let group;
    if (wantedGroup.length > 0) {
        group = groupByName(groups, wantedGroup);
        if (group === undefined) {
            throw fail(`no drawing group named "${wantedGroup}"; configured groups: `
                + groups.map(labelOf).join(', '), 'INVALID_REQUEST');
        }
    }
    else if (wantedModel.length > 0) {
        group = groups.find((candidate) => candidate.enabled
            && candidate.models.some((model) => model.id === wantedModel))
            ?? defaultGroupOf(config, groups);
    }
    else {
        group = defaultGroupOf(config, groups);
    }
    return { group, model: wantedModel.length > 0 ? wantedModel : defaultModelOf(group) };
}

/** The timeout, in milliseconds, guarding one drawing. */
const timeoutOf = (config) => (Number.isInteger(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : 600000);

/**
 * Compile the group and model catalogue, with the notes, into prose.
 *
 * This text is the whole mechanism by which a panel annotation reaches the
 * agent: it becomes part of the tool description, so a note written for a model
 * is read at exactly the moment the model is choosing what to call. It is also
 * the registration's identity — a save that changes this text re-registers the
 * tool, and a save that only changes a key does not.
 */
function catalogueText(config) {
    const groups = readGroups(config).filter((group) => group.enabled);
    if (groups.length === 0)
        return 'No drawing group is enabled; tell the user to switch one on in the dsh-image-gen plugin panel.';
    const lines = [];
    for (const group of groups) {
        const fallback = defaultModelOf(group);
        lines.push(`- group "${group.id}"${group.name === group.id ? '' : ` (${group.name})`} — `
            + `${PROTOCOL_NAME[group.protocol]} endpoint, `
            + `default model "${fallback}"`);
        if (group.models.length === 0)
            lines.push('    (no models listed; pass any model id explicitly)');
        for (const model of group.models)
            lines.push(`    - model "${model.id}"${model.id === fallback ? ' (default)' : ''}`
                + `${model.note.length > 0 ? `: ${model.note}` : ''}`);
    }
    return lines.join('\n');
}

//#endregion

//#region wire

const RATIOS = ['1:1', '4:5', '5:4', '3:4', '4:3', '2:3', '3:2', '9:16', '16:9']
    .map((label) => {
        const [width, height] = label.split(':').map(Number);
        return { value: width / height, label };
    });

/** Parse a `WIDTHxHEIGHT` string; `null` when it is not a usable size. */
function parseSize(raw) {
    const match = /^\s*(\d{2,5})\s*[x×*]\s*(\d{2,5})\s*$/.exec(String(raw ?? ''));
    return match === null ? null : { width: Number(match[1]), height: Number(match[2]) };
}

/** The Gemini aspect-ratio label nearest one pixel size, or `undefined`. */
function aspectRatioOf(size) {
    if (size === null)
        return undefined;
    const target = size.width / size.height;
    return RATIOS.reduce((best, ratio) => (Math.abs(ratio.value - target) < Math.abs(best.value - target) ? ratio : best)).label;
}

const MAGIC = [
    [[0x89, 0x50, 0x4e, 0x47], 'image/png'],
    [[0xff, 0xd8, 0xff], 'image/jpeg'],
    [[0x47, 0x49, 0x46], 'image/gif'],
];

/**
 * Identify the encoded raster from its magic bytes.
 *
 * Only the four media types the harness attachment store accepts are ever
 * returned: the bytes, not the endpoint's declaration, decide the format.
 */
function sniffMediaType(bytes, declared) {
    if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP')
        return 'image/webp';
    for (const [magic, mediaType] of MAGIC) {
        if (magic.every((byte, at) => bytes[at] === byte))
            return mediaType;
    }
    return MEDIA_TYPES.includes(declared) ? declared : 'image/png';
}

/** Decode one base64 image payload into bytes. */
function decodeBase64(value, label) {
    const bytes = new Uint8Array(Buffer.from(String(value).replace(/\s+/g, ''), 'base64'));
    if (bytes.length === 0)
        throw fail(`${label} returned no usable image payload`, 'EMPTY_RESPONSE');
    return bytes;
}

/** Map an HTTP status onto a routable failure code. */
const statusCode = (status) => (status === 401 || status === 403 ? 'AUTH'
    : status === 429 ? 'RATE_LIMIT'
        : status === 404 ? 'NOT_FOUND'
            : status === 400 || status === 422 ? 'INVALID_REQUEST'
                : 'TRANSPORT');

/** Reject a non-2xx provider response with a routable code and the body's own reason. */
async function ensureOk(response, label) {
    if (response.ok)
        return;
    const detail = await response.text().catch(() => '');
    throw fail(`${label} HTTP ${response.status}${detail ? `: ${detail.slice(0, 800)}` : ''}`, statusCode(response.status));
}

/** Download one generated image URL without ever attaching the credential. */
async function fetchImageBytes(url, signal) {
    const response = await fetch(url, { headers: { accept: 'image/*', ...attribution() }, signal });
    await ensureOk(response, 'generated image download');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0)
        throw fail('generated image download returned no bytes', 'EMPTY_RESPONSE');
    return bytes;
}

/**
 * Draw through an OpenAI-compatible `/images/generations` endpoint.
 *
 * `response_format` is sent only when configured, because the newer
 * `gpt-image-*` family rejects the field outright while `dall-e-*` needs it for
 * a URL answer.
 */
async function openaiImages(group, request, signal) {
    const body = { model: request.model, prompt: request.prompt, n: request.count, size: request.size };
    if (request.quality.length > 0)
        body.quality = request.quality;
    if (group.responseFormat.length > 0)
        body.response_format = group.responseFormat;
    const response = await fetch(`${group.baseURL}/images/generations`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            authorization: `Bearer ${group.apiKey}`,
            ...attribution(),
        },
        body: JSON.stringify(body),
        signal,
    });
    await ensureOk(response, `image endpoint "${group.baseURL}"`);
    const items = (await response.json())?.data;
    const out = [];
    for (const item of Array.isArray(items) ? items : []) {
        const encoded = item?.b64_json;
        const bytes = typeof encoded === 'string' && encoded.length > 0
            ? decodeBase64(encoded, 'the image endpoint')
            : (typeof item?.url === 'string' && item.url.length > 0 ? await fetchImageBytes(item.url, signal) : null);
        if (bytes !== null)
            out.push({ bytes, mediaType: sniffMediaType(bytes), revisedPrompt: item?.revised_prompt });
    }
    if (out.length === 0)
        throw fail('the image endpoint returned no usable image payload', 'EMPTY_RESPONSE');
    return out;
}

/** Draw through Google AI Studio: `imagen-*` uses `:predict`, Gemini uses `:generateContent`. */
async function googleImages(group, request, signal) {
    const headers = {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-goog-api-key': group.apiKey,
        ...attribution(),
    };
    const url = `${group.baseURL}/models/${encodeURIComponent(request.model)}`;
    if (request.model.startsWith('imagen')) {
        const parameters = { sampleCount: request.count };
        const ratio = aspectRatioOf(parseSize(request.size));
        if (ratio !== undefined)
            parameters.aspectRatio = ratio;
        const response = await fetch(`${url}:predict`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ instances: [{ prompt: request.prompt }], parameters }),
            signal,
        });
        await ensureOk(response, 'Google AI Studio image endpoint');
        const predictions = (await response.json())?.predictions;
        const out = [];
        for (const prediction of Array.isArray(predictions) ? predictions : []) {
            if (typeof prediction?.bytesBase64Encoded !== 'string' || prediction.bytesBase64Encoded.length === 0)
                continue;
            const bytes = decodeBase64(prediction.bytesBase64Encoded, 'Google AI Studio');
            out.push({ bytes, mediaType: sniffMediaType(bytes, prediction.mimeType) });
        }
        if (out.length === 0)
            throw fail('Google AI Studio returned no images', 'EMPTY_RESPONSE');
        return out;
    }
    const generationConfig = { responseModalities: ['TEXT', 'IMAGE'] };
    const ratio = aspectRatioOf(parseSize(request.size));
    if (ratio !== undefined)
        generationConfig.imageConfig = { aspectRatio: ratio };
    const contents = [{ role: 'user', parts: [{ text: request.prompt }] }];
    const post = (config) => fetch(`${url}:generateContent`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ contents, generationConfig: config }),
        signal,
    });
    let response = await post(generationConfig);
    let payload;
    if (response.ok) {
        payload = await response.json();
    }
    else {
        const detail = await response.text().catch(() => '');
        // `imageConfig` is an optional hint that models predating it reject with a
        // 400. The request was refused before any generation, so dropping the
        // field and trying once more is free and keeps the size honoured wherever
        // the model does understand it.
        if (response.status !== 400 || !/imageConfig/i.test(detail))
            throw fail(`Google AI Studio image endpoint HTTP ${response.status}${detail ? `: ${detail.slice(0, 800)}` : ''}`, statusCode(response.status));
        const withoutSize = { ...generationConfig };
        delete withoutSize.imageConfig;
        response = await post(withoutSize);
        await ensureOk(response, 'Google AI Studio image endpoint');
        payload = await response.json();
    }
    const blockReason = payload?.promptFeedback?.blockReason;
    if (blockReason !== undefined)
        throw fail(`Google AI Studio blocked the prompt: ${String(blockReason)}`, 'INVALID_REQUEST');
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts))
        throw fail('Google AI Studio returned no content parts', 'EMPTY_RESPONSE');
    const out = [];
    for (const part of parts) {
        const inline = part?.inlineData ?? part?.inline_data;
        if (typeof inline?.data !== 'string' || inline.data.length === 0)
            continue;
        const bytes = decodeBase64(inline.data, 'Google AI Studio');
        out.push({ bytes, mediaType: sniffMediaType(bytes, inline.mimeType ?? inline.mime_type) });
    }
    if (out.length === 0)
        throw fail('Google AI Studio returned text but no image; check that the model can output images', 'EMPTY_RESPONSE');
    return out;
}

/** Render one prompt into images through the group's own protocol. */
async function drawImages(group, timeoutMs, request, signal) {
    if (group.apiKey.length === 0)
        throw fail(`drawing group ${labelOf(group)} has no API key; fill it in the dsh-image-gen plugin panel`, 'MISSING_CREDENTIAL');
    const bounded = AbortSignal.any([...(signal === undefined ? [] : [signal]), AbortSignal.timeout(timeoutMs)]);
    return group.protocol === 'google' ? googleImages(group, request, bounded) : openaiImages(group, request, bounded);
}

//#endregion

//#region the tool

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/**
 * Write one generated image into the configured absolute directory.
 *
 * The path goes through the composed filesystem first so a sandboxed or remote
 * backend maps it into its own execution world; a backend that cannot map it
 * falls back to the host path, which is what a local desktop deployment uses.
 */
async function saveImageFile(outputDir, name, bytes, ctx) {
    let directory = outputDir;
    try {
        const filesystem = ctx.get('fs');
        if (filesystem !== undefined)
            directory = filesystem.processPath(await filesystem.resolve(outputDir));
    }
    catch {
        // An unmappable directory still gets the host path.
    }
    const file = path.join(directory, name);
    await mkdir(directory, { recursive: true });
    await writeFile(file, bytes);
    return file;
}

/** The `generate_image` tool definition, bound to the entry's live configuration. */
function imageToolDefinition(config, ctx) {
    return {
        name: IMAGE_TOOL_NAME,
        description: 'Generate an image from a text prompt through the drawing groups configured in the dsh-image-gen plugin panel. '
            + 'Use it whenever the user asks for a picture, illustration, poster, icon, or any other raster artwork. '
            + 'The generated image is attached to the result, so it can be shown to the user directly.\n'
            + 'Every call may override the group\'s own settings: `group` and `model` pick the endpoint and the model, `size` the '
            + 'pixels, `quality` the quality tier, `count` how many images, and `outputDir` a directory to also write the files '
            + 'into. Omit any of them to use the group\'s configuration.\n'
            + 'The catalogue below is the current panel configuration — the note after each model says when to pick it.\n'
            + catalogueText(readConfig(config)),
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['prompt'],
            properties: {
                prompt: { type: 'string', description: 'The image prompt. State the subject, style, framing, lighting, and any text that must appear.' },
                group: {
                    type: 'string',
                    description: 'Which drawing group to use, by its id or display name (see this tool\'s description). '
                        + 'Omit to use the default group.',
                },
                model: {
                    type: 'string',
                    description: 'Which model to draw with. Use an id from the catalogue in this tool\'s description and follow the '
                        + 'note written after it — those notes say when each model is the right choice. With `group` it overrides '
                        + 'that group\'s default model; on its own it selects the group that lists the model. Omit to use the '
                        + 'group\'s default model.',
                },
                size: {
                    type: 'string',
                    description: 'Output size as WIDTHxHEIGHT, e.g. 1024x1024, 1440x2560 (2K portrait), 2560x1440 (2K landscape). '
                        + 'Overrides the group\'s default size; omit to use it. Some models only accept certain sizes or a bare '
                        + 'aspect ratio.',
                },
                quality: {
                    type: 'string',
                    description: 'OpenAI-compatible endpoints only: low, medium, or high. Overrides the group\'s default quality; '
                        + 'omit to use it, and pass an empty string to send no quality at all.',
                },
                count: { type: 'integer', description: 'How many images to generate, 1 to 4. Defaults to 1; never create unrequested variations.' },
                outputDir: {
                    type: 'string',
                    description: 'Absolute directory to also write each generated file into, in addition to returning it as an '
                        + 'attachment. Overrides the group\'s own output directory; omit to use it, and pass an empty string to '
                        + 'write nothing to disk. Use this when the user names a folder, or when the image is a deliverable.',
                },
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                required: ['images', 'model', 'protocol', 'group', 'size', 'quality'],
                properties: {
                    images: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['width', 'height', 'bytes', 'mediaType'],
                            properties: {
                                path: { type: 'string', description: 'Absolute path of the saved file, when one was written.' },
                                attachment: {
                                    type: 'object',
                                    additionalProperties: true,
                                    description: 'Durable harness attachment reference; the image block in this result carries it.',
                                    properties: {
                                        attachmentId: { type: 'string' },
                                        mediaType: { type: 'string' },
                                        bytes: { type: 'integer' },
                                        width: { type: 'integer' },
                                        height: { type: 'integer' },
                                        name: { type: 'string' },
                                    },
                                },
                                width: { type: 'integer' },
                                height: { type: 'integer' },
                                bytes: { type: 'integer' },
                                mediaType: { type: 'string' },
                                revisedPrompt: { type: 'string' },
                            },
                        },
                    },
                    model: { type: 'string' },
                    protocol: { type: 'string' },
                    group: { type: 'string', description: 'The drawing group this call actually used.' },
                    size: { type: 'string', description: 'The size this call actually asked for.' },
                    quality: { type: 'string', description: 'The quality this call actually asked for; empty when the endpoint takes none.' },
                },
            },
            render: (_args, value) => {
                const blocks = [];
                const lines = [];
                for (const image of value.images ?? []) {
                    if (image.attachment !== undefined && image.attachment !== null)
                        blocks.push({ type: 'image', attachment: image.attachment });
                    lines.push(`${image.path ?? 'attached'} — ${image.width}x${image.height}, ${image.bytes} bytes, ${image.mediaType}`);
                }
                blocks.push({
                    type: 'text',
                    text: lines.length > 0
                        ? `Generated ${lines.length} image(s) with ${value.model} via ${value.group} at ${value.size}:\n${lines.join('\n')}`
                        : 'The image endpoint returned no images.',
                });
                return blocks;
            },
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            const live = readConfig(config);
            if (live.enabled === false)
                throw fail('image generation is disabled in the dsh-image-gen plugin panel', 'INVALID_REQUEST');
            const prompt = text(args?.prompt);
            if (prompt.length === 0)
                throw fail('generate_image needs a non-empty prompt', 'INVALID_REQUEST');
            const { group, model } = resolveTarget(live, args?.group, args?.model);
            if (!group.enabled)
                throw fail(`drawing group ${labelOf(group)} is switched off in the plugin panel`, 'INVALID_REQUEST');
            const size = text(args?.size) || group.size;
            if (parseSize(size) === null)
                throw fail(`"${size}" is not a WIDTHxHEIGHT size`, 'INVALID_REQUEST');
            const quality = text(args?.quality) || group.quality;
            const count = Number.isInteger(args?.count) && args.count >= 1 && args.count <= 4 ? args.count : 1;
            // Naming the parameter at all wins over the group's own directory, so an
            // empty string is how a call says "do not write to disk this time".
            const outputDir = args?.outputDir === undefined ? group.outputDir : text(args.outputDir);

            const generated = await drawImages(
                { ...group, quality },
                timeoutOf(live),
                { prompt, model, size, quality, count },
                exec?.signal,
            );
            // Resolved per call: a deployment whose attachment store mounts after
            // this tool was registered still gets inline images.
            const attachments = ctx.get('attachments');
            const images = [];
            for (const item of generated) {
                const name = `${IMAGE_TOOL_NAME}-${Date.now()}-${images.length + 1}.${EXTENSIONS[item.mediaType] ?? 'png'}`;
                const attachment = typeof attachments?.saveImage === 'function'
                    ? await attachments.saveImage({ data: item.bytes, mediaType: item.mediaType, name })
                        .catch((error) => {
                            throw fail('the generated image was refused by the harness attachment store: '
                                + (error instanceof Error ? error.message : String(error)), 'TRANSPORT');
                        })
                    : undefined;
                const written = outputDir.length > 0
                    ? await saveImageFile(outputDir, name, item.bytes, ctx)
                    : undefined;
                images.push({
                    ...(written === undefined ? {} : { path: written }),
                    ...(attachment === undefined ? {} : { attachment }),
                    width: attachment?.width ?? 0,
                    height: attachment?.height ?? 0,
                    bytes: item.bytes.length,
                    mediaType: item.mediaType,
                    ...(typeof item.revisedPrompt === 'string' && item.revisedPrompt.length > 0
                        ? { revisedPrompt: item.revisedPrompt }
                        : {}),
                });
            }
            return { images, model, protocol: group.protocol, group: labelOf(group), size, quality };
        },
    };
}

//#endregion

/**
 * Mount the drawing tool, and keep it in step with the panel.
 *
 * The registration lives in a child fiber so a deployment without a `tools`
 * service never offers the tool, instead of leaving this entry pending. A save
 * that changes the catalogue re-registers the tool, because the catalogue and
 * its notes are part of the tool description the agent reads; a save that only
 * changes a key or a timeout does not.
 *
 * @param ctx - the plugin context.
 * @param config - the entry's own Config (volatile references).
 */
export function apply(ctx, config) {
    /** The child context that owns `tools`, once that service is available. */
    let scope;
    /** The `tools.register()` disposer, while the tool is registered. */
    let dispose;
    /** The catalogue the current registration's description ends with. */
    let signature = null;

    const sync = () => {
        if (scope === undefined)
            return;
        const live = readConfig(config);
        if (live.enabled === false) {
            dispose?.();
            dispose = undefined;
            signature = null;
            return;
        }
        const next = catalogueText(live);
        if (dispose !== undefined && next === signature)
            return;
        dispose?.();
        dispose = scope.tools.register(imageToolDefinition(config, scope));
        signature = next;
    };

    ctx.inject(['tools'], (tctx) => {
        scope = tctx;
        tctx.effect(() => () => {
            dispose = undefined;
            scope = undefined;
            signature = null;
        });
        sync();
    });

    ctx.on('loader/volatile-update', () => {
        try {
            sync();
        }
        catch (error) {
            ctx.logger.error('image-gen: cannot apply the configuration change', error);
        }
    });

    const live = readConfig(config);
    const groups = readGroups(live);
    ctx.logger.info(`image-gen: ${IMAGE_TOOL_NAME} is ${live.enabled !== false ? 'on' : 'off'}, `
        + `${groups.length} group(s), ${groups.reduce((total, group) => total + group.models.length, 0)} model(s)`);
}
