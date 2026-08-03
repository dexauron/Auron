---
name: remotion-render
description: Собрать готовый файл ролика — mp4 или gif. Используй, когда ролик готов и его надо выгрузить, отправить, выложить в сторис или в рекламу.
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


## General rendering strategy

Render a video using:

```
npx remotion render
```

Full list of options: https://www.remotion.dev/docs/cli/render.md

Render a still using:

```
npx remotion still
```

Full list of options: https://www.remotion.dev/docs/cli/still.md

## Transparent videos

See [Transparent videos](./transparent-videos.md) for rendering out a video with transparency.
