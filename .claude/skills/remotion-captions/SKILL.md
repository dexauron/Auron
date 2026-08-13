---
name: remotion-captions
description: Субтитры и подписи в ролике: расшифровка речи, вывод текста по словам, анимация подписей. Используй, когда в видео нужны субтитры, бегущий текст или подписи под говорящим.
version: 4.0.505
---

> **Врезка проекта Auron (не от автора скила).**
> Remotion — это React и Node: **к самому приложению Auron он отношения не
> имеет.** Наш фронт — один файл `webapp/Index.html` внутри Google Apps
> Script, там ни React, ни сборки нет, и ни одна строка отсюда в него не
> ложится. Анимации в приложении делаются по `emil-design-eng`.
>
> Этот набор — для отдельной задачи: **делать ролики про магазин** (реклама,
> сторис, заставки). Ролик собирается в отдельной папке и в репозиторий
> приложения не попадает.
>
> Взяты только тексты. Скрипты, картинки и вложенные копии других скилов не
> копировались.


All captions must be processed in JSON. The captions must use the [`Caption`](https://www.remotion.dev/docs/captions/caption.md) type which is the following:

```ts
import type { Caption } from "@remotion/captions";
```

This is the definition:

```ts
type Caption = {
  text: string;
  startMs: number;
  endMs: number;
  timestampMs: number | null;
  confidence: number | null;
};
```

## Generating captions

To transcribe video and audio files to generate captions, load the [transcribe-captions.md](transcribe-captions.md) file for more instructions.

## Displaying captions

To display captions in your video, load the [display-captions.md](display-captions.md) file for more instructions.

## Importing captions

To import captions from a .srt file, load the [import-srt-captions.md](import-srt-captions.md) file for more instructions.
