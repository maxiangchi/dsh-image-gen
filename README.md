# dsh-image-gen

给 dsh 增加 `generate_image` 工具：在插件面板里填写绘图端点和密钥，模型就能在对话中出图。
只做这一件事，不注册模型路由（自定义 LLM 由 dsh 自己配置）。

支持 OpenAI 兼容格式的 `/images/generations`，以及 Google AI Studio（Gemini / Imagen）。

## 安装

```powershell
dsh plugin --profile desktop add <本插件目录>
dsh plugin --profile desktop remove dsh-image-gen
```

## 分组

面板里可以放多组端点，每组是一套独立的「协议 + Base URL + 密钥 + 模型清单 + 默认尺寸 / quality /
返回格式 / 另存目录」。装好后自带两组，分别对应上面两种协议，可以新增、改名、停用、折叠、删除。

## 模型清单

每组的模型清单是「模型 ID + 一句说明」。这些说明会写进 `generate_image` 的工具描述，模型据此选择
分组和模型；停用的分组不会出现在描述里。

## 调用参数

| 参数 | 说明 |
| --- | --- |
| `prompt` | 提示词，必填 |
| `group` | 按 id 或显示名指定分组 |
| `model` | 指定模型 ID，该组清单里没有也能用 |
| `size` | `宽x高`，覆盖该组默认值 |
| `quality` | 覆盖该组默认值，OpenAI 兼容端点才会发送 |
| `count` | 张数，1–4 |
| `outputDir` | 覆盖该组的另存目录 |

`group` 与 `model` 可以单独使用：只写 `model` 时路由到列出该模型的分组；只写 `group` 时用该组的
默认模型；两个都写时 `group` 决定端点，`model` 原样发送。都不写时按「默认分组 → 第一个有密钥且
启用的分组 → 第一个有密钥的分组」选取。

## 协议

- **OpenAI 兼容**：`POST {base}/images/generations`，密钥用 `Authorization: Bearer` 发送，
  返回支持 `b64_json` 与 `url`。
- **Google AI Studio**：`gemini-*` 走 `:generateContent`，`imagen-*` 走 `:predict`，密钥用
  `x-goog-api-key` 发送。

出图结果作为附件返回并直接显示；填了另存目录或在调用时传 `outputDir` 时同时落盘。

## 许可

MIT
